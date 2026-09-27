import type { AgentActivity } from '../shared/types';
import { shell } from 'electron';
import { localAgent, type LocalAgentId } from '../shared/botCatalog';
import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import type { BotConnection, LocalAgentStatus, LocalAgentSetupResult } from '../shared/types';

type LocalConnection = Extract<BotConnection, { kind: 'cli' }>;

const activeProcesses = new Set<() => void>();
let shellEnvironment: { at: number; value: Promise<NodeJS.ProcessEnv> } | undefined;

/** Finder-launched apps must discover the same tools as the user's terminal. */
async function agentEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return process.env;
  if (shellEnvironment && Date.now() - shellEnvironment.at < 2000) return shellEnvironment.value;
  const value = new Promise<NodeJS.ProcessEnv>((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lic', 'printf "\\n__MULTIMIND_PATH__%s\\n" "$PATH"'], { timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const path = error ? undefined : stdout.split(/\r?\n/).find((line) => line.startsWith('__MULTIMIND_PATH__'))?.slice('__MULTIMIND_PATH__'.length);
      resolve(path ? { ...process.env, PATH: path } : process.env);
    });
  });
  shellEnvironment = { at: Date.now(), value };
  return value;
}

/** Quit cannot rely on delayed cancellation timers remaining alive. */
export function disposeLocalAgents(): void {
  for (const terminate of activeProcesses) terminate();
  activeProcesses.clear();
}

export async function resolveAgentExecutable(agent: LocalAgentId, configured?: string): Promise<string> {
  const preset = localAgent(agent);
  const env = await agentEnvironment();
  const folders = [...(env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), '.npm-global', 'bin'), ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : [])];
  const candidates = configured?.trim() ? [configured.trim()] : folders.flatMap((folder) => process.platform === 'win32'
    ? [join(folder, `${preset.command}.exe`), ...(preset.npmEntry ? [join(folder, 'node_modules', preset.npmEntry)] : [])]
    : [join(folder, preset.command)]);
  for (const file of candidates) {
    if (!isAbsolute(file)) continue;
    try {
      if (!((await stat(file)).isFile())) continue;
      await access(file, /\.[cm]?js$/.test(file) || process.platform === 'win32' ? constants.R_OK : constants.X_OK);
      return file;
    } catch { /* Try the next installation location. */ }
  }
  throw new Error(`${preset.name} was not found. Install it or select its executable path.`);
}

async function command(executable: string, args: string[], systemNode = false) {
  const env = await agentEnvironment();
  return /\.[cm]?js$/.test(executable)
    ? { file: systemNode ? 'node' : process.execPath, args: [executable, ...args], env: systemNode ? env : { ...env, ELECTRON_RUN_AS_NODE: '1' } }
    : { file: executable, args, env };
}

export async function detectLocalAgent(agent: LocalAgentId, executable?: string): Promise<LocalAgentStatus> {
  let resolved: string;
  try { resolved = await resolveAgentExecutable(agent, executable); } catch {
    return { installed: false, authenticated: false, authMethod: 'unknown' };
  }
  const probe = async (args: string[]) => {
    const spec = await command(resolved, args, agent === 'dsh');
    return new Promise<{ ok: boolean; output: string }>((resolve) => {
      const child = spawn(spec.file, spec.args, { env: spec.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const terminate = () => { child.kill('SIGKILL'); };
      activeProcesses.add(terminate);
      child.once('close', () => activeProcesses.delete(terminate));
      let output = '';
      const capture = (data: Buffer) => { output = (output + data.toString()).slice(-8192); };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, output: '' }); }, 8000);
      child.on('error', () => { clearTimeout(timer); resolve({ ok: false, output: '' }); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ ok: code === 0, output }); });
    });
  };
  const version = await probe(['--version']);
  if (!version.ok) return { installed: true, executable: resolved, usable: false, authenticated: false, authChecked: false, authMethod: 'unknown' };
  const supportsAuthCheck = agent === 'codex' || agent === 'claude' || agent === 'qodercn';
  const auth = supportsAuthCheck ? await probe(agent === 'codex' ? ['login', 'status'] : agent === 'qodercn' ? ['status', '-o', 'json'] : ['auth', 'status']) : { ok: false, output: '' };
  if (agent === 'qodercn') {
    let loggedIn: boolean | undefined;
    try { const value = JSON.parse(auth.output).logged_in; if (typeof value === 'boolean') loggedIn = value; } catch { /* No conclusive status. */ }
    return { installed: true, executable: resolved, usable: true, authChecked: auth.ok && loggedIn !== undefined,
      authenticated: auth.ok && loggedIn === true, authMethod: 'unknown' };
  }
  let explicitlyLoggedOut = /not logged in/i.test(auth.output);
  if (agent === 'claude') {
    try { explicitlyLoggedOut = JSON.parse(auth.output).loggedIn === false; } catch { /* Unknown status stays unknown. */ }
  }
  const authChecked = supportsAuthCheck && (auth.ok || explicitlyLoggedOut);
  return { installed: true, executable: resolved, usable: true, authChecked, authenticated: auth.ok && !explicitlyLoggedOut,
    authMethod: auth.ok && /ChatGPT|claude\.ai|oauth/i.test(auth.output) ? 'subscription' : auth.ok && /API key|api_key/i.test(auth.output) ? 'api' : 'unknown' };
}

