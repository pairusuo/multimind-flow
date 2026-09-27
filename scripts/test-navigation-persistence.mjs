import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WindowManager } = require('../dist/main/windowManager.js');
const { getAdapterForUrl } = require('../dist/main/adapters/index.js');
const { PRESET_SITES, repairPersistedSiteUrl } = require('../dist/shared/presetSites.js');
const { IPC } = require('../dist/shared/types.js');
const home = PRESET_SITES.find((site) => site.id === 'doubao').url;
const internal = 'https://www.doubao.com/drive-iframe/drive/home/';
const chat = 'https://www.doubao.com/chat/example';
assert.equal(repairPersistedSiteUrl(internal), home);
assert.equal(repairPersistedSiteUrl(`${internal}?source=chat#files`), home);
for (const url of [chat, 'https://www.doubao.com/drive/', 'https://example.com/drive-iframe/drive/home/', 'https://www.doubao.com.evil.example/drive-iframe/', '', 'https://chatgpt.com/c/example']) {
  assert.equal(repairPersistedSiteUrl(url), url, 'Only known persisted internal URLs are repaired');
}

// Exercise the actual WindowManager event handlers without network or a user profile.
const manager = Object.create(WindowManager.prototype);
const webContents = new EventEmitter();
webContents.isDestroyed = () => false;
manager.isDestroyed = () => false;
manager.bindShortcutEvents = () => {};
manager.shouldIgnoreNavigationDuringEmptyTabLoad = () => false;
const writes = [];
const notices = [];
const sent = [];
manager.commitCellUrlFromNavigation = (id, url) => writes.push({ id, url });
manager.sendUrl = (id, url) => sent.push({ id, url });
manager.checkNavigationNotice = (id, url) => notices.push({ id, url });
manager.bindViewEvents('cell-0', { webContents });
for (const url of [internal, 'https://other.example/embedded#route', `${chat}#child`]) {
  webContents.emit('did-navigate-in-page', {}, url, false, 1, 2);
}
assert.deepEqual(writes, [], 'Iframe routes must not overwrite persistence or reset conversation context');
assert.deepEqual(sent, [], 'Iframe routes must not replace the displayed address');
assert.deepEqual(notices, [], 'Iframe routes must not trigger top-level navigation notices');
webContents.emit('did-navigate-in-page', {}, chat, true, 1, 1);
assert.deepEqual(writes, [{ id: 'cell-0', url: chat }], 'Main-frame SPA chat routes remain restorable');
webContents.emit('did-navigate', {}, 'https://chatgpt.com/c/next');
assert.equal(writes.at(-1).url, 'https://chatgpt.com/c/next');
manager.isDestroyed = () => true;
webContents.emit('did-navigate-in-page', {}, home, true, 1, 1);
assert.equal(writes.length, 2, 'Destroyed views must not change persistence');

// Repair both legacy cell URL and all stored tabs, preserving IDs and normal chat URLs.
const tabs = [
  { id: 'bad', url: internal, title: '豆包', favicon: 'existing-icon' },
  { id: 'good', url: chat, title: 'Existing conversation' },
];
const saved = new Map([['cells.cell-0.url', internal], ['cells.cell-0.tabs', tabs]]);
manager.store = { get: (key, fallback) => saved.has(key) ? saved.get(key) : fallback, set: (key, value) => saved.set(key, value) };
manager.cellUrls = manager.getStoredCellUrls();
const restoredTabs = manager.getStoredTabs();
assert.equal(manager.cellUrls['cell-0'], home);
assert.equal(saved.get('cells.cell-0.url'), home);
assert.deepEqual(restoredTabs['cell-0'], [{ ...tabs[0], url: home }, tabs[1]]);
assert.deepEqual(saved.get('cells.cell-0.tabs'), restoredTabs['cell-0']);
assert.equal(manager.getStoredCellUrls()['cell-0'], home, 'Repair remains stable on subsequent startup');
for (const url of ['https://chatgpt.com/', 'https://www.doubao.com/chat/']) {
  const adapter = getAdapterForUrl(url);
  assert.equal(adapter?.nativeInjection?.usesNativeTextInsertion, true, `${url} must use native text insertion`);
  assert.match(adapter.nativeInjection.clickTargetScript('native-input-fixture'), /native-input-fixture/);
  assert.match(adapter.nativeInjection.acceptedScript, /return true/);
  assert.ok(adapter.nativeInjection.enterFallbackScript, `${url} must retain native Enter fallback`);
}

// A page transition must cancel delayed notice replays from the previous page.
const noticeManager = Object.create(WindowManager.prototype);
noticeManager.destroyed = false;
noticeManager.isDestroyed = () => false;
noticeManager.noticeReplayTimeouts = new Map();
const noticeEvents = [];
noticeManager.sendToRenderer = (channel, payload) => noticeEvents.push({ channel, payload });
noticeManager.showCellNotice('cell-0', 'inject-failed');
noticeManager.clearCellNotice('cell-0');
await new Promise((resolve) => setTimeout(resolve, 550));
assert.deepEqual(
  noticeEvents.map(({ channel }) => channel),
  [IPC.SHOW_CELL_NOTICE, IPC.CLEAR_CELL_NOTICE],
  'Clearing a page notice must prevent its delayed replay from appearing on the next page',
);

console.log('Navigation and native injection tests passed: iframe isolation, URL repair, page-scoped notices, ChatGPT and Doubao native submit paths.');
