import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { callLocalAgent, detectLocalAgent, resolveAgentExecutable, disposeLocalAgents, setupLocalAgent } = require('../dist/main/localAgentRuntime.js');
const { LOCAL_AGENTS, localAgent } = require('../dist/shared/botCatalog.js');
const dir = mkdtempSync(join(tmpdir(), 'multimind-agent-fixture-'));
const executable = join(dir, 'peer.js');
copyFileSync(resolve('scripts/fixtures/local-agent.cjs'), executable);
try {
  if (process.platform !== 'win32') {
    const originalShell = process.env.SHELL;
    const fakeShell = join(dir, 'login-shell');
    const agentPath = join(dir, 'codex');
    writeFileSync(agentPath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(fakeShell, `#!/bin/sh\nprintf '\\n__MULTIMIND_PATH__%s\\n' '${dir}':"$PATH"\n`, { mode: 0o700 });
    process.env.SHELL = fakeShell;
    try {
      assert.equal(await resolveAgentExecutable('codex'), agentPath, 'Detection must use the login shell PATH, including tools absent from the desktop PATH');
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
    }
  }
  const { LocalAgentDetectionCache } = require('../dist/main/localAgentDetection.js');
  const cacheFile = join(dir, 'detection.json');
  let clock = 1000000;
  let calls = 0;
  const detector = async (_agent, executable) => { calls++; return { installed: true, usable: true, executable: executable || '/fixture/codex', authenticated: true, authChecked: true, authMethod: 'subscription' }; };
  const cache = new LocalAgentDetectionCache(cacheFile, detector, () => clock);
  await Promise.all([cache.detect('codex'), cache.detect('codex')]);
  assert.equal(calls, 1, 'Concurrent detection must share one process');
  await cache.detect('codex');
  assert.equal(calls, 1, 'Reopening the editor must reuse recent results');
  assert.equal(cache.snapshot('codex').authenticated, true);
  assert.ok(!readFileSync(cacheFile, 'utf8').includes('authenticated'), 'Login state must not be persisted');
  const reopened = new LocalAgentDetectionCache(cacheFile, detector, () => clock);
  assert.equal(reopened.snapshot('codex').installed, true, 'Installation metadata survives app restart');
  assert.equal(reopened.snapshot('codex').authChecked, false);
  await reopened.detect('codex');
  assert.equal(calls, 1, 'App restart must reuse installation results without scanning');
  await reopened.detect('codex', undefined, true);
  assert.equal(calls, 2, 'Only manual refresh reruns detection');
  await reopened.detect('codex', '/custom/codex', true);
  assert.equal(calls, 3, 'Manual custom-path detection uses an independent entry');
  clock += 86400000;
  await reopened.detect('codex');
  assert.equal(calls, 3, 'Saved results never expire into an automatic scan');
  const restarted = execFileSync(process.execPath, ['-e', `
    const { LocalAgentDetectionCache } = require(process.argv[1]);
    const cache = new LocalAgentDetectionCache(process.argv[2], async () => { throw new Error('Restart must not scan'); });
    cache.detect('codex').then(result => process.stdout.write(JSON.stringify(result))).catch(() => process.exit(1));
  `, resolve('dist/main/localAgentDetection.js'), cacheFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  assert.equal(JSON.parse(restarted).installed, true, 'A fresh process restores the saved results without a detector');
  const blockedDirectory = join(dir, 'not-a-directory');
  writeFileSync(blockedDirectory, 'fixture');
  const cannotSave = new LocalAgentDetectionCache(join(blockedDirectory, 'results.json'), detector);
  await assert.rejects(cannotSave.detect('codex'), /Unable to save/);
  assert.equal(cannotSave.snapshot('codex'), undefined, 'Failed persistence must not be presented as saved results');
  assert.equal(LOCAL_AGENTS.length, 7);
  for (const agent of LOCAL_AGENTS) {
    await assert.rejects(setupLocalAgent(agent.id, 'invalid'), /Unknown setup action/);
  }
  assert.throws(() => localAgent('codex; echo injected'), /Unknown/);
  await assert.rejects(resolveAgentExecutable('codex', '/missing/agent'), /not found/);
  const login = await detectLocalAgent('codex', executable);
  assert.equal(login.installed, true);
  assert.equal(login.authenticated, true);
  assert.equal(login.authMethod, 'subscription');
  assert.equal((await setupLocalAgent('codex', 'login', executable)).status, 'authenticated'); // Existing login must not open a terminal or access credentials.
  const failedProbe = join(dir, 'failed-probe.js');
  writeFileSync(failedProbe, "process.exit(process.argv.includes('--version') ? 0 : 1);");
  assert.equal((await detectLocalAgent('codex', failedProbe)).authChecked, false);
  await assert.rejects(setupLocalAgent('codex', 'login', failedProbe), /Could not confirm login status/);
  const loggedOut = join(dir, 'logged-out.js');
  writeFileSync(loggedOut, "if (process.argv.includes('--version')) process.exit(0); console.error('Not logged in'); process.exit(1);");
  const missingLogin = await detectLocalAgent('codex', loggedOut);
  assert.equal(missingLogin.authChecked, true);
  assert.equal(missingLogin.authenticated, false);
  const claudeLoggedOut = join(dir, 'claude-logged-out.js');
  writeFileSync(claudeLoggedOut, 'console.log(JSON.stringify({ loggedIn: false }));');
  assert.equal((await detectLocalAgent('claude', claudeLoggedOut)).authenticated, false, 'A successful status command reporting loggedOut must not count as signed in');
  const unknownAuth = await detectLocalAgent('qwen', executable);
  assert.equal(unknownAuth.authChecked, false);
  assert.equal(unknownAuth.authenticated, false, 'Version detection is not proof of login');
  for (const agent of LOCAL_AGENTS) {
    const deltas = [];
    const result = await callLocalAgent({ connection: { kind: 'cli', agent: agent.id, executable }, model: '', messages: [{ role: 'user', content: 'Discuss the proposal' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta: (_delta, content) => deltas.push(content) });
    assert.equal(result.error, undefined, `${agent.id} should complete`);
    assert.equal(result.content, agent.id === 'codex' ? 'Hello 世界' : agent.id === 'claude' ? 'Claude answer' : 'ACP answer');
    assert.ok(deltas.length > 0);
    assert.ok(!JSON.stringify(result).includes('private'), 'Thought and tool output must not be shown as an answer');
  }
  process.env.TEST_CODEX_PROVIDER = 'custom';
  try {
    const custom = await callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model: '', messages: [{ role: 'user', content: 'Custom provider' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() {} });
    assert.equal(custom.error, undefined, 'Custom provider transport and authentication must remain unchanged');
  } finally { delete process.env.TEST_CODEX_PROVIDER; }
  const qoderEntry = join(dir, 'qodercn-npm-dispatcher.cjs');
  copyFileSync(executable, qoderEntry);
  const qoderStatus = await detectLocalAgent('qodercn', qoderEntry);
  assert.equal(qoderStatus.usable, true, 'Qoder npm dispatcher must run through Node');
  assert.equal(qoderStatus.authChecked, true);
  assert.equal(qoderStatus.authenticated, false, 'A successful status command reporting logged_in false is not a login');
  const signedInQoder = join(dir, 'signed-in-qoder.cjs');
  writeFileSync(signedInQoder, "console.log(process.argv.includes('--version') ? '1.1.64' : JSON.stringify({ logged_in: true }));");
  assert.equal((await setupLocalAgent('qodercn', 'login', signedInQoder)).status, 'authenticated', 'Existing Qoder login must not open a login terminal');
  const authRequiredEntry = join(dir, 'auth-required.cjs');
  copyFileSync(executable, authRequiredEntry);
  try {
    const denied = await callLocalAgent({ connection: { kind: 'cli', agent: 'qodercn', executable: authRequiredEntry }, model: '', messages: [{ role: 'user', content: 'Discuss' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() {} });
    assert.equal(denied.error, 'LOCAL_AGENT_AUTH_REQUIRED');
  } finally { /* Isolated protocol fixture does not access login state. */ }
  assert.equal(localAgent('dsh').name, 'DeepSeek Harness');
  assert.deepEqual(localAgent('dsh').acpArgs, ['--profile', 'acp']);
  const dshReply = await callLocalAgent({ connection: { kind: 'cli', agent: 'dsh', executable }, model: 'deepseek-test', messages: [{ role: 'user', content: 'Discuss' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() {} });
  assert.equal(dshReply.content, 'ACP answer');
  assert.equal(dshReply.error, undefined);
  const { botGuideUrl } = require('../dist/shared/botCatalog.js');
  assert.equal(botGuideUrl('deepseek'), 'https://platform.deepseek.com');
  assert.throws(() => botGuideUrl('file:///etc/passwd'), /Unknown/);
  const qoderReply = await callLocalAgent({ connection: { kind: 'cli', agent: 'qodercn', executable: qoderEntry }, model: 'qoder-model', messages: [{ role: 'user', content: 'Discuss' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() {} });
  assert.equal(qoderReply.content, 'ACP answer');
  assert.equal(qoderReply.error, undefined);
  const failed = await callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model: 'fixture-fail', messages: [{ role: 'user', content: 'fail' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() {} });
  assert.ok(failed.error);
  assert.ok(!failed.error.includes('sensitive diagnostic'));
  const scenario = (model, timeoutMs = 3000) => callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model, messages: [{ role: 'user', content: 'Protocol completion test' }], signal: new AbortController().signal, timeoutMs, onDelta() {} });
  for (const model of ['fixture-recovered', 'fixture-delayed-exit', 'fixture-late-exit-error']) {
    const result = await scenario(model);
    assert.equal(result.error, undefined, `${model}: completed turn must remain successful`);
    assert.equal(result.content, 'Hello 世界');
    assert.ok(result.elapsedMs < 2500, 'Completion must not wait for process cleanup or the request timeout');
  }
  for (const [model, expected] of [['fixture-partial-exit', 'LOCAL_AGENT_EXITED'], ['fixture-no-completion', 'LOCAL_AGENT_INCOMPLETE'], ['fixture-turn-failed', 'LOCAL_AGENT_TURN_FAILED'], ['fixture-timeout', 'LOCAL_AGENT_TIMEOUT']]) {
    const result = await scenario(model, model === 'fixture-timeout' ? 600 : 3000);
    assert.ok(result.error?.startsWith(expected), `${model}: ${result.error}`);
    assert.equal(result.content, 'Hello 世界', 'Failures must preserve received answers');
    assert.ok(!result.error.includes('sensitive'), 'Protocol diagnostics must not leak');
  }
  const chunks = [];
  const activities = [];
  const streamed = await callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model: 'fixture-streaming', onActivity: activity => activities.push(activity), messages: [{ role: 'user', content: 'Stream the answer' }], signal: new AbortController().signal, timeoutMs: 3000, onDelta: (_delta, content) => chunks.push({ content, at: Date.now() }) });
  assert.equal(streamed.error, undefined);
  assert.ok(activities.includes('connecting') && activities.includes('thinking') && activities.includes('searching') && activities.at(-1) === 'answering', 'Real protocol events must report progress before and during answer text');
  assert.equal(chunks[0].content, 'Hello', 'First text must arrive before the complete message');
  assert.equal(chunks.at(-1).content, 'Hello 世界');
  assert.ok(chunks.at(-1).at - chunks[0].at >= 150, 'Text must be visible while the agent is still producing the message');
  assert.equal(chunks.length, 2, 'Final message must not duplicate streamed text');
  const controller = new AbortController();
  const run = callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model: '', messages: [{ role: 'user', content: 'WAIT_FOR_CANCEL' }], signal: controller.signal, timeoutMs: 5000, onDelta() {} });
  setTimeout(() => controller.abort(), 100);
  const stopped = await run;
  assert.ok(stopped.elapsedMs < 3000);
  assert.ok(stopped.error);
  const disposed = await callLocalAgent({ connection: { kind: 'cli', agent: 'codex', executable }, model: '', messages: [{ role: 'user', content: 'WAIT_FOR_DISPOSE' }], signal: new AbortController().signal, timeoutMs: 5000, onDelta() { disposeLocalAgents(); } });
  assert.equal(disposed.content, 'Ready');
  assert.ok(disposed.error);
  assert.ok(disposed.elapsedMs < 1500, 'Quit must immediately stop agents that ignore SIGTERM');
  console.log('Local agent detection, Codex/Claude/ACP protocols, permission denial, output filtering and cancellation tests passed.');
} finally { rmSync(dir, { recursive: true, force: true }); }