export interface LocalAgentRequest {
  connection: LocalConnection;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  timeoutMs: number;
  onActivity?: (activity: AgentActivity) => void;
  onDelta: (delta: string, content: string) => void;
}

/** A fresh ephemeral CLI run per member/round prevents cross-conversation session reuse. */
export async function callLocalAgent(request: LocalAgentRequest): Promise<{ content: string; elapsedMs: number; error?: string }> {
  const preset = localAgent(request.connection.agent);
  const started = Date.now();
  request.onActivity?.('connecting');
  const executable = await resolveAgentExecutable(request.connection.agent, request.connection.executable);
  const temporary = !request.connection.cwd;
  const cwd = request.connection.cwd || await mkdtemp(join(tmpdir(), 'multimind-agent-'));
  if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('Choose an existing absolute working directory.');
  try {
    if (request.signal.aborted) return { content: '', elapsedMs: 0, error: 'Stopped' };
    const args: string[] = preset.protocol === 'codex' ? ['app-server', '--listen', 'stdio://', '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"'] : preset.protocol === 'claude' ? ['--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'] : [...preset.acpArgs];
    if (request.model.trim() && preset.protocol === 'claude') args.push('--model', request.model.trim());
    const spec = await command(executable, args, preset.id === 'dsh');
    return await new Promise((resolve) => {
      const child = spawn(spec.file, spec.args, { env: preset.id === 'dsh' ? { ...spec.env, DSH_PERMISSION_MODE: 'read-only' } : spec.env, cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      let content = '';
      let failure: string | undefined;
      let ended = false;
      let acpCompleted = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const answers = new Map<string, string>();
      const kill = (force = false) => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => child.kill());
          } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch { /* Process already exited. */ }
      };
      const stop = () => {
        kill();
        if (!killTimer) killTimer = setTimeout(() => { kill(true); finish(request.signal.aborted ? 'Stopped' : failure ?? 'LOCAL_AGENT_EXITED'); }, 1500);
      };
      const terminate = () => kill(true);
      activeProcesses.add(terminate);
      const timer = setTimeout(() => { failure = 'LOCAL_AGENT_TIMEOUT'; stop(); }, request.timeoutMs);
      const finish = (error?: string) => {
        if (ended) return;
        ended = true;
        if (request.signal.aborted) error = 'Stopped';
        terminate();
        activeProcesses.delete(terminate);
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener('abort', stop);
        resolve({ content, elapsedMs: Date.now() - started, ...(error ? { error } : {}) });
      };
      let codexThreadId: string | undefined;
      let acpId = 0;
      const pendingRpc = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
      const rpc = (method: string, params: object) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = ++acpId; pendingRpc.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
      const publish = (next: string) => {
        if (!request.signal.aborted && next !== content) request.onDelta(next.startsWith(content) ? next.slice(content.length) : next, next);
        content = next;
      };
      const line = (raw: string) => {
        if (ended) return;
        try {
          const event = JSON.parse(raw) as {
            id?: number | string; method?: string; result?: Record<string, unknown> | string; error?: unknown;
            params?: { willRetry?: boolean; threadId?: string; itemId?: string; delta?: string; turn?: { status?: string }; item?: { id?: string; type?: string; text?: string }; update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
            type?: string; is_error?: boolean; message?: { id?: string; content?: Array<{ type: string; text?: string }> };
            item?: { id?: string; type?: string; text?: string };
          };
          if (preset.protocol === 'acp') {
            if (event.method && event.id !== undefined) {
              child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: event.id, ...(event.method === 'session/request_permission' ? { result: { outcome: { outcome: 'cancelled' } } } : { error: { code: -32601, message: 'Client capability unavailable' } }) }) + '\n');
            } else if (event.id !== undefined) {
              const pending = typeof event.id === 'number' ? pendingRpc.get(event.id) : undefined;
              if (typeof event.id === 'number') pendingRpc.delete(event.id);
              if (event.error) {
                const error = event.error as { code?: number; message?: string };
                const authRequired = error.code === -32000 && typeof error.message === 'string' && /authentication required|authentication is required/i.test(error.message);
                pending?.reject(new Error(authRequired ? 'LOCAL_AGENT_AUTH_REQUIRED' : 'LOCAL_AGENT_TURN_FAILED'));
              }
              else pending?.resolve(typeof event.result === 'object' && event.result ? event.result : {});
            }
            const update = event.params?.update;
            if (event.method === 'session/update' && update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') publish(content + (update.content.text ?? ''));
            return;
          }
          if (preset.protocol === 'claude') {
            if (event.type === 'assistant' && event.message?.content) {
              answers.set(event.message.id ?? 'answer', event.message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join(''));
              publish([...answers.values()].join('\n\n'));
            }
            if (event.type === 'result') {
              if (event.is_error) { finish('LOCAL_AGENT_TURN_FAILED'); }
              else {
                if (typeof event.result === 'string') publish(event.result);
                finish(content ? undefined : 'LOCAL_AGENT_EMPTY');
              }
            }
            return;
          }
          if (event.method && event.id !== undefined) {
            const approval = event.method === 'item/commandExecution/requestApproval' || event.method === 'item/fileChange/requestApproval';
            child.stdin.write(JSON.stringify({ id: event.id, ...(approval ? { result: { decision: 'decline' } } : { error: { code: -32601, message: 'Client capability unavailable' } }) }) + '\n');
            return;
          }
          if (typeof event.id === 'number') {
            const pending = pendingRpc.get(event.id); pendingRpc.delete(event.id);
            if (event.error) pending?.reject(new Error('LOCAL_AGENT_TURN_FAILED'));
            else pending?.resolve(typeof event.result === 'object' && event.result ? event.result : {});
            return;
          }
          const params = event.params;
          if (!codexThreadId || params?.threadId !== codexThreadId) return;
          if (event.method === 'turn/started') request.onActivity?.('waiting');
          if (event.method === 'item/started') {
            const type = params.item?.type;
            const activity: AgentActivity | undefined = type === 'reasoning' ? 'thinking' : type === 'webSearch' ? 'searching' : type === 'agentMessage' ? 'answering' : ['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'contextCompaction'].includes(type ?? '') ? 'working' : undefined;
            if (activity) request.onActivity?.(activity);
          }
          if (event.method === 'item/completed' && params.item?.type !== 'agentMessage') request.onActivity?.('waiting');
          if (event.method?.startsWith('item/reasoning/')) request.onActivity?.('thinking');
          if (event.method === 'error' && params.willRetry === true) request.onActivity?.('retrying');
          if (event.method === 'item/agentMessage/delta' && typeof params.itemId === 'string' && typeof params.delta === 'string') {
            request.onActivity?.('answering');
            answers.set(params.itemId, (answers.get(params.itemId) ?? '') + params.delta);
            publish([...answers.values()].join('\n\n'));
          } else if (event.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.id === 'string' && typeof params.item.text === 'string') {
            // Final item text reconciles streamed chunks without duplicating them.
            answers.set(params.item.id, params.item.text);
            publish([...answers.values()].join('\n\n'));
          } else if (event.method === 'turn/completed') {
            finish(params.turn?.status === 'completed' ? (content ? undefined : 'LOCAL_AGENT_EMPTY') : params.turn?.status === 'interrupted' ? 'Stopped' : 'LOCAL_AGENT_TURN_FAILED');
          }

        } catch { /* Ignore non-protocol output, never forward tool output or credentials. */ }
      };
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        if (buffer.length > 8 * 1024 * 1024) { failure = 'LOCAL_AGENT_OUTPUT_LIMIT'; stop(); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      });
      child.stderr.on('data', () => {}); // CLI diagnostics can contain credentials; do not persist them.
      child.stdin.on('error', () => {});
      child.on('error', () => finish('Unable to start local agent. Check its installation and executable path.'));
      child.on('close', (code, signal) => {
        for (const pending of pendingRpc.values()) pending.reject(new Error('Agent exited.'));
        pendingRpc.clear();
        buffer += decoder.end();
        if (buffer.trim()) line(buffer);
        finish(request.signal.aborted ? 'Stopped' : acpCompleted && content ? undefined : failure ?? (code !== 0 || signal ? `LOCAL_AGENT_EXITED (code=${code ?? 'none'}, signal=${signal ?? 'none'})` : 'LOCAL_AGENT_INCOMPLETE'));
      });
      request.signal.addEventListener('abort', stop, { once: true });
      if (request.signal.aborted) stop();
      const prompt = request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
      if (preset.protocol === 'codex') {
        void (async () => {
          await rpc('initialize', { clientInfo: { name: 'bot_conversation', title: null, version: '1.0.0' }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } });
          if (ended) return;
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
          const settings = await rpc('config/read', { cwd, includeLayers: false });
          if (ended) return;
          const config = settings.config as { model_provider?: string | null } | undefined;
          // A new thread otherwise repeats failing WebSocket attempts before HTTPS fallback.
          // Scope the transport override to this ephemeral thread; retain login, model and custom providers.
          const officialProvider = !config?.model_provider || config.model_provider === 'openai';
          const transport = officialProvider ? {
            modelProvider: 'bot_openai_https',
            config: { 'model_providers.bot_openai_https': { name: 'OpenAI', wire_api: 'responses', requires_openai_auth: true, supports_websockets: false } },
          } : {};
          const session = await rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', ...transport, ...(request.model.trim() ? { model: request.model.trim() } : {}) });
          if (ended) return;
          const thread = session.thread as { id?: unknown } | undefined;
          if (typeof thread?.id !== 'string') throw new Error('Missing thread id');
          codexThreadId = thread.id;
          await rpc('turn/start', { threadId: codexThreadId, input: [{ type: 'text', text: prompt, text_elements: [] }] });
        })().catch(() => { finish('LOCAL_AGENT_TURN_FAILED'); });
      } else if (preset.protocol === 'acp') {
        void (async () => {
          await rpc('initialize', { protocolVersion: 1, clientCapabilities: {} });
          const session = await rpc('session/new', { cwd, mcpServers: [] });
          if (typeof session.sessionId !== 'string') throw new Error('Agent did not create a session.');
          if (request.model.trim()) {
            if (preset.id === 'dsh') {
              const options = session.configOptions as Array<{ id: string; options?: Array<{ value?: string; name?: string; options?: Array<{ value: string; name: string }> }> }> | undefined;
              const model = options?.find((option) => option.id === 'model');
              const choices = model?.options?.flatMap((option) => option.options ?? (typeof option.value === 'string' ? [{ value: option.value, name: option.name ?? '' }] : [])) ?? [];
              const matches = choices.filter((choice) => {
                if (choice.value === request.model.trim() || choice.name === request.model.trim()) return true;
                try { const route: unknown = JSON.parse(choice.value); return Array.isArray(route) && route[1] === request.model.trim(); } catch { return false; }
              });
              if (matches.length !== 1) throw new Error('LOCAL_AGENT_TURN_FAILED');
              await rpc('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: matches[0].value });
            } else await rpc('session/set_model', { sessionId: session.sessionId, modelId: request.model.trim() });
          }
          const result = await rpc('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: prompt }] });
          if (preset.id === 'dsh') {
            await Promise.race([rpc('session/close', { sessionId: session.sessionId }).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 500))]);
            if (result.stopReason !== 'end_turn') { finish('LOCAL_AGENT_INCOMPLETE'); return; }
          }
          acpCompleted = true;
          finish(content ? undefined : 'LOCAL_AGENT_EMPTY');
        })().catch((error: unknown) => { finish(error instanceof Error && error.message === 'LOCAL_AGENT_AUTH_REQUIRED' ? error.message : 'LOCAL_AGENT_TURN_FAILED'); });
      } else child.stdin.end(prompt);
    });
  } finally {
    if (temporary) await rm(cwd, { recursive: true, force: true });
  }
}

