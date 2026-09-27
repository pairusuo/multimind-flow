import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WindowManager } = require('../dist/main/windowManager.js');
const { PRESET_SITES, repairPersistedSiteUrl } = require('../dist/shared/presetSites.js');
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
console.log('Navigation persistence tests passed: iframe isolation, main-frame navigation and saved URL repair.');
