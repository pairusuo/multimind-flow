import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const electronPath = require.resolve('electron');
const originalElectron = require('electron');
require.cache[electronPath].exports = { safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text),
  decryptString: (buffer) => buffer.toString(),
} };
const apiModule = require('../dist/main/apiConversationService.js');
const { ConversationStore } = require('../dist/main/conversationStore.js');
const { ConversationService } = require('../dist/main/conversationService.js');
const Database = require('better-sqlite3');
const originalFetch = globalThis.fetch;
const originalCall = apiModule.callChatCompletion;
const directory = mkdtempSync(join(tmpdir(), 'multimind-conversation-test-'));
let store;
let service;
try {
  // No real network, credentials or user database is used in this suite.
  let saved = { baseUrl: 'https://old.example/v1', apiKey: 'test-only-key', apiKeyEncrypted: false, models: ['a'], allModels: ['a'] };
  const config = new apiModule.ApiConversationService({ get: () => saved, set: (_key, value) => { saved = value; } });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  await config.saveConfig({ baseUrl: 'https://old.example/v1/', apiKey: '' });
  assert.equal(requests.at(-1).authorization, 'Bearer test-only-key', 'Unchanged normalized address retains its key');
  await config.saveConfig({ baseUrl: 'https://new.example/v1', apiKey: '' });
  assert.ok(!requests.at(-1).authorization, 'Address change never forwards an old key');
  assert.equal(config.getCredentials().apiKey, '');
  assert.equal(config.getConfig().apiKeyConfigured, false);
  assert.deepEqual(config.getConfig().allModels, [], 'Old model discovery is invalidated');
  // Explicit replacement key is user authorization for the new address.
  await config.saveConfig({ baseUrl: 'https://third.example/v1', apiKey: 'new-test-key' });
  assert.equal(requests.at(-1).authorization, 'Bearer new-test-key');

  const dbPath = join(directory, 'test.sqlite');
  store = new ConversationStore(dbPath);
  let baseUrl = 'https://provider.example/v1';
  const fakeApi = { getConfig: () => ({ baseUrl }), getCredentials: () => ({ baseUrl, apiKey: 'never-persist-this-key' }) };
  service = new ConversationService(store, fakeApi);
  const connection = { kind: 'api', baseUrl };
  const apiKey = 'never-persist-this-key';
  assert.throws(() => service.createBot({ name: 'Unconfigured', model: 'a' }), /Configure this Bot/);
  assert.throws(() => service.createBot({ name: 'Global', model: 'a', connection: { kind: 'legacy-api' } }), /Configure this Bot/);
  const a = service.createBot({ connection, apiKey, name: 'A', model: 'model-a', rolePrompt: 'Original role' });
  const probeCalls = [];
  apiModule.callChatCompletion = async params => { probeCalls.push(params); return { content: 'OK', elapsedMs: 1 }; };
  assert.equal((await service.testBotApi({ baseUrl, model: 'a', apiKey: 'draft-key' })).status, 'success');
  assert.equal((await service.testBotApi({ baseUrl, model: 'a', botId: a.id })).status, 'success');
  assert.equal(probeCalls.at(-1).apiKey, apiKey);
  apiModule.callChatCompletion = async params => { probeCalls.push(params); return { content: '', elapsedMs: 1 }; };
  assert.equal((await service.testBotApi({ baseUrl, model: 'reasoning-model', apiKey: 'draft-key' })).status, 'success', 'A successful reasoning request may use its small test budget without visible text');
  assert.equal((await service.testBotApi({ baseUrl: 'https://other.example', model: 'a', botId: a.id })).status, 'invalid');
  assert.equal(probeCalls.length, 3, 'Saved key never sent to a changed address');
  assert.equal(store.listBots().length, 1, 'Testing does not create a bot');
  for (const [error, status] of [['HTTP 401', 'auth'], ['insufficient quota', 'credits'], ['model not found', 'model'], ['operation aborted', 'timeout'], ['fetch failed', 'network']]) {
    apiModule.callChatCompletion = async () => ({ content: '', error, elapsedMs: 1 });
    assert.deepEqual(await service.testBotApi({ baseUrl, model: 'a', apiKey: 'draft-key' }), { status });
  }
  apiModule.callChatCompletion = originalCall;
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  service.updateBot({ id: a.id, avatar });
  assert.throws(() => service.updateBot({ id: a.id, avatar: 'https://untrusted.example/avatar.svg' }), /Invalid Bot avatar/);
  const b = service.createBot({ connection, apiKey, name: 'B', model: 'model-b' });
  const conversation = service.createConversation({ botIds: [a.id, b.id] });
  assert.equal(conversation.members[0].avatar, avatar);
  assert.equal(service.listConversations().find(item => item.id === conversation.id).lastMessage, null, 'Empty conversation is explicitly marked empty');
  const events = [];
  let listeners = 0;
  const sender = { once: () => { listeners++; }, isDestroyed: () => false, send: (channel, payload) => events.push({ channel, payload }) };
  const waiting = [];
  apiModule.callChatCompletion = (params) => new Promise((resolve) => waiting.push({ params, resolve }));
  const pending = service.sendMessage({ conversationId: conversation.id, content: 'Question' }, sender);
  assert.equal(waiting.length, 2, 'All members start concurrently');
  const started = events[0].payload;
  assert.equal(started.status, 'running');
  assert.deepEqual(started.conversation.messages.map((m) => m.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(started.conversation.messages.slice(1).map((m) => m.botId), [a.id, b.id]);
  waiting[0].params.onDelta('partial', 'partial');
  const delta = events.at(-1).payload;
  assert.ok(started.conversation.messages.some((m) => m.id === delta.messageId), 'A placeholder precedes every delta');
  assert.deepEqual(waiting[0].params.messages[1], waiting[1].params.messages[1], 'Concurrent requests use identical history');
  waiting[1].resolve({ content: 'B reply', elapsedMs: 1 });
  waiting[0].resolve({ content: 'A reply', elapsedMs: 1 });
  await pending;
  assert.equal(service.getConversation(conversation.id).runningRoundId, null);

  // Conversations are independent of the four-pane browser layout.
  const extraBots = Array.from({ length: 5 }, (_, index) => service.createBot({ connection, apiKey, name: `Extra ${index}`, model: `extra-${index}` }));
  assert.throws(() => service.createConversation({ botIds: [] }), /At least one/);
  const large = service.createConversation({ botIds: [a.id, b.id, ...extraBots.slice(0, 4).map((bot) => bot.id)] });
  assert.equal(large.members.length, 6, 'Creation accepts more than four members');
  const expanded = service.addConversationMembers({ conversationId: large.id, botIds: [extraBots[4].id] });
  assert.equal(expanded.members.length, 7, 'Existing large conversations can add members');
  waiting.length = 0;
  const largeRound = service.sendMessage({ conversationId: large.id, content: 'Everyone answer' }, sender);
  assert.equal(waiting.length, 7, 'Every member starts before any answer completes');
  for (const request of waiting) request.resolve({ content: 'Answer', elapsedMs: 1 });
  await largeRound;
  assert.equal(service.getConversation(large.id).messages.filter((message) => message.role === 'assistant').length, 7);

  // Summary and review retry use exact persisted request inputs, including after restart.
  let originalRequest;
  apiModule.callChatCompletion = async (params) => { originalRequest = params; return { content: 'partial', error: 'test failure', elapsedMs: 1 }; };
  await service.requestSummary({ conversationId: conversation.id, botId: a.id }, sender);
  const failed = store.listMessages(conversation.id).at(-1);
  assert.equal(listeners, 1, 'Event target registration is idempotent');
  service.updateConversationMember({ conversationId: conversation.id, botId: a.id, model: 'unrelated-provider-model', rolePrompt: 'Changed role' });
  assert.equal(service.getConversation(conversation.id).members[0].model, 'model-a', 'Member edits must never override the Bot model');
  service.updateConversation({ id: conversation.id, title: 'My group', avatar });
  assert.throws(() => service.updateConversation({ id: conversation.id, avatar: 'https://external.invalid/avatar' }), /avatar/i);
  service.dispose();
  store.close();
  store = new ConversationStore(dbPath);
  service = new ConversationService(store, fakeApi);
  assert.equal(service.getConversation(conversation.id).avatar, avatar, 'Group avatar survives reopening');
  assert.equal(service.getConversation(conversation.id).title, 'My group');
  assert.equal(service.listConversations().find(item => item.id === conversation.id).lastMessage.content, 'partial');
  assert.equal(service.listBots().find((bot) => bot.id === a.id).avatar, avatar, 'Bot avatar survives reopening the database');
  assert.equal(service.getConversation(conversation.id).members[0].avatar, avatar, 'Member avatar survives reopening the database');
  service.updateBot({ id: a.id, avatar: '' });
  assert.equal(service.listBots().find((bot) => bot.id === a.id).avatar, '', 'Default avatar can be restored');
  let calls = 0;
  apiModule.callChatCompletion = async (params) => {
    calls++;
    assert.equal(params.model, 'model-a');
    assert.deepEqual(params.messages, originalRequest.messages);
    return { content: 'summary success', elapsedMs: 1 };
  };
  await service.retryMember({ conversationId: conversation.id, botId: a.id, messageId: failed.id });
  assert.equal(calls, 1);
  assert.equal(store.listMessages(conversation.id).at(-1).messageType, 'summary');
  await assert.rejects(service.retryMember({ conversationId: conversation.id, botId: a.id, messageId: failed.id }), /already been retried/);
  const successful = store.listMessages(conversation.id).at(-1);
  await assert.rejects(service.retryMember({ conversationId: conversation.id, botId: a.id, messageId: successful.id }), /failed response/);
  assert.equal(calls, 1, 'Invalid retries never make a paid request');

  const reviewRequests = new Map();
  apiModule.callChatCompletion = async (params) => { reviewRequests.set(params.model, params.messages); return { content: '', error: 'review failed', elapsedMs: 1 }; };
  await service.requestReview({ conversationId: conversation.id });
  const failedReview = store.listMessages(conversation.id).at(-1);
  baseUrl = 'https://different.example/v1';
  assert.equal(service.getConversationState().apiKeyConfigured, false, 'Global credentials are not part of Bot state');
  baseUrl = 'https://provider.example/v1';
  apiModule.callChatCompletion = async (params) => {
    assert.deepEqual(params.messages, reviewRequests.get(params.model));
    return { content: 'review success', elapsedMs: 1 };
  };
  await service.retryMember({ conversationId: conversation.id, botId: failedReview.botId, messageId: failedReview.id });
  assert.equal(store.listMessages(conversation.id).at(-1).messageType, 'review');
  await assert.rejects(service.retryMember({ conversationId: conversation.id, botId: a.id, messageId: failed.id }), /latest round/);

  // A throwing provider fails only its own member and never leaves the round running.
  apiModule.callChatCompletion = async (params) => {
    if (params.model === 'model-b') throw new Error('provider exploded');
    return { content: 'still successful', elapsedMs: 1 };
  };
  await service.sendMessage({ conversationId: conversation.id, content: 'Independent failure' });
  assert.deepEqual(store.listMessages(conversation.id).slice(-2).map((m) => m.status), ['completed', 'failed']);
  assert.equal(service.getConversation(conversation.id).runningRoundId, null);

  // Independent local and API bots share a conversation without a global API credential.
  const localModule = require('../dist/main/localAgentRuntime.js');
  const originalLocal = localModule.callLocalAgent;
  const mixedService = new ConversationService(store, { getCredentials: () => { throw new Error('Global credential must not be used'); } });
  try {
    const cliBot = mixedService.createBot({ name: 'Local Codex', model: '', connection: { kind: 'cli', agent: 'codex' } });
    const apiBot = mixedService.createBot({ name: 'Custom model', model: 'custom-chat', connection: { kind: 'api', baseUrl: 'https://custom.example/v1', maxOutputTokens: 512 }, apiKey: 'custom-only-key' });
    assert.ok(!JSON.stringify(mixedService.listBots()).includes('custom-only-key'));
    assert.throws(() => mixedService.updateBot({ id: apiBot.id, connection: { kind: 'api', baseUrl: 'https://another.example/v1' } }), /Enter an API key/);
    const mixed = mixedService.createConversation({ botIds: [cliBot.id, apiBot.id] });
    let localCalls = 0;
    localModule.callLocalAgent = async (request) => {
      localCalls++;
      assert.equal(request.connection.agent, 'codex');
      assert.equal(request.apiKey, '', 'API credentials are never injected into a local runtime');
      return { content: 'local reply', elapsedMs: 1 };
    };
    apiModule.callChatCompletion = async (request) => {
      assert.equal(request.baseUrl, 'https://custom.example/v1');
      assert.equal(request.apiKey, 'custom-only-key');
      assert.equal(request.model, 'custom-chat');
      assert.equal(request.maxOutputTokens, 512, 'Existing conversation retains its output limit');
      return { content: '', elapsedMs: 1, error: 'Incorrect API key provided' };
    };
    await mixedService.sendMessage({ conversationId: mixed.id, content: 'Test authentication' });
    const rejectedKeyMessage = store.listMessages(mixed.id).find(message => message.botId === apiBot.id && message.status === 'failed');
    assert.ok(rejectedKeyMessage);
    const refreshed = mixedService.updateBot({ id: apiBot.id, apiKey: 'corrected-key' });
    assert.equal(refreshed.connection.credentialId, apiBot.connection.credentialId, 'Same-address key updates must reach existing conversations');
    apiModule.callChatCompletion = async (request) => {
      assert.equal(request.baseUrl, 'https://custom.example/v1');
      assert.equal(request.apiKey, 'corrected-key', 'Existing conversation must use the corrected key');
      assert.equal(request.model, 'custom-chat');
      assert.equal(request.maxOutputTokens, 512);
      return { content: 'API reply', elapsedMs: 1 };
    };
    await mixedService.retryMember({ conversationId: mixed.id, botId: apiBot.id, messageId: rejectedKeyMessage.id });
    assert.equal(store.listMessages(mixed.id).at(-1).status, 'completed', 'Retry must succeed with corrected credentials');
    localCalls = 0;
    // Editing a template does not redirect existing members to another service.
    mixedService.updateBot({ id: apiBot.id, connection: { kind: 'api', baseUrl: 'https://another.example/v1' }, apiKey: 'another-key' });
    await mixedService.sendMessage({ conversationId: mixed.id, content: 'Discuss together' });
    assert.equal(localCalls, 1);
    assert.deepEqual(store.listMessages(mixed.id).slice(-2).map((message) => message.botSnapshotSource), ['Codex CLI', 'https://custom.example/v1']);
    assert.ok(!JSON.stringify(mixedService.getConversation(mixed.id)).includes('custom-only-key'));
  } finally { localModule.callLocalAgent = originalLocal; mixedService.dispose(); }

  // Deletion/disposal ignores both late stream chunks and final results.
  waiting.length = 0;
  apiModule.callChatCompletion = (params) => new Promise((resolve) => waiting.push({ params, resolve }));
  const late = service.sendMessage({ conversationId: conversation.id, content: 'Delete during response' }, sender);
  service.deleteConversation(conversation.id);
  const eventCount = events.length;
  for (const request of waiting) {
    assert.equal(request.params.signal.aborted, true);
    request.params.onDelta('late', 'late');
    request.resolve({ content: 'late', elapsedMs: 1 });
  }
  await late;
  assert.equal(events.length, eventCount);
  assert.equal(store.getConversation(conversation.id), null);

  const ordered = service.createConversation({ botIds: [a.id] });
  const realNow = Date.now;
  try {
    Date.now = () => 1000;
    const common = { conversationId: ordered.id, roundId: 'round-1', botSnapshotName: '', botSnapshotModel: '', status: 'completed', messageType: 'normal' };
    store.insertMessage({ ...common, id: 'z', botId: null, role: 'user', content: 'first' });
    store.insertMessage({ ...common, id: 'a', botId: a.id, role: 'assistant', content: 'second' });
    store.insertMessage({ ...common, id: 'b', roundId: 'round-2', botId: null, role: 'user', content: 'third' });
  } finally { Date.now = realNow; }
  assert.deepEqual(store.listMessages(ordered.id).map((m) => m.id), ['z', 'a', 'b']);
  assert.equal(store.getLatestRoundId(ordered.id), 'round-2');
  // Snapshot storage is private to main process and contains no credential.
  assert.ok(!JSON.stringify(service.getConversation(ordered.id)).includes('request_snapshot'));
  service.dispose();
  store.close();
  store = null;
  const db = new Database(dbPath);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE request_snapshot LIKE '%never-persist-this-key%'").get().n, 0);
  // Emulate the pre-migration schema and verify opening it migrates without deleting history.
  db.exec('DROP INDEX idx_conversation_message_sequence; ALTER TABLE conversation_messages DROP COLUMN sequence; ALTER TABLE conversation_messages DROP COLUMN request_snapshot;');
  db.close();
  store = new ConversationStore(dbPath);
  assert.deepEqual(store.listMessages(ordered.id).map((m) => m.id), ['z', 'a', 'b']);
  console.log('Conversation service, credentials, retry persistence, lifecycle and migration tests passed.');
} finally {
  service?.dispose();
  store?.close();
  require.cache[electronPath].exports = originalElectron;
  globalThis.fetch = originalFetch;
  apiModule.callChatCompletion = originalCall;
  rmSync(directory, { recursive: true, force: true });
}
