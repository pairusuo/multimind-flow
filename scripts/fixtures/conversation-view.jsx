import '../../src/renderer/styles.css';
import '../../src/renderer/workspace-polish.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import CellConfigPanel from '../../src/renderer/components/CellConfigPanel';
import AgentAuthHelp from '../../src/renderer/components/AgentAuthHelp';
import AppSelect from '../../src/renderer/components/AppSelect';
import ConversationView from '../../src/renderer/components/ConversationView';
import { API_BOT_PRESETS } from '../../src/shared/botCatalog';
import i18n from '../../src/renderer/i18n';

const copy = (value) => structuredClone(value);
const conversations = new Map(['A', 'B'].map((id) => [id, {
  id, title: `Conversation ${id}`, createdAt: 1, lastActivityAt: 1, runningRoundId: null,
  members: [{ conversationId: id, botId: 'bot', name: 'Bot', model: 'test-model', rolePrompt: '', position: 0 }], messages: [],
}]));
let onDelta;
let onStatus;
let deferredRead;
const pending = new Map();
const sent = [];
const createdBots = [];
const setupCalls = [];
const installedAgents = new Set(['codex']);
const detectionResults = {};
let detectionCalls = 0;
let autoCheckUpdates = false;
let resolveApiTest;
window.electronAPI = {
  testBotApi: () => new Promise(resolve => { resolveApiTest = resolve; }),
  appUpdate: async (action) => { if (action === 'enable-auto-check') autoCheckUpdates = true; if (action === 'disable-auto-check') autoCheckUpdates = false; return { status: 'current', canInstall: false, autoCheck: autoCheckUpdates }; },
  openConversationLink: async () => {},
  getAppVersion: async () => 'test',
  updateConversation: async ({ id, ...patch }) => { Object.assign(conversations.get(id), patch); return copy(conversations.get(id)); },
  getLocalAgentCache: async () => copy(detectionResults),
  detectLocalAgent: async (agent) => { detectionCalls++; const result = { installed: installedAgents.has(agent), usable: true, authenticated: agent === 'codex', authChecked: agent === 'codex', authMethod: agent === 'codex' ? 'subscription' : 'unknown' }; detectionResults[agent] = result; return result; },
  openBotGuide: async (key) => { window.lastGuideLink = key; },
  setupLocalAgent: async (agent, action) => { setupCalls.push({ agent, action }); return action === 'login' && agent === 'claude' ? { status: 'authenticated', agentStatus: { installed: true, usable: true, authenticated: true, authChecked: true, authMethod: 'subscription' } } : { status: 'opened' }; },
  createBot: async (payload) => { const bot = { ...payload, id: `created-${createdBots.length}` }; createdBots.push(bot); return bot; },
  addConversationMembers: async ({ conversationId, botIds }) => {
    const conversation = conversations.get(conversationId);
    for (const id of botIds) {
      if (!conversation.members.some((member) => member.botId === id)) conversation.members.push({ ...createdBots.find((bot) => bot.id === id), botId: id });
    }
    return copy(conversation);
  },
  createConversation: async ({ title, botIds }) => {
    const conversation = { id: 'created-conversation', title: title || 'New conversation', createdAt: 1, lastActivityAt: 1, runningRoundId: null, messages: [], members: botIds.map((id, position) => ({ ...createdBots.find((bot) => bot.id === id), botId: id, conversationId: 'created-conversation', position })) };
    conversations.set(conversation.id, conversation); return copy(conversation);
  },
  getConversationState: async () => ({ bots: createdBots.map(({ apiKey, ...bot }) => bot), conversations: [...conversations.values()], cellsMigrated: true, legacyCellModels: {}, apiKeyConfigured: false }),
  getConversation: async (id) => {
    const snapshot = copy(conversations.get(id));
    if (deferredRead?.id === id) return new Promise((resolve) => { deferredRead.resolve = () => resolve(snapshot); });
    return snapshot;
  },
  onConversationMessageDelta: (callback) => { onDelta = callback; return () => { onDelta = null; }; },
  onConversationRoundStatus: (callback) => { onStatus = callback; return () => { onStatus = null; }; },
  sendConversationMessage: (payload) => {
    sent.push(payload);
    const conversation = conversations.get(payload.conversationId);
    conversation.runningRoundId = `round-${conversation.id}`;
    conversation.messages.push(
      { id: `user-${conversation.id}`, conversationId: conversation.id, roundId: conversation.runningRoundId, role: 'user', content: payload.content, status: 'completed', messageType: 'normal', createdAt: 1 },
      ...conversation.members.filter(member => !payload.botIds || payload.botIds.includes(member.botId)).map((member) => ({ id: `answer-${conversation.id}-${member.botId}`, conversationId: conversation.id, roundId: conversation.runningRoundId, botId: member.botId, botSnapshotName: member.name, botSnapshotModel: member.model, role: 'assistant', content: '', status: 'streaming', messageType: 'normal', createdAt: 1 })),
    );
    onStatus({ conversationId: conversation.id, roundId: conversation.runningRoundId, status: 'running', conversation: copy(conversation) });
    return new Promise((resolve) => pending.set(conversation.id, resolve));
  },
};
const config = { baseUrl: 'https://test.example/v1', models: ['test-model'], allModels: ['test-model'], apiKeyConfigured: false };
const root = createRoot(document.getElementById('root'));
root.render(<ConversationView apiConfig={config} language="en" onOpenSettings={() => {}} />);

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function check(condition, message) { if (!condition) throw new Error(message); }
async function until(predicate, message) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); }
  throw new Error(message);
}
const title = () => document.querySelector('.bot-chat-header h2')?.textContent;
const input = () => document.querySelector('textarea');
function fill(value) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
}
function select(id) {
  [...document.querySelectorAll('.bot-chat-conversation-item')].find((element) => element.textContent.includes(`Conversation ${id}`)).click();
}
function send() { document.querySelector('.bot-chat-composer-buttons .bot-chat-primary-button').click(); }
function complete(id) {
  const conversation = conversations.get(id);
  const roundId = conversation.runningRoundId;
  conversation.runningRoundId = null;
  for (const message of conversation.messages.filter((message) => message.roundId === roundId && message.role === 'assistant')) { message.status = 'completed'; message.content = `Completed ${id}: ${message.botSnapshotName}`; }
  onStatus({ conversationId: id, roundId, status: 'completed', conversation: copy(conversation) });
  pending.get(id)(copy(conversation));
}
window.runConversationViewTests = async () => {
  const authHost = document.createElement('div'); document.body.append(authHost);
  const authRoot = createRoot(authHost);
  const authCases = [['Codex CLI', 'codex', 'codex login'], ['Claude Code', 'claude', 'claude auth login'], ['Gemini CLI', 'gemini', 'gemini'], ['Qwen Code', 'qwen', 'qwen'], ['Kimi Code CLI', 'kimi', 'kimi login'], ['Qoder CN CLI', 'qodercn', 'qodercn login'], ['DeepSeek Harness', 'dsh', 'dsh web']];
  for (const [source, id, command] of authCases) {
    authRoot.render(<AgentAuthHelp key={id} source={source} connection={{ kind: 'cli', agent: 'codex' }} />);
    await until(() => authHost.querySelector('code')?.textContent === command, 'Wrong auth command for ' + source);
    check(setupCalls.length === 0, 'Rendering help must never launch authentication');
    authHost.querySelector('button').click();
    await until(() => setupCalls.length === 1, 'Auth action did not run');
    check(setupCalls[0].agent === id && setupCalls[0].action === 'login', 'Must open the failed Agent, not another Bot');
    await tick(); setupCalls.length = 0;
  }
  authRoot.render(<AgentAuthHelp key="unknown" source="Unknown source" connection={{ kind: 'cli', agent: 'codex' }} />);
  await tick(); check(!authHost.querySelector('code'), 'Unknown snapshot must not suggest the current Bot login');
  authRoot.unmount(); authHost.remove();

  const settingsHost = document.createElement('div');
  document.body.append(settingsHost);
  const settingsRoot = createRoot(settingsHost);
  let settingsSaved = false;
  const noop = () => {};
  settingsRoot.render(<CellConfigPanel cellUrls={{}} cellModes={{}} searchUrlTemplates={{}} language="en" conversationEntryMode="api" forwardControlsEnabled={false} layoutMode="single" themeMode="system" onClose={noop} onLayoutChange={noop} onLanguageChange={noop} onConversationEntryModeChange={noop} onForwardControlsEnabledChange={noop} onThemeModeChange={noop} onOpenMemory={noop} onSave={() => { settingsSaved = true; }} />);
  await until(() => settingsHost.querySelector('form'), 'Settings did not render');
  const updateCheckbox = settingsHost.querySelector('.app-update-preference input');
  check(updateCheckbox && !updateCheckbox.checked, 'Auto update check defaults off');
  updateCheckbox.click(); await until(() => autoCheckUpdates && updateCheckbox.checked, 'Enable preference did not save');
  updateCheckbox.click(); await until(() => !autoCheckUpdates && !updateCheckbox.checked, 'Disable preference did not save');
  check(!settingsHost.querySelector('input[type="password"]'), 'Settings must not expose a global API key');
  check(!settingsHost.textContent.includes('API Key'), 'Settings must not display global API configuration');
  settingsHost.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(settingsSaved, 'Settings must save without global API configuration');
  settingsRoot.unmount(); settingsHost.remove();
  const selectHost = document.createElement('div');
  selectHost.style.cssText = 'position:fixed;bottom:8px;left:12px;width:260px;z-index:20000';
  document.body.append(selectHost);
  const selectRoot = createRoot(selectHost);
  let selection = '';
  selectRoot.render(<AppSelect hideLabel label="Grouped options" value="0" options={Array.from({ length: 12 }, (_, index) => ({ value: String(index), label: `Option ${index}`, group: index < 6 ? 'First group' : 'Second group' }))} onChange={value => { selection = value; }} />);
  await tick();
  const groupedTrigger = selectHost.querySelector('[role=combobox]');
  groupedTrigger.focus(); groupedTrigger.click(); await tick();
  const groupedMenu = document.querySelector('.app-select-options');
  check(groupedMenu.querySelectorAll('.app-select-group').length === 2, 'Grouped selects must preserve headings');
  check(groupedMenu.getBoundingClientRect().bottom <= groupedTrigger.getBoundingClientRect().top, 'Menu must open above a field near the viewport bottom');
  groupedTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await tick();
  check(document.querySelector('.app-select-options'), 'Scrolling the active option into view must keep menu open');
  groupedTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
  check(selection === '11' && !document.querySelector('.app-select-options'), 'Keyboard selection must skip group headings and close menu');
  selectRoot.unmount(); selectHost.remove();
  await i18n.changeLanguage('en');
  await until(() => title() === 'Conversation A', 'Initial conversation did not load');
  const groupName = document.querySelector('#group-name');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(groupName, 'Renamed group');
  groupName.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  document.querySelector('.bot-group-name-editor button').click();
  await until(() => title() === 'Renamed group', 'Group name did not update');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(groupName, 'Conversation A');
  groupName.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  document.querySelector('.bot-group-name-editor button').click();
  await until(() => title() === 'Conversation A', 'Group name did not restore');
  document.querySelector('.bot-group-details header button').click(); await tick();
  check(!document.querySelector('.bot-group-details'), 'Details must collapse without leaving chat');
  document.querySelector('.bot-group-details-toggle').click(); await tick();
  check(document.querySelector('.bot-group-details'), 'Details must reopen');
  select('A'); await tick();
  check(title() === 'Conversation A', 'Selecting the active conversation must not clear its content');
  fill('@'); await tick();
  check(document.querySelector('.bot-mention-options'), 'Typing @ must show members');
  document.querySelector('.bot-mention-options button:last-child').click(); await tick();
  check(input().value === '@Bot ', 'Selecting a mention must insert the member name');
  fill('@Unknown question'); await tick(); send(); await tick();
  check(document.body.textContent.includes(i18n.t('botChat.coordination.invalidMention')), 'Unknown mentions must not broadcast');
  check(sent.length === 0, 'Unknown mentions must make no request');
  fill('Question A');
  await tick();
  send();
  await until(() => pending.has('A'), 'Send did not start');
  onDelta({ conversationId: 'A', messageId: 'answer-A-bot', content: '', done: false, activity: 'searching' });
  await tick();
  check(document.querySelector('.bot-chat-member-bubble-content').textContent === i18n.t('botChat.activity.searching'), 'Progress must replace waiting before the first answer token');
  onDelta({ conversationId: 'A', roundId: 'round-A', messageId: 'answer-A-bot', botId: 'bot', content: '**Live streamed answer**', done: false });
  await until(() => document.body.textContent.includes('Live streamed answer'), 'Streaming was not visible before completion');
  check(document.querySelector('.bot-chat-member-bubble-content strong')?.textContent === 'Live streamed answer', 'Streamed Markdown must render as formatted text');
  check(pending.has('A'), 'Request should remain in progress');
  select('B');
  await until(() => title() === 'Conversation B', 'B did not load');
  fill('Draft B');
  await tick();
  complete('A');
  await tick();
  check(title() === 'Conversation B', 'Background A replaced the B view');
  check(input().value === 'Draft B', 'Background A erased B draft');
  check(!document.querySelector('.bot-chat-composer-buttons .bot-chat-primary-button').disabled, 'Background request blocked B');
  select('A');
  await until(() => title() === 'Conversation A', 'A did not reload');
  select('B');
  await until(() => title() === 'Conversation B', 'B did not reload');
  check(input().value === 'Draft B', 'Draft did not survive switching');
  send();
  await until(() => pending.has('B'), 'B send did not start');
  check(sent.at(-1).conversationId === 'B' && sent.at(-1).content === 'Draft B', 'Send targeted the wrong conversation');
  check(input().value === '', 'B sent text must clear while generating');
  fill('Next question'); await tick();
  complete('B');
  await tick();
  check(input().value === 'Next question', 'Completion must preserve a new draft');
  check(document.querySelector('.bot-chat-conversation-item.active .bot-chat-conversation-item-meta').textContent !== i18n.t('botChat.transcript.empty'), 'Existing messages must not show the empty conversation hint when summary is absent');
  const originalSend = window.electronAPI.sendConversationMessage;
  window.electronAPI.sendConversationMessage = async () => { throw new Error('Fixture send failure'); };
  fill('Keep this failed question'); await tick(); send();
  await until(() => document.body.textContent.includes('Fixture send failure'), 'Send rejection was not reported');
  check(input().value === 'Keep this failed question', 'Rejected send must restore the question');
  window.electronAPI.sendConversationMessage = originalSend;
  // A slow read arriving after selecting B must never replace B.
  deferredRead = { id: 'A' };
  select('A');
  await until(() => deferredRead.resolve, 'Deferred A read did not start');
  select('A'); await tick();
  select('B');
  await until(() => title() === 'Conversation B', 'B selection did not win');
  deferredRead.resolve();
  await tick();
  check(title() === 'Conversation B', 'Stale A read replaced B');
  const clickText = (text) => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === text);
    check(button, `Missing button: ${text}`); button.click();
  };
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Direct creation did not open');
  check(document.querySelector('.bot-chat-main .bot-editor'), 'Creation must render in the right content pane');
  const guide = document.querySelector('.bot-editor details');
  guide.open = true;
  for (const name of ['Codex CLI', 'Claude Code', 'Gemini CLI', 'Qwen Code', 'Kimi Code CLI', 'Qoder CN CLI', 'DeepSeek Harness']) {
    check(guide.textContent.includes(name), 'Guide must describe every listed agent: ' + name);
  }
  check(guide.querySelector('a[href="https://qoder.com"]'), 'Guide must link Qoder international separately');

  const deepseekLink = guide.querySelector('a[href="https://platform.deepseek.com"]');
  check(deepseekLink, 'Guide must expose a real official link');
  deepseekLink.click(); await tick();
  check(window.lastGuideLink === 'deepseek', 'Guide links must open through the external browser API');
  guide.open = false;

  check(!document.querySelector('.bot-chat-modal-backdrop, [aria-modal="true"]'), 'Creation must not use an overlay');
  check(!document.querySelector('.bot-chat-composer'), 'Conversation content must be replaced while editing');
  clickText(i18n.t('botChat.actions.manageBots'));
  await until(() => document.querySelector('.bot-manager-list'), 'Sidebar must navigate directly to Bot management');
  check(!document.querySelector('.bot-editor'), 'Sidebar navigation must close the previous page');
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Sidebar must navigate back to creation');

  clickText(i18n.t('botChat.actions.cancel'));
  await until(() => !document.querySelector('.bot-editor'), 'Direct creation did not close');
  check(!document.querySelector('.bot-manager-list'), 'Cancelling direct creation must not navigate to management');
  check(title() === 'Conversation B', 'Cancelling direct creation must preserve the original conversation');
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Creation did not reopen');
  select('B');
  await until(() => title() === 'Conversation B', 'Selecting the current conversation from another page must restore its content');

  const retryConversation = conversations.get('B');
  const originalAnswer = retryConversation.messages.find((message) => message.role === 'assistant');
  originalAnswer.status = 'failed'; originalAnswer.content = 'Old failed attempt';
  const otherAnswer = { ...originalAnswer, id: 'other-answer', botId: 'other', botSnapshotName: 'Other', status: 'completed', content: 'Other bot answer' };
  retryConversation.messages.push(otherAnswer);
  const publishRetry = (status) => onStatus({ conversationId: 'B', roundId: 'round-B', status, conversation: copy(retryConversation) });
  publishRetry('completed'); await tick();
  let retryPayload;
  window.electronAPI.retryConversationMember = async (payload) => {
    retryPayload = payload;
    retryConversation.runningRoundId = 'round-B';
    retryConversation.messages.push({ ...originalAnswer, id: 'retried-answer', status: 'streaming', content: 'Retry in progress' });
    publishRetry('running');
  };
  clickText(i18n.t('botChat.actions.retry'));
  await until(() => document.body.textContent.includes('Retry in progress'), 'Retry did not render');
  check(retryPayload.messageId === originalAnswer.id, 'Retry must target the failed attempt');
  check(!document.body.textContent.includes('Old failed attempt'), 'Retry must replace the old failure while streaming');
  check(document.querySelectorAll('.bot-chat-member-bubble').length === 2, 'Retry must not add a duplicate answer card');
  retryConversation.messages.at(-1).status = 'completed';
  retryConversation.messages.at(-1).content = 'Successful retry';
  retryConversation.runningRoundId = null;
  publishRetry('completed'); await tick();
  const answers = [...document.querySelectorAll('.bot-chat-member-bubble-content')].map((element) => element.textContent);
  check(answers.join('|') === 'Successful retry|Other bot answer', 'Retry must preserve the original position and other bot answers');
  check(retryConversation.messages.includes(originalAnswer), 'Rendering must preserve persisted attempt history');
  clickText(i18n.t('botChat.actions.manageBots'));
  await until(() => document.querySelector('.bot-manager'), 'Bot manager did not open');
  check(!document.querySelector('.bot-chat-bot-form'), 'Management must not contain the creation form');
  const openNewBot = async () => {
    [...document.querySelectorAll('.bot-manager-list button')].find((button) => button.textContent.trim() === i18n.t('botChat.bots.createTitle')).click();
    await until(() => document.querySelector('.bot-editor'), 'Separate Bot editor did not open'); await tick();
    check(!document.querySelector('.bot-chat-bot-list'), 'Creation must not contain the management list');
  };
  await openNewBot();
  check(document.querySelectorAll('.bot-agent-card').length === 7, 'First visit must discover local agents');
  const originalDetect = window.electronAPI.detectLocalAgent;
  window.electronAPI.detectLocalAgent = async (agent, ...args) => {
    if (agent === 'dsh') throw new Error('Unknown local agent.');
    return originalDetect(agent, ...args);
  };
  clickText(i18n.t('botChat.runtime.refresh')); await tick();
  await until(() => document.body.textContent.includes(i18n.t('botChat.runtime.restartDetection')), 'Unsupported agent must request an app restart');
  check([...document.querySelectorAll('.bot-agent-card')].find(card => card.textContent.includes('DeepSeek Harness')).textContent.includes(i18n.t('botChat.runtime.checkFailed')), 'Failed detection must not stay Not checked');
  window.electronAPI.detectLocalAgent = originalDetect;

  clickText(i18n.t('botChat.runtime.refresh')); await tick();
  check(document.querySelector('[data-agent-group="available"]').textContent.includes('Codex'), 'Manual refresh must discover installed agents');
  check(document.querySelector('.bot-agent-card').textContent.includes('Installed'), 'Installed status did not render');
  check(![...document.querySelectorAll('.bot-manager button')].some((button) => button.textContent === i18n.t('botChat.runtime.login')), 'Existing Codex login must be reused without a sign-in button');
  check(document.querySelector('.bot-avatar-editor img'), 'Local agent must have a default logo');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  canvas.getContext('2d').fillRect(0, 0, 4, 4);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const upload = new DataTransfer(); upload.items.add(new File([blob], 'avatar.png', { type: 'image/png' }));
  const avatarFile = document.querySelector('.bot-avatar-editor input');
  avatarFile.files = upload.files; avatarFile.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => document.querySelector('.bot-avatar-editor img')?.src.startsWith('data:image/png'), 'Uploaded avatar was not previewed');
  clickText(i18n.t('botChat.actions.create'));
  await until(() => createdBots.length === 1, 'Local bot creation failed without a global API key');
  check(createdBots[0].avatar.startsWith('data:image/png'), 'Bot creation must include its custom avatar');
  check(createdBots[0].connection.kind === 'cli' && createdBots[0].connection.agent === 'codex', 'Local bot did not retain its runtime');
  await until(() => document.querySelector('.bot-manager-list'), 'Create must return to management');
  const previousDetectionCalls = detectionCalls;
  await openNewBot();
  await tick();
  check(detectionCalls === previousDetectionCalls, 'Reopening creation with saved results must not invoke detection');
  check(![...document.querySelectorAll('.bot-editor button')].some((button) => button.textContent.trim() === i18n.t('botChat.runtime.checking')), 'Cached results must not show a scanning state');
  window.dispatchEvent(new Event('focus')); await tick();
  check(detectionCalls === previousDetectionCalls, 'Ordinary focus must not invoke detection');
  clickText(i18n.t('botChat.actions.cancel'));
  await until(() => document.querySelector('.bot-manager-list'), 'Cancel must return to management');
  await openNewBot();
  check(detectionCalls === previousDetectionCalls, 'Repeated reopening must not trigger another scan');
  window.electronAPI.getLocalAgentCache = async () => copy(detectionResults);
  check(document.querySelector('[data-agent-group="available"]').querySelectorAll('.bot-agent-card').length === 1, 'Missing agents must not appear as installed');
  check(!document.querySelector('[data-agent-group="available"]').textContent.includes('One-click install'), 'Installed agent must not offer installation');
  const missingCard = [...document.querySelectorAll('[data-agent-group="unavailable"] .bot-agent-card')].find((card) => card.textContent.includes('Qwen Code'));
  missingCard.querySelector('.bot-agent-select').click();
  await tick();
  check([...document.querySelectorAll('.bot-manager button')].find((button) => button.textContent.trim() === i18n.t('botChat.actions.create')).disabled, 'Missing agent must not be usable before installation');
  missingCard.querySelector('.bot-chat-primary-button').click();
  await until(() => setupCalls.length === 1, 'Installation action did not open setup');
  check(setupCalls[0].agent === 'qwen' && setupCalls[0].action === 'install', 'Wrong installer selected');
  installedAgents.add('qwen');
  const beforeInstallReturn = detectionCalls;
  window.dispatchEvent(new Event('focus')); await tick();
  check(detectionCalls === beforeInstallReturn, 'Installer return must not automatically scan');
  clickText(i18n.t('botChat.runtime.refresh'));
  await until(() => document.querySelector('[data-agent-group="available"]').textContent.includes('Qwen Code'), 'Manual refresh must find the newly installed agent');
  check(!document.querySelector('[data-agent-group="available"]').textContent.includes('One-click install'), 'Installed agent still shows install action');
  clickText('Custom API');
  await tick();
  const setValue = (element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const provider = () => document.querySelector('.bot-provider-select [role=combobox]');
  const choose = async (element, value) => { element.click(); await tick(); [...document.querySelectorAll('.app-select-options [role=option]')].find(option => option.dataset.value === value).click(); await tick(); };
  for (const preset of API_BOT_PRESETS) {
    await choose(provider(), preset.id);
    check(document.querySelector('.bot-manager input').value === preset.baseUrl, 'Provider must fill its Base URL');
    const models = document.querySelector('.bot-model-select [role=combobox]');
    check(models.textContent.includes(preset.models[0]), 'Provider switch must select its own default model');
    models.click(); await tick();
    const listed = [...document.querySelectorAll('.app-select-options [role=option]')].map((option) => option.dataset.value).filter((value) => value !== '__custom__');
    check(JSON.stringify(listed) === JSON.stringify(preset.models) && listed.length <= 3, 'Wrong provider model shortlist');
    check(Math.abs(document.querySelector('.app-select-options').getBoundingClientRect().width - models.getBoundingClientRect().width) < 1, 'Menu width must match its field');
    models.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();

  }
  await choose(provider(), 'openai');
  setValue(document.querySelector('.bot-manager input[type=password]'), 'old-provider-key');
  await tick();
  await choose(provider(), 'qwen');
  check(document.querySelector('.bot-manager input[type=password]').value === '', 'Provider change must clear the old key');
  document.querySelector('.bot-model-select [role=combobox]').click(); await tick();
  const modelTrigger = document.querySelector('.bot-model-select [role=combobox]');
  modelTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await tick();
  modelTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
  check([...document.querySelectorAll('.bot-manager label')].some((label) => label.textContent === i18n.t('botChat.runtime.customModel')), 'Preset must allow a custom model');
  await choose(provider(), 'custom');
  check(document.querySelector('.bot-manager input').value === '', 'Custom provider must clear preset URL');
  const fields = document.querySelectorAll('.bot-manager input:not([type=file])');
  setValue(fields[0], 'https://custom.example/v1');
  await tick();
  setValue(fields[1], 'fixture-key');
  setValue(fields[2], 'DeepSeek reviewer');
  setValue(fields[3], 'custom-model');
  await tick();
  clickText(i18n.t('botChat.actions.create'));
  await until(() => createdBots.length === 2, 'Custom API bot was not created');
  check(createdBots[1].connection.maxOutputTokens === 4096, 'API Bot must save the output limit');
  check(createdBots[1].connection.baseUrl === 'https://custom.example/v1' && createdBots[1].apiKey === 'fixture-key', 'Custom API fields were lost');
  await until(() => document.querySelector('.bot-manager-list'), 'API create must return to management');
  check(document.querySelectorAll('.bot-chat-bot-item').length === 2, 'Management must show both saved Bots');
  [...document.querySelectorAll('.bot-chat-bot-item-actions button')].find(button => button.textContent === i18n.t('botChat.actions.edit')).click();
  await until(() => document.querySelector('.bot-editor'), 'Edit must open a separate form');
  check(!document.querySelector('.bot-chat-bot-list'), 'Edit must not contain management list');
  clickText(i18n.t('botChat.actions.cancel'));
  await until(() => document.querySelector('.bot-manager-list'), 'Cancel must return to management');
  [...document.querySelectorAll('.bot-manager button')].find((button) => button.textContent.trim() === i18n.t('botChat.actions.newConversation')).click();
  await until(() => document.querySelector('.bot-chat-bot-checklist'), 'Bot manager must lead directly to conversation creation');
  for (const checkbox of document.querySelectorAll('.bot-chat-bot-checklist input')) { checkbox.click(); await tick(); }
  clickText(i18n.t('botChat.actions.create'));
  await until(() => title() === 'New conversation', 'Created conversation did not open');
  check(!document.querySelector('.bot-chat-platform'), 'Conversation title must not show a provider list');
  check(!document.querySelector('.bot-chat-member-chip-model'), 'Member chips must show only avatar and name');
  check(document.querySelector('.bot-group-member img')?.src === createdBots[0].avatar, 'Member must display the saved custom avatar');
  fill('One question for both bots'); await tick(); send();
  await until(() => pending.has('created-conversation'), 'New conversation could not send');
  const round = conversations.get('created-conversation');
  check(round.members.length === 2 && round.members.some((member) => member.connection.kind === 'cli') && round.members.some((member) => member.connection.kind === 'api'), 'Local/API bots must share a conversation');
  check(!sent.at(-1).recipientBotIds || sent.at(-1).recipientBotIds.length === 2, 'Question must target all bots by default');
  complete('created-conversation'); await tick();
  check(document.body.textContent.includes('Completed created-conversation: Codex CLI') && document.body.textContent.includes('Completed created-conversation: DeepSeek reviewer'), 'Both answers must be visible');
  clickText(i18n.t('botChat.actions.manageMembers'));
  await until(() => document.querySelector('.bot-member-manager'), 'Existing conversation must show current members');
  check(document.querySelectorAll('.bot-chat-member-edit').length === 2, 'Current members must be listed first');
  check(!document.querySelector('.bot-member-manager textarea, .bot-member-manager input, .bot-member-manager select, .bot-member-manager .bot-chat-bot-item-model'), 'Member management must only manage membership, not model or Soul settings');
  check(![...document.querySelectorAll('.bot-member-manager button')].some((button) => button.textContent.includes(i18n.t('botChat.bots.createTitle'))), 'Member management must not offer Bot creation');
  [...document.querySelectorAll('.bot-member-manager button')].find((button) => button.textContent.includes(i18n.t('botChat.members.addHint'))).click();
  await until(() => document.querySelector('.bot-member-picker'), 'Add members must open a separate picker');
  check(!document.querySelector('.bot-chat-member-edit input, .bot-chat-member-edit datalist, .bot-chat-member-edit select'), 'Member management must not offer a global model picker');
  const createFromMembers = () => [...document.querySelectorAll('.bot-chat-member-add button')].find((button) => button.textContent.includes(i18n.t('botChat.bots.createTitle'))).click();
  createFromMembers();
  await until(() => document.querySelector('.bot-editor'), 'Members must allow creating another Bot');
  clickText(i18n.t('botChat.actions.cancel'));
  await until(() => document.querySelector('.bot-chat-member-add'), 'Cancel must return to member management');
  check(conversations.get('created-conversation').members.length === 2, 'Cancel must preserve membership');
  createFromMembers();
  await until(() => document.querySelector('.bot-editor'), 'Member creation did not reopen');
  await tick();
  const nameField = [...document.querySelectorAll('.bot-editor label')].find((label) => label.textContent === i18n.t('botChat.bots.name')).querySelector('input');
  setValue(nameField, 'New reviewer'); await tick();
  clickText(i18n.t('botChat.actions.create'));
  await until(() => document.querySelector('.bot-chat-member-add'), 'Saved Bot must return to member management');
  check(![...document.querySelectorAll('.bot-member-picker button')].some((button) => button.textContent.includes(i18n.t('botChat.bots.createTitle'))), 'Creation must be hidden when an existing Bot can be invited');
  const newMemberOption = [...document.querySelectorAll('.bot-member-picker .bot-chat-bot-check')].find((option) => option.textContent.includes('New reviewer'));
  check(newMemberOption, 'New Bot must be selectable for the existing conversation');
  check(document.querySelectorAll('.bot-member-picker input[type=checkbox]').length === 1, 'Existing members must be excluded from invitation choices');
  newMemberOption.querySelector('input').click(); await tick();
  document.querySelector('.bot-member-picker .bot-chat-modal-actions .bot-chat-primary-button').click();
  await until(() => document.querySelectorAll('.bot-chat-member-edit').length === 3, 'Added member must appear immediately');
  check(conversations.get('created-conversation').members.length === 3, 'Bot must join the existing conversation');
  check(conversations.get('created-conversation').messages.length > 0, 'Adding members must preserve conversation history');
  const memberDialog = document.querySelector('.bot-member-manager');
  [...memberDialog.querySelectorAll('button')].find((button) => button.textContent.trim() === i18n.t('botChat.actions.done')).click();
  await tick();
  const coordinatorTrigger = document.querySelector('.bot-coordination-settings [role=combobox]');
  coordinatorTrigger.click(); await tick();
  document.querySelectorAll('.app-select-options [role=option]')[1].click(); await tick();
  check(conversations.get('created-conversation').coordinatorId, 'Coordinator choice must be saved for the conversation');
  fill('@New'); await tick();
  const mentionOption = [...document.querySelectorAll('.bot-mention-options button')].find(button => button.textContent.includes('New reviewer'));
  check(mentionOption, 'Mention menu must include newly invited members'); mentionOption.click(); await tick();
  check(document.querySelector('.bot-chat-recipient-summary').textContent.includes('New reviewer'), 'Mention preview must show the actual recipient');
  fill(input().value + 'review the history'); await tick(); send(); await tick();
  const addressed = sent.at(-1);
  check(addressed.botIds.length === 1 && addressed.botIds[0] === createdBots.find(bot => bot.name === 'New reviewer').id, 'Mention must override coordinator and send only to the selected member');
  complete('created-conversation'); await tick();
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Login check form did not open');
  installedAgents.add('claude');
  clickText(i18n.t('botChat.runtime.refresh')); await tick();
  [...document.querySelectorAll('.bot-agent-select')].find((button) => button.textContent.includes('Claude Code')).click();
  await tick();
  const login = [...document.querySelectorAll('.bot-editor button')].find((button) => button.textContent.trim() === i18n.t('botChat.runtime.login'));
  check(login && !login.disabled, 'Unknown cached login state must not disable explicit sign-in');
  login.click();
  await until(() => document.querySelector('.bot-editor').textContent.includes(i18n.t('botChat.runtime.loginReused')), 'Already signed-in result must be reported as reuse');
  check(!document.querySelector('.bot-editor').textContent.includes(i18n.t('botChat.runtime.setupOpened')), 'Login reuse must not falsely report an opened terminal');
  clickText(i18n.t('botChat.actions.cancel')); await tick();
  clickText(i18n.t('botChat.actions.manageBots')); await tick();
  clickText(i18n.t('botChat.actions.chatAlone'));
  await until(() => !document.querySelector('.bot-manager-list'), 'One-on-one chat must open directly');
  await tick();
  check(conversations.get('created-conversation').members.length === 1, 'Direct chat must include only the chosen Bot');
  check(![...document.querySelectorAll('.bot-chat-composer-buttons button')].some(button => button.textContent === i18n.t('botChat.composer.review')), 'One-on-one chat must not offer cross review');
  fill('Private question'); await tick(); send();
  await until(() => conversations.get('created-conversation').runningRoundId, 'Direct chat must be able to send');
  const privateRound = conversations.get('created-conversation');
  check(privateRound.messages.filter(message => message.role === 'assistant').length === 1, 'Only the selected Bot must answer');
  complete('created-conversation'); await tick();
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Qoder create form did not open');
  installedAgents.add('qodercn');
  clickText(i18n.t('botChat.runtime.refresh')); await tick();
  [...document.querySelectorAll('.bot-agent-select')].find(button => button.textContent.includes('Qoder CN CLI')).click(); await tick();
  const beforeQoderCreate = createdBots.length;
  clickText(i18n.t('botChat.actions.create'));
  await until(() => createdBots.length > beforeQoderCreate, 'Qoder Bot must be creatable');
  check(createdBots.at(-1).connection.agent === 'qodercn', 'Qoder must retain its own CLI identity');
  check(!setupCalls.some(call => call.agent === 'qodercn'), 'Creating Qoder Bot must not initiate login');
  await until(() => !document.querySelector('.bot-editor'), 'Qoder creation must finish before navigating');
  clickText(i18n.t('botChat.bots.createTitle'));
  await until(() => document.querySelector('.bot-editor'), 'Harness creation page did not open');
  installedAgents.add('dsh');
  clickText(i18n.t('botChat.runtime.refresh')); await tick();
  await until(() => [...document.querySelectorAll('[data-agent-group="available"] .bot-agent-select')].some(button => button.textContent.includes('DeepSeek Harness')), 'Harness must be detected');
  [...document.querySelectorAll('.bot-agent-select')].find(button => button.textContent.includes('DeepSeek Harness')).click(); await tick();
  check([...document.querySelectorAll('.bot-agent-actions button')].some(button => button.textContent === i18n.t('botChat.runtime.configure')), 'Harness needs configuration instead of a login command');
  clickText(i18n.t('botChat.actions.create'));
  await until(() => createdBots.at(-1)?.connection.agent === 'dsh', 'Harness Bot was not created');
  check(!setupCalls.some(call => call.agent === 'dsh'), 'Creating Harness Bot must reuse configuration without launching setup');

  return 'Conversation renderer streaming, isolation, provider/model selection, login reuse, local/API bot creation and mixed conversation flow tests passed.';
};

