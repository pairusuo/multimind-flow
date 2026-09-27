// A deterministic local protocol peer. Never calls a model or reads account credentials.
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('test-agent 1.0'); process.exit(0); }
if (args.includes('status') && args.includes('json')) { console.log(JSON.stringify({ logged_in: false })); process.exit(0); }
if (args.includes('status')) { console.log('Logged in using ChatGPT'); process.exit(0); }
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('app-server')) {
  let model = '';
  const threadId = 'fixture-thread';
  const notify = (method, params) => emit({ method, params: { threadId, ...params } });
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      if (!message.params.capabilities.explicitGatewayOauth) process.exit(5);
      emit({ id: message.id, result: {} });
    } else if (message.method === 'config/read') {
      emit({ id: message.id, result: { config: { model_provider: process.env.TEST_CODEX_PROVIDER || 'openai' } } });
    } else if (message.method === 'thread/start') {
      const params = message.params;
      if (params.approvalPolicy !== 'never' || params.sandbox !== 'read-only' || !params.ephemeral) process.exit(5);
      if (process.env.TEST_CODEX_PROVIDER === 'custom') {
        if (params.modelProvider || params.config) process.exit(6);
      } else {
        const transport = params.config?.['model_providers.bot_openai_https'];
        if (params.modelProvider !== 'bot_openai_https' || transport?.supports_websockets !== false || transport?.requires_openai_auth !== true || transport?.base_url || transport?.env_key) process.exit(6);
      }
      model = params.model || '';
      emit({ id: message.id, result: { thread: { id: threadId } } });
    } else if (message.method === 'turn/start') {
      if (model === 'fixture-fail') { emit({ id: message.id, error: { message: 'sensitive diagnostic' } }); return; }
      emit({ id: message.id, result: { turn: { id: 'turn' } } });
      const prompt = message.params.input[0].text;
      if (prompt.includes('WAIT_FOR_CANCEL')) return;
      if (prompt.includes('WAIT_FOR_DISPOSE')) {
        process.on('SIGTERM', () => {});
        notify('item/agentMessage/delta', { itemId: 'answer', delta: 'Ready' });
        return;
      }
      notify('turn/started', { turn: { id: 'turn' } });
      notify('item/started', { item: { id: 'thinking', type: 'reasoning' } });
      notify('item/reasoning/textDelta', { itemId: 'reasoning', delta: 'private thought' });
      notify('item/completed', { item: { id: 'tool', type: 'commandExecution', text: 'private tool output' } });
      emit({ method: 'item/agentMessage/delta', params: { threadId: 'other-thread', itemId: 'other', delta: 'private unrelated thread' } });
      notify('item/started', { item: { id: 'search', type: 'webSearch' } });
      notify('item/completed', { item: { id: 'search', type: 'webSearch' } });
      notify('item/agentMessage/delta', { itemId: 'answer', delta: 'Hello' });
      const complete = () => {
        notify('item/agentMessage/delta', { itemId: 'answer', delta: ' 世界' });
        notify('item/completed', { item: { id: 'answer', type: 'agentMessage', text: 'Hello 世界' } });
        if (model === 'fixture-partial-exit') { process.exit(1); return; }
        if (model === 'fixture-no-completion') { process.exit(0); return; }
        if (model === 'fixture-timeout') return;
        if (model === 'fixture-recovered') notify('error', { willRetry: true });
        notify('turn/completed', { turn: { id: 'turn', status: model === 'fixture-turn-failed' ? 'failed' : 'completed' } });
        if (model === 'fixture-late-exit-error') process.exit(1);
      };
      if (model === 'fixture-streaming') setTimeout(complete, 250);
      else complete();
    }
  });
} else if (args.includes('acp') || args.includes('--acp')) {
  let promptId;
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') emit({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    else if (message.method === 'session/new' && process.argv[1].includes('auth-required')) emit({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required: Authentication is required.' } });
    else if (message.method === 'session/new') emit({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'isolated-test-session', configOptions: [{ id: 'model', options: [{ group: 'deepseek-official', options: [{ name: 'DeepSeek', value: JSON.stringify(['deepseek-official', 'deepseek-test']) }] }] }] } });
    else if (message.method === 'session/set_config_option') {
      if (!args.includes('--profile') || message.params.configId !== 'model' || message.params.value !== JSON.stringify(['deepseek-official', 'deepseek-test']) || process.env.DSH_PERMISSION_MODE !== 'read-only') process.exit(7);
      emit({ id: message.id, result: {} });
    }
    else if (message.method === 'session/close') emit({ id: message.id, result: {} });
    else if (message.method === 'session/set_model') emit({ jsonrpc: '2.0', id: message.id, result: {} });
    else if (message.method === 'session/prompt') {
      promptId = message.id;
      emit({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'allow' }] } });
    } else if (message.id === 900) {
      if (message.result?.outcome?.outcome !== 'cancelled') process.exit(5);
      emit({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private thought' } } } });
      emit({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP answer' } } } });
      emit({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
    }
  });
} else {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    if (input.includes('WAIT_FOR_DISPOSE')) {
      process.on('SIGTERM', () => {});
      emit({ type: 'item.updated', item: { id: 'answer', type: 'agent_message', text: 'Ready' } });
      setInterval(() => {}, 1000);
      return;
    }
    if (input.includes('WAIT_FOR_CANCEL')) { setInterval(() => {}, 1000); return; }
    if (args.includes('fixture-fail')) { console.error('sensitive diagnostic must never be exposed'); process.exit(1); }
      if (!args.includes('--no-session-persistence') || !args.includes('--strict-mcp-config')) process.exit(4);
      emit({ type: 'assistant', message: { id: 'answer', content: [{ type: 'text', text: 'Claude answer' }, { type: 'tool_use', text: 'private tool input' }] } });
      emit({ type: 'result', is_error: false, result: 'Claude answer' });
  });
}