/** Setup commands are fixed catalog entries, never renderer-supplied shell text. */
export async function setupLocalAgent(agent: LocalAgentId, action: 'install' | 'login' | 'docs', executable?: string): Promise<LocalAgentSetupResult> {
  const preset = localAgent(agent);
  if (action === 'docs') { await shell.openExternal(preset.docs); return { status: 'opened' }; }
  if (action !== 'install' && action !== 'login') throw new Error('Unknown setup action.');
  const install = process.platform === 'win32' && 'installWindows' in preset ? preset.installWindows : preset.install;
  let setupCommand: string = install;
  if (action === 'login') {
    const status = await detectLocalAgent(agent, executable);
    if (status.authenticated) return { status: 'authenticated', agentStatus: status }; // Never replace an existing login, including stale UI requests.
    if (!status.usable || !status.executable) throw new Error('Check the local Agent installation first.');
    if ((agent === 'codex' || agent === 'claude' || agent === 'qodercn') && !status.authChecked) {
      throw new Error('Could not confirm login status. Check the local configuration and detect again.');
    }
    const file = status.executable;
    if (process.platform === 'win32' && /["%!^&|<>()\r\n]/.test(file)) throw new Error('Unsupported executable path.');
    const quoted = process.platform === 'win32' ? `"${file}"` : "'" + file.replace(/'/g, "'\\''") + "'";
    setupCommand = `${/\.[cm]?js$/.test(file) ? 'node ' : ''}${quoted} ${preset.loginArgs.join(' ')}`;
  }
  const folder = await mkdtemp(join(tmpdir(), 'multimind-agent-setup-'));
  const windows = process.platform === 'win32';
  const file = join(folder, windows ? 'setup.cmd' : 'setup.command');
  const script = windows
    ? `@echo off\r\necho ${preset.name}\r\ncall ${setupCommand}\r\necho Return to the app and refresh detection when finished.\r\npause\r\n`
    : `#!/bin/bash -l\nprintf '%s\\n' '${preset.name}'\n${setupCommand}\nstatus=$?\nprintf '\\n%s\\n' 'Return to the app and refresh detection when finished.'\nread -r -p 'Press Enter to close...'\nexit "$status"\n`;
  await writeFile(file, script, { mode: 0o700 });
  if (windows) {
    const error = await shell.openPath(file);
    if (error) throw new Error('Unable to open a terminal. Copy the installation command instead.');
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = process.platform === 'darwin'
        ? spawn('/usr/bin/open', ['-a', 'Terminal', file], { stdio: 'ignore', shell: false })
        : spawn('x-terminal-emulator', ['-e', '/bin/bash', file], { stdio: 'ignore', shell: false });
      child.on('error', () => reject(new Error('Unable to open a terminal. Copy the installation command instead.')));
      if (process.platform === 'darwin') child.on('close', (code) => code === 0 ? resolve() : reject(new Error('Unable to open a terminal. Copy the installation command instead.')));
      else child.on('spawn', () => resolve());
    });
  }
  return { status: 'opened' };
}