window.runBotLayoutTests = async () => {
  deferredRead = undefined;
  select('A'); await until(() => title() === 'Conversation A', 'Mobile conversation did not load');
  const details = document.querySelector('.bot-group-details');
  check(details.getBoundingClientRect().width > 0 && details.scrollWidth <= details.clientWidth + 1, 'Group details must fit mobile');
  document.querySelector('.bot-group-details header button').click(); await tick();
  fill('@'); await tick();
  for (const selector of ['.bot-mention-options', '.bot-chat-composer']) {
    const element = document.querySelector(selector);
    const bounds = element.getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth + 1, `${selector} must fit a mobile screen`);
    check(element.scrollWidth <= element.clientWidth + 1, `${selector} must not overflow`);
  }

  const manage = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === i18n.t('botChat.actions.manageBots'));
  manage.click(); await until(() => document.querySelector('.bot-manager-list'), 'Bot manager did not reopen');
  [...document.querySelectorAll('.bot-manager-list button')].find((button) => button.textContent.trim() === i18n.t('botChat.bots.createTitle')).click();
  await until(() => document.querySelector('.bot-editor'), 'Create form did not open');
  [...document.querySelectorAll('.bot-runtime-tabs button')].find((button) => button.textContent.trim() === i18n.t('botChat.runtime.api')).click();
  await tick();
  const testButton = () => [...document.querySelectorAll('button')].find(button => [i18n.t('botChat.apiTest.button'), i18n.t('botChat.apiTest.testing')].includes(button.textContent.trim()));
  check(testButton().disabled, 'Test requires an API key');
  const keyInput = document.querySelector('input[type=password]');
  const writeKey = value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(keyInput, value); keyInput.dispatchEvent(new Event('input', { bubbles: true })); };
  writeKey('fixture-key'); await tick();
  testButton().click(); await tick(); check(testButton().disabled, 'Testing prevents duplicate clicks');
  writeKey('replacement-key'); await tick();
  resolveApiTest({ status: 'success' }); await tick();
  check(!document.querySelector('.bot-api-test [role=status]'), 'Stale test result is discarded after key edit');
  testButton().click(); await tick(); resolveApiTest({ status: 'success' }); await tick();
  check(document.querySelector('.bot-api-test [role=status]').textContent === i18n.t('botChat.apiTest.success'), 'Show successful API test');
  for (const language of ['en', 'zh']) {
    await i18n.changeLanguage(language); await tick();
    [...document.querySelectorAll('.bot-runtime-tabs button')].find((button) => button.textContent.trim() === i18n.t('botChat.runtime.local')).click();
    await tick();
    const buttons = [...document.querySelectorAll('.bot-runtime-tabs button')];
    check(buttons.length === 3, 'Local mode must show detection beside connection options');
    check(buttons.every((button) => Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) < 1), 'Connection options and detection must stay on one row');
    const modal = document.querySelector('.bot-manager');
    check(modal.scrollWidth <= modal.clientWidth + 1, 'Bot form overflows horizontally');
    const help = modal.querySelector('details');
    help.open = true; await tick();
    check(modal.scrollWidth <= modal.clientWidth + 1, 'Expanded guide must fit mobile screens');
    help.open = false;

    const bounds = modal.getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Bot form does not fit the viewport');
    for (const field of modal.querySelectorAll('input, select')) {
      check(field.getBoundingClientRect().right <= bounds.right, 'Bot field extends outside the dialog');
    }
  }
  [...document.querySelectorAll('.bot-runtime-tabs button')].find((button) => button.textContent.trim() === i18n.t('botChat.runtime.api')).click(); await tick();
  const modelTrigger = document.querySelector('.bot-model-select [role=combobox]');
  modelTrigger.scrollIntoView({ block: 'center' }); await tick();
  modelTrigger.click(); await tick();
  const menu = document.querySelector('.app-select-options');
  const menuBounds = menu.getBoundingClientRect();
  check(menuBounds.left >= 0 && menuBounds.right <= innerWidth && menuBounds.top >= 0 && menuBounds.bottom <= innerHeight, 'Model menu must fit the mobile viewport');
  return 'Bot form mobile layout passed in English and Chinese.';
};

window.showGroupPreview = async () => {
  deferredRead = undefined;
  select('A'); await until(() => title() === 'Conversation A', 'Preview group failed');
  fill(''); await tick();
  if (!document.querySelector('.bot-group-details')) { document.querySelector('.bot-group-details-toggle').click(); await tick(); }
};
