import { app, BrowserWindow, WebContents, WebContentsView, nativeTheme } from 'electron';
import { NOTICE_MESSAGE_KEYS } from '../shared/notices';
import { buildDocumentPrompt, detectContentLanguage } from '../shared/documentPrompt';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES, repairPersistedSiteUrl } from '../shared/presetSites';
import {
  ApplyTemplatePayload,
  AppLanguage,
  BrowserState,
  CELL_IDS,
  CellTab,
  CellMode,
  ConversationEntryMode,
  DEFAULT_URLS,
  DocumentCandidate,
  ExtractedConversation,
  ExtractedConversationEntry,
  ForwardRecord,
  ForwardResponsePayload,
  GenerateDocumentPayload,
  IPC,
  LAYOUT_CELLS,
  LayoutMode,
  NoticeType,
  ThemeMode,
} from '../shared/types';
import { getAdapterForUrl, type SiteNativeInjection } from './adapters';
import { CHROME_USER_AGENT } from './constants';
import {
  buildForwardPrompt,
  formatRoleBlocks,
  parseRoleBlocks,
  truncateConversation,
} from './forwardPrompt';

const TOOLBAR_HEIGHT = 52;
const BOTTOM_INPUT_HEIGHT = 56;
const CELL_BORDER_SIZE = 1;
const FOCUSED_CELL_BORDER_SIZE = 2;
const CELL_HEADER_HEIGHT = 42;
const SPLITTER_SIZE = 0;
const LOAD_TIMEOUT_MS = 10000;
const NOTICE_REPLAY_DELAY_MS = 500;
const RESPONSE_POLL_INTERVAL_MS = 800;
const RESPONSE_WAIT_TIMEOUT_MS = 120000;
const TIMELINE_NAVIGATION_CARRY_MS = 30000;
const SEND_FAN_OUT_JITTER_MS = 220;
const BLANK_URL = 'about:blank';

export interface BrowserStore {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
}

export async function createBrowserStore(): Promise<BrowserStore> {
  const importModule = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ default: new () => BrowserStore }>;
  const { default: ElectronStore } = await importModule('electron-store');
  return new ElectronStore();
}

interface CellState {
  url: string;
  active: boolean;
  mode: CellMode;
}

type TimelineEntrySource = 'bottom-input' | 'forward-injection' | 'document-generation' | 'dom-detected';

interface TimelineEntry {
  role: 'user' | 'assistant';
  content: string;
  source: TimelineEntrySource;
  timestamp: number;
  domId?: string;
  order?: number;
}

interface CellTimeline {
  cellId: string;
  key: string;
  entries: TimelineEntry[];
  lastDomSyncedEntryCount: number;
}

export class WindowManager {
  private views: Map<string, WebContentsView> = new Map();
  private viewPartitions: Map<string, string> = new Map();
  private attachedViews: Set<string> = new Set();
  private cellStates: Map<string, CellState> = new Map();
  private loadTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private layoutMode: LayoutMode;
  private cellUrls: Record<string, string>;
  private cellModes: Record<string, CellMode>;
  private searchUrlTemplates: Record<string, string>;
  private mutedCells: Record<string, boolean>;
  private tabs: Record<string, CellTab[]>;
  private activeTabIds: Record<string, string>;
  private themeMode: ThemeMode;
  private language: AppLanguage;
  private conversationEntryMode: ConversationEntryMode;
  private forwardControlsEnabled: boolean;
  private activeCells: Record<string, boolean> = {
    'cell-0': true,
    'cell-1': true,
    'cell-2': true,
    'cell-3': true,
  };
  private focusedCellId: string;
  private maximizedCellId: string | null = null;
  private overlayOpen = false;
  private destroyed = false;
  private forwardRecords: ForwardRecord[] = [];
  private cellTimelines: Map<string, CellTimeline> = new Map();
  private assistantCaptureChains: Map<string, Promise<void>> = new Map();
  private timelineNavigationCarryUntil: Map<string, number> = new Map();
  private pendingEmptyTabLoads: Set<string> = new Set();

  constructor(
    private readonly window: BrowserWindow,
    private readonly store: BrowserStore,
  ) {
    this.layoutMode = this.getStoredLayoutMode();
    this.cellUrls = this.getStoredCellUrls();
    this.cellModes = this.getStoredCellModes();
    this.searchUrlTemplates = this.getStoredSearchUrlTemplates();
    this.activeCells = this.getStoredActiveCells();
    this.mutedCells = this.getStoredMutedCells();
    this.tabs = this.getStoredTabs();
    this.activeTabIds = this.getStoredActiveTabIds();
    this.themeMode = this.getStoredThemeMode();
    this.language = this.getStoredLanguage();
    this.conversationEntryMode = this.getStoredConversationEntryMode();
    this.forwardControlsEnabled = this.getStoredForwardControlsEnabled();
    nativeTheme.themeSource = this.themeMode;
    this.cellStates = this.createCellStates();
    this.focusedCellId = this.getStoredFocusedCellId();
    this.bindShortcutEvents(this.window.webContents);
    this.registerLegacySitePartitions();
  }

  createInitialView(): void {
    if (this.isDestroyed()) {
      return;
    }

    this.setLayout(this.layoutMode);
  }

  layout(): void {
    if (this.isDestroyed()) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    const cells = LAYOUT_CELLS[this.layoutMode];
    if (this.overlayOpen || this.conversationEntryMode === 'api') {
      this.detachAllViews();
      return;
    }

    this.syncAttachedViews(cells);

    const contentHeight = Math.max(
      0,
      height - TOOLBAR_HEIGHT - (this.layoutMode === 'single' || this.maximizedCellId ? 0 : BOTTOM_INPUT_HEIGHT),
    );
    const boundsByCell = this.maximizedCellId
      ? { [this.maximizedCellId]: { x: 0, y: TOOLBAR_HEIGHT, width, height: contentHeight } }
      : this.getBoundsByCell(width, contentHeight);

    CELL_IDS.forEach((cellId) => {
      const view = this.views.get(cellId);
      if (!view) {
        return;
      }

      if (view.webContents.isDestroyed()) {
        return;
      }
      if (this.maximizedCellId ? cellId !== this.maximizedCellId : !cells.includes(cellId)) {
        safeSetBounds(view, { x: -10000, y: -10000, width: 0, height: 0 });
        return;
      }

      safeSetBounds(
        view,
        insetBoundsWithHeader(boundsByCell[cellId], cellId === this.focusedCellId ? FOCUSED_CELL_BORDER_SIZE : CELL_BORDER_SIZE),
      );
    });
  }

  setLayout(mode: LayoutMode, fillDefaults = true): void {
    if (this.isDestroyed()) {
      return;
    }

    this.layoutMode = mode;
    this.maximizedCellId = null;
    this.store.set('browser.layout', mode);
    this.sendToRenderer(IPC.LAYOUT_CHANGED, { layoutMode: mode });
    const visibleCells = LAYOUT_CELLS[mode];

    if (fillDefaults) {
      this.fillDefaultUrlsForVisibleCells(visibleCells);
    }

    visibleCells.forEach((cellId) => {
      const view = this.ensureView(cellId);
      if (!this.attachedViews.has(cellId)) {
        this.addChildView(view);
        this.attachedViews.add(cellId);
      }
    });

    this.attachedViews.forEach((cellId) => {
      const view = this.views.get(cellId);
      if (view && !visibleCells.includes(cellId)) {
        this.removeChildView(view);
        this.attachedViews.delete(cellId);
      }
    });

    this.layout();
  }

  setOverlayOpen(open: boolean): void {
    if (this.isDestroyed()) {
      return;
    }

    this.overlayOpen = open;
    this.layout();
  }

  setMaximizedCell(cellId: string | null): void {
    if (this.isDestroyed()) {
      return;
    }

    this.maximizedCellId = cellId && isKnownCellId(cellId) ? cellId : null;
    if (this.maximizedCellId) {
      this.focusCell(this.maximizedCellId);
      this.ensureView(this.maximizedCellId);
    }
    this.layout();
  }

  setCellUrl(cellId: string, rawUrl: string, mode?: CellMode, searchUrlTemplate?: string): void {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return;
    }

    const url = normalizeUrl(rawUrl);
    if (url) {
      this.pendingEmptyTabLoads.delete(cellId);
    }
    this.resetTimelineForUrlChange(cellId, this.cellUrls[cellId], url);
    this.rememberCurrentSitePartition(cellId);
    this.cellUrls[cellId] = url;
    this.store.set(`cells.${cellId}.url`, url);
    this.updateActiveTab(cellId, { url });
    this.setCellMode(cellId, mode ?? inferCellMode(url));
    this.setSearchUrlTemplate(cellId, searchUrlTemplate ?? inferSearchUrlTemplate(url, this.cellModes[cellId]));
    if (!url) {
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.active`, false);
    }
    this.syncCellState(cellId);
    this.loadCellUrl(cellId, url);
    this.layout();
  }

  toggleCell(cellId: string, active: boolean): void {
    if (!this.isDestroyed() && isKnownCellId(cellId)) {
      this.activeCells[cellId] = active;
      this.store.set(`cells.${cellId}.active`, active);
      this.syncCellState(cellId);
    }
  }

  focusCell(cellId: string): void {
    if (!this.isDestroyed() && isKnownCellId(cellId)) {
      this.focusedCellId = cellId;
      this.store.set('browser.focusedCellId', cellId);
      this.sendToRenderer(IPC.CELL_FOCUSED, { cellId });
      this.layout();
    }
  }

  navigate(cellId: string, rawUrl: string, resetTimeline = true): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const url = normalizeUrl(rawUrl);
    if (url) {
      this.pendingEmptyTabLoads.delete(cellId);
    }
    if (resetTimeline) {
      this.resetTimelineForUrlChange(cellId, this.cellUrls[cellId], url);
    }
    this.rememberCurrentSitePartition(cellId);
    this.cellUrls[cellId] = url;
    this.store.set(`cells.${cellId}.url`, url);
    this.updateActiveTab(cellId, { url });
    this.updateKnownSiteMetadata(cellId, url);
    if (!url) {
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.active`, false);
    }
    this.syncCellState(cellId);
    this.loadCellUrl(cellId, url);
    this.layout();
    return this.getBrowserState();
  }

  navigateBack(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed() && view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  }

  navigateForward(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed() && view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  }

  reload(cellId: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  }

  setThemeMode(mode: ThemeMode): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    this.themeMode = mode;
    this.store.set('browser.themeMode', mode);
    nativeTheme.themeSource = mode;
    return this.getBrowserState();
  }

  setLanguage(language: AppLanguage): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    if (!isAppLanguage(language)) {
      return this.getBrowserState();
    }

    this.language = language;
    this.store.set('app.language', language);
    this.reloadEmptyStateViews();
    return this.getBrowserState();
  }

  setConversationEntryMode(mode: ConversationEntryMode): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    if (!isConversationEntryMode(mode)) {
      return this.getBrowserState();
    }

    this.conversationEntryMode = mode;
    this.store.set('conversation.entryMode', mode);
    this.layout();
    return this.getBrowserState();
  }

  getAutoCheckUpdates(): boolean {
    if (this.isDestroyed()) return false;
    return this.store.get('updates.autoCheck', false) === true;
  }

  setAutoCheckUpdates(enabled: boolean): void {
    if (this.isDestroyed()) return;
    this.store.set('updates.autoCheck', enabled);
  }

  setForwardControlsEnabled(enabled: boolean): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    this.forwardControlsEnabled = enabled;
    this.store.set('features.forwardControlsEnabled', enabled);
    return this.getBrowserState();
  }

  toggleMute(cellId: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const muted = !this.mutedCells[cellId];
    this.mutedCells[cellId] = muted;
    this.store.set(`cells.${cellId}.muted`, muted);
    const view = this.views.get(cellId);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.setAudioMuted(muted);
    }
    return this.getBrowserState();
  }

  startNewDiscussion(): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    LAYOUT_CELLS[this.layoutMode].forEach((cellId) => {
      const currentUrl = this.cellUrls[cellId];
      if (!currentUrl?.trim()) {
        this.resetTimeline(cellId);
        return;
      }

      const nextUrl = normalizeUrl(getNewDiscussionUrl(currentUrl));
      this.resetTimeline(cellId);
      this.cancelTimelineNavigationCarry(cellId);
      this.navigate(cellId, nextUrl, false);
    });

    return this.getBrowserState();
  }

  newTab(cellId: string, rawUrl?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const url = normalizeUrl(rawUrl ?? '');
    const tab = createTab(url, getNewTabTitle(this.language));
    this.tabs[cellId] = [...(this.tabs[cellId] ?? []), tab];
    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    if (url) {
      this.pendingEmptyTabLoads.delete(cellId);
    } else {
      this.pendingEmptyTabLoads.add(cellId);
      this.sendToRenderer(IPC.CELL_FAVICON_CHANGED, { cellId, favicon: '' });
    }
    this.navigate(cellId, url, false);
    return this.getBrowserState();
  }

  closeTab(cellId: string, tabId?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId)) {
      return this.getBrowserState();
    }

    const tabs = this.tabs[cellId] ?? [];
    const targetTabId = tabId ?? this.activeTabIds[cellId];
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
    if (targetIndex === -1) {
      return this.getBrowserState();
    }

    const nextTabs = tabs.filter((tab) => tab.id !== targetTabId);
    if (!nextTabs.length) {
      nextTabs.push(createTab('', getNewTabTitle(this.language)));
    }

    this.tabs[cellId] = nextTabs;
    if (this.activeTabIds[cellId] === targetTabId) {
      const nextTab = nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0];
      this.activeTabIds[cellId] = nextTab.id;
      this.navigate(cellId, nextTab.url, false);
    }
    this.storeTabs(cellId);
    return this.getBrowserState();
  }

  switchTab(cellId: string, tabId?: string): BrowserState {
    if (this.isDestroyed() || !isKnownCellId(cellId) || !tabId) {
      return this.getBrowserState();
    }

    const tab = this.tabs[cellId]?.find((candidate) => candidate.id === tabId);
    if (!tab) {
      return this.getBrowserState();
    }

    this.activeTabIds[cellId] = tab.id;
    this.storeTabs(cellId);
    this.navigate(cellId, tab.url, false);
    return this.getBrowserState();
  }

  async sendToAll(text: string): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }

    const visibleCells = new Set(LAYOUT_CELLS[this.layoutMode]);
    const activeCells = [...this.cellStates.entries()].filter(
      ([cellId, state]) => visibleCells.has(cellId) && state.active && state.url,
    );

    await Promise.all(activeCells.map(async ([cellId, state]) => {
      await delay(Math.random() * SEND_FAN_OUT_JITTER_MS);
      if (this.isDestroyed()) {
        return;
      }

      if (state.mode === 'search') {
        const searchUrl = buildSearchUrl(this.getSearchUrlTemplate(cellId), trimmedText);
        if (searchUrl) {
          this.navigate(cellId, searchUrl);
        }
      } else {
        const previousResponse = await this.extractLatestResponseIfSupported(cellId);
        this.beginTimelineNavigationCarry(cellId);
        const injected = await this.injectText(cellId, trimmedText);
        if (injected) {
          this.appendTimelineEntry(cellId, {
            role: 'user',
            content: trimmedText,
            source: 'bottom-input',
            timestamp: Date.now(),
          });
          this.scheduleAssistantCapture(cellId, previousResponse, 'bottom-input');
        } else {
          this.cancelTimelineNavigationCarry(cellId);
        }
      }
    }));
  }

  async injectText(cellId: string, text: string): Promise<boolean> {
    if (this.isDestroyed()) {
      return false;
    }

    const url = this.cellUrls[cellId]?.trim();
    if (!url) {
      return false;
    }

    const adapter = getAdapterForUrl(url);
    if (!adapter) {
      this.showCellNotice(cellId, 'inject-failed');
      return false;
    }

    if (adapter.nativeInjection) {
      const result = await this.injectNativeClickSiteText(cellId, text, adapter.nativeInjection);
      if (!result) {
        this.showCellNotice(cellId, 'inject-failed');
      }
      return result;
    }

    const result = await this.injectScript(cellId, adapter.injectScript(text));
    return result === true;
  }

  async forwardResponse(payload: ForwardResponsePayload): Promise<ForwardRecord> {
    if (this.isDestroyed()) {
      throw new Error('Window has been destroyed.');
    }

    const { sourceCellId, targetCellId } = payload;
    if (!isKnownCellId(sourceCellId) || !isKnownCellId(targetCellId)) {
      throw new Error('Unknown source or target cell.');
    }
    if (sourceCellId === targetCellId) {
      throw new Error('Source and target cells must be different.');
    }

    await this.waitForCellReady(sourceCellId);
    if (!(await this.isResponseComplete(sourceCellId))) {
      this.showCellNotice(sourceCellId, 'source-response-pending');
      await this.waitForResponseComplete(sourceCellId);
    }

    const source = await this.getCellFullContext(sourceCellId);
    if (!source.content) {
      throw new Error(`No readable source context in ${sourceCellId}.`);
    }
    if (source.truncated) {
      this.showCellNotice(sourceCellId, 'conversation-truncated');
    }

    const record: ForwardRecord = {
      id: createRecordId(),
      sourceCellId,
      targetCellId,
      sourceContent: source.content,
      sourceTruncated: source.truncated,
      targetReply: '',
      timestamp: Date.now(),
    };

    this.forwardRecords.push(record);
    try {
      await this.crossValidateCells(sourceCellId, targetCellId, source.content, source.truncated, record.id);
    } catch (error) {
      this.forwardRecords = this.forwardRecords.filter((candidate) => candidate.id !== record.id);
      throw error;
    }
    this.sendToRenderer(IPC.FORWARD_COMPLETED, { record });
    return record;
  }

  getDocumentCandidates(): DocumentCandidate[] {
    if (this.isDestroyed()) {
      return [];
    }

    return this.getDocumentCandidateCellIds().map((cellId) => ({
      cellId,
      url: this.cellUrls[cellId] ?? '',
      active: Boolean(this.activeCells[cellId]),
      hasTimeline: this.hasTimelineContent(cellId),
    }));
  }

  async generateDocument(payload: GenerateDocumentPayload): Promise<void> {
    if (this.isDestroyed()) {
      throw new Error('Window has been destroyed.');
    }

    const { summarizerCellId } = payload;
    if (!isKnownCellId(summarizerCellId)) {
      throw new Error('Unknown summarizer cell.');
    }
    if (!this.cellUrls[summarizerCellId]?.trim()) {
      throw new Error(`No URL configured for ${summarizerCellId}.`);
    }

    const candidateCellIds = this.getDocumentCandidateCellIds();
    if (!candidateCellIds.includes(summarizerCellId)) {
      throw new Error('Summarizer cell is not part of the current discussion.');
    }

    await this.waitForTargetReadyForForward(summarizerCellId);
    const knownContext = formatTimelineContext(this.getOrCreateTimeline(summarizerCellId).entries);
    const latestResponse = await this.extractLatestResponseIfSupported(summarizerCellId);
    const language = detectContentLanguage(knownContext || latestResponse || '');
    const prompt = buildDocumentPrompt(language);
    this.beginTimelineNavigationCarry(summarizerCellId);
    const injected = await this.injectText(summarizerCellId, prompt);
    if (!injected) {
      this.cancelTimelineNavigationCarry(summarizerCellId);
      throw new Error(`Unable to inject document prompt into ${summarizerCellId}.`);
    }

    this.appendTimelineEntry(summarizerCellId, {
      role: 'user',
      content: prompt,
      source: 'document-generation',
      timestamp: Date.now(),
    });
  }

  private async crossValidateCells(
    sourceCellId: string,
    targetCellId: string,
    sourceContent: string,
    sourceTruncated: boolean,
    recordId: string,
  ): Promise<void> {
    await this.waitForTargetReadyForForward(targetCellId);

    const previousTargetResponse = await this.extractLatestResponseIfSupported(targetCellId);
    const targetPrompt = buildForwardPrompt(sourceContent, sourceTruncated);
    this.beginTimelineNavigationCarry(targetCellId);
    const injected = await this.injectText(targetCellId, targetPrompt);
    if (!injected) {
      this.cancelTimelineNavigationCarry(targetCellId);
      throw new Error(`Unable to inject cross-validation prompt into ${targetCellId}.`);
    }

    this.appendTimelineEntry(targetCellId, {
      role: 'user',
      content: sourceContent,
      source: 'forward-injection',
      timestamp: Date.now(),
    });
    this.scheduleForwardAssistantCapture(targetCellId, previousTargetResponse, recordId);
  }

  private async waitForTargetReadyForForward(cellId: string): Promise<void> {
    await this.waitForCellReady(cellId);

    const currentResponse = await this.extractLatestResponse(cellId);
    if (!currentResponse) {
      return;
    }

    await this.waitForResponseComplete(cellId);
    await this.waitForCellReady(cellId);
  }

  async extractConversation(cellId: string): Promise<ExtractedConversation | null> {
    if (this.isDestroyed()) {
      return null;
    }

    const adapter = this.getAdapter(cellId);
    if (!adapter.extractConversation) {
      return null;
    }

    const result = await this.executeCellScript(cellId, adapter.extractConversation());
    return normalizeExtractedConversation(result);
  }

  async extractLatestResponse(cellId: string): Promise<string | null> {
    if (this.isDestroyed()) {
      return null;
    }

    const adapter = this.getReadableAdapter(cellId);
    const result = await this.executeCellScript(cellId, adapter.extractLatestResponse());
    if (typeof result !== 'string') {
      return null;
    }

    const cleaned = cleanExtractedText(result);
    return cleaned ? cleaned : null;
  }

  private async extractLatestResponseIfSupported(cellId: string): Promise<string | null> {
    try {
      return await this.extractLatestResponse(cellId);
    } catch {
      return null;
    }
  }

  private async getCellFullContext(cellId: string): Promise<{
    content: string | null;
    truncated: boolean;
    partial: boolean;
  }> {
    const syncedFromDom = await this.syncTimelineFromDomIfSupported(cellId);
    await this.ensureLatestAssistantInTimeline(cellId, 'dom-detected');

    const timeline = this.getOrCreateTimeline(cellId);
    const fullText = formatTimelineContext(timeline.entries);
    if (!fullText) {
      return {
        content: null,
        truncated: false,
        partial: false,
      };
    }

    const truncated = truncateConversation(fullText);
    return {
      content: truncated.text,
      truncated: truncated.truncated,
      partial: !syncedFromDom,
    };
  }

  private getDocumentCandidateCellIds(): string[] {
    return this.getDocumentDiscussionCellIds().filter((cellId) => {
      const adapter = getAdapterForUrl(this.cellUrls[cellId] ?? '');
      return Boolean(adapter?.extractLatestResponse && adapter.isResponseComplete);
    });
  }

  private getDocumentDiscussionCellIds(): string[] {
    return LAYOUT_CELLS[this.layoutMode].filter((cellId) => {
      if (!this.cellUrls[cellId]?.trim()) {
        return false;
      }
      return Boolean(this.activeCells[cellId]) || this.hasTimelineContent(cellId);
    });
  }

  private hasTimelineContent(cellId: string): boolean {
    return this.getOrCreateTimeline(cellId).entries.some((entry) => Boolean(entry.content.trim()));
  }

  private async syncTimelineFromDomIfSupported(cellId: string): Promise<boolean> {
    let conversation: ExtractedConversation | null = null;
    try {
      conversation = await this.extractConversation(cellId);
    } catch {
      return false;
    }

    if (!conversation?.entries.length) {
      return false;
    }

    let timeline = this.getOrCreateTimeline(cellId);
    const sortedEntries = normalizeDomTimelineEntries(conversation.entries);
    let appended = false;

    sortedEntries.forEach((entry) => {
      if (this.timelineHasEntry(timeline, entry)) {
        return;
      }

      this.appendTimelineEntry(cellId, {
        ...entry,
        timestamp: Date.now(),
        domId: entry.domId,
        order: entry.order,
      });
      appended = true;
    });

    timeline.lastDomSyncedEntryCount = Math.max(timeline.lastDomSyncedEntryCount, sortedEntries.length);
    return true;
  }

  private async ensureLatestAssistantInTimeline(cellId: string, source: TimelineEntrySource): Promise<void> {
    const latestResponse = await this.extractLatestResponseIfSupported(cellId);
    if (!latestResponse) {
      return;
    }

    const timeline = this.getOrCreateTimeline(cellId);
    if (timeline.entries.some((entry) => (
      entry.role === 'assistant'
      && existingContentCoversNewContent(entry.content, latestResponse)
    ))) {
      return;
    }

    this.appendTimelineEntry(cellId, {
      role: 'assistant',
      content: latestResponse,
      source,
      timestamp: Date.now(),
    });
  }

  private scheduleAssistantCapture(cellId: string, previousResponse: string | null, source: TimelineEntrySource): void {
    const previousChain = this.assistantCaptureChains.get(cellId) ?? Promise.resolve();
    const nextChain = previousChain
      .catch(() => undefined)
      .then(async () => {
        if (this.isDestroyed()) {
          return;
        }
        const response = await this.waitForNextResponse(cellId, previousResponse);
        await this.syncTimelineFromDomIfSupported(cellId);
        this.appendTimelineEntry(cellId, {
          role: 'assistant',
          content: response,
          source,
          timestamp: Date.now(),
        });
      })
      .catch((error) => {
        if (!this.isDestroyed()) {
          console.warn(`Unable to capture assistant response for ${cellId}:`, error);
        }
      })
      .finally(() => {
        this.commitCurrentCellUrlFromView(cellId);
        this.cancelTimelineNavigationCarry(cellId);
      });

    this.assistantCaptureChains.set(cellId, nextChain);
  }

  private scheduleForwardAssistantCapture(cellId: string, previousResponse: string | null, recordId: string): void {
    const previousChain = this.assistantCaptureChains.get(cellId) ?? Promise.resolve();
    const nextChain = previousChain
      .catch(() => undefined)
      .then(async () => {
        if (this.isDestroyed()) {
          return;
        }

        const response = await this.waitForNextResponse(cellId, previousResponse);
        this.appendTimelineEntry(cellId, {
          role: 'assistant',
          content: response,
          source: 'forward-injection',
          timestamp: Date.now(),
        });

        const record = this.forwardRecords.find((candidate) => candidate.id === recordId);
        if (record) {
          record.targetReply = response;
        }
      })
      .catch((error) => {
        if (!this.isDestroyed()) {
          console.warn(`Unable to capture forwarded assistant response for ${cellId}:`, error);
        }
      })
      .finally(() => {
        this.commitCurrentCellUrlFromView(cellId);
        this.cancelTimelineNavigationCarry(cellId);
      });

    this.assistantCaptureChains.set(cellId, nextChain);
  }

  private getOrCreateTimeline(cellId: string): CellTimeline {
    const key = this.getTimelineKey(cellId);
    const existing = this.cellTimelines.get(key);
    if (existing) {
      return existing;
    }

    const timeline: CellTimeline = {
      cellId,
      key,
      entries: [],
      lastDomSyncedEntryCount: 0,
    };
    this.cellTimelines.set(key, timeline);
    return timeline;
  }

  private getTimelineKey(cellId: string): string {
    const activeTabId = this.activeTabIds[cellId];
    return activeTabId ? `${cellId}:${activeTabId}` : cellId;
  }

  private appendTimelineEntry(cellId: string, entry: TimelineEntry): void {
    const timeline = this.getOrCreateTimeline(cellId);
    if (entry.role === 'assistant' && isForwardPromptText(entry.content)) {
      return;
    }

    const nextEntry = {
      ...entry,
      content: entry.content.trim(),
    };

    if (nextEntry.source === 'forward-injection') {
      nextEntry.content = stripExistingRoleBlocksFromForwardContent(timeline, nextEntry.content);
    }

    if (nextEntry.role === 'user') {
      timeline.entries
        .filter((existing) => existing.role === 'assistant')
        .forEach((assistantEntry) => {
          nextEntry.content = stripContainedTrailingContent(nextEntry.content, assistantEntry.content);
        });
    } else {
      stripExistingUserEntriesContainingAssistant(timeline, nextEntry.content);
    }

    const normalizedContent = normalizeTimelineContent(nextEntry.content);
    if (!normalizedContent) {
      return;
    }

    if (nextEntry.domId) {
      const existingByDomId = timeline.entries.find((existing) => existing.domId === nextEntry.domId);
      if (existingByDomId) {
        if (newContentCoversExistingContent(normalizedContent, existingByDomId.content)) {
          existingByDomId.content = nextEntry.content;
          existingByDomId.timestamp = nextEntry.timestamp;
          existingByDomId.order = nextEntry.order;
        }
        return;
      }
    }

    const coveredByExisting = timeline.entries.some((existing) => (
      existing.role === entry.role
      && existingContentCoversNewContent(existing.content, normalizedContent)
    ));
    if (coveredByExisting) {
      return;
    }

    for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
      const existing = timeline.entries[index];
      if (
        existing.role === entry.role
        && newContentCoversExistingContent(normalizedContent, existing.content)
      ) {
        timeline.entries.splice(index, 1);
      }
    }

    timeline.entries.push({
      ...nextEntry,
    });
  }

  private timelineHasEntry(timeline: CellTimeline, entry: Omit<TimelineEntry, 'timestamp'>): boolean {
    if (entry.domId && timeline.entries.some((existing) => existing.domId === entry.domId)) {
      return true;
    }

    const normalizedContent = normalizeTimelineContent(entry.content);
    return timeline.entries.some((existing) => (
      existing.role === entry.role
      && existingContentCoversNewContent(existing.content, normalizedContent)
    ));
  }

  private resetTimeline(cellId: string): void {
    const key = this.getTimelineKey(cellId);
    this.cellTimelines.set(key, {
      cellId,
      key,
      entries: [],
      lastDomSyncedEntryCount: 0,
    });
  }

  private beginTimelineNavigationCarry(cellId: string): void {
    if (!isKnownCellId(cellId)) {
      return;
    }

    this.timelineNavigationCarryUntil.set(cellId, Date.now() + TIMELINE_NAVIGATION_CARRY_MS);
  }

  private cancelTimelineNavigationCarry(cellId: string): void {
    this.timelineNavigationCarryUntil.delete(cellId);
  }

  private shouldCarryTimelineAcrossNavigation(cellId: string, previousUrl: string, nextUrl: string): boolean {
    const carryUntil = this.timelineNavigationCarryUntil.get(cellId);
    if (!carryUntil || Date.now() > carryUntil) {
      this.timelineNavigationCarryUntil.delete(cellId);
      return false;
    }

    const shouldCarry = getSiteKey(previousUrl) !== '' && getSiteKey(previousUrl) === getSiteKey(nextUrl);
    if (shouldCarry) {
      this.timelineNavigationCarryUntil.delete(cellId);
    }
    return shouldCarry;
  }

  async isResponseComplete(cellId: string): Promise<boolean> {
    if (this.isDestroyed()) {
      return false;
    }

    const adapter = this.getReadableAdapter(cellId);
    const result = await this.executeCellScript(cellId, adapter.isResponseComplete());
    return result === true;
  }

  async waitForResponseComplete(cellId: string, timeoutMs = RESPONSE_WAIT_TIMEOUT_MS): Promise<void> {
    const startedAt = Date.now();
    let completeChecks = 0;

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${cellId} response completion.`);
      }

      if (await this.isResponseComplete(cellId)) {
        completeChecks += 1;
        if (completeChecks >= 2) {
          return;
        }
      } else {
        completeChecks = 0;
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }
  }

  async waitForCellReady(cellId: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    const startedAt = Date.now();

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for ${cellId} input readiness.`);
      }

      const url = this.cellUrls[cellId]?.trim();
      const adapter = url ? getAdapterForUrl(url) : null;
      if (adapter?.readyCheckScript) {
        try {
          const ready = await this.executeCellScript(cellId, adapter.readyCheckScript);
          if (ready === true) {
            return;
          }
        } catch {
          // The page may still be navigating; keep polling until the timeout.
        }
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }

    throw new Error(`Window closed while waiting for ${cellId} readiness.`);
  }

  async waitForNextResponse(
    cellId: string,
    previousResponse: string | null,
    timeoutMs = RESPONSE_WAIT_TIMEOUT_MS,
  ): Promise<string> {
    const startedAt = Date.now();
    let sawGeneration = false;
    let latestResponse: string | null = null;
    let stableChecks = 0;

    while (!this.isDestroyed()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for next response in ${cellId}.`);
      }

      const complete = await this.isResponseComplete(cellId);
      if (!complete) {
        sawGeneration = true;
        stableChecks = 0;
      }

      const response = await this.extractLatestResponse(cellId);
      const hasNewResponse = Boolean(response && response !== previousResponse);
      if (complete && hasNewResponse && (sawGeneration || Date.now() - startedAt > RESPONSE_POLL_INTERVAL_MS * 2)) {
        if (response === latestResponse) {
          stableChecks += 1;
        } else {
          latestResponse = response;
          stableChecks = 1;
        }

        if (stableChecks >= 2 && latestResponse) {
          return latestResponse;
        }
      }

      await delay(RESPONSE_POLL_INTERVAL_MS);
    }

    throw new Error(`Window closed while waiting for next response in ${cellId}.`);
  }

  async injectScript(cellId: string, script: string): Promise<unknown> {
    if (this.isDestroyed()) {
      return false;
    }

    const view = this.views.get(cellId);
    if (!view || view.webContents.isDestroyed()) {
      return false;
    }

    try {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return false;
      }
      const result = await view.webContents.executeJavaScript(script);
      if (result === false) {
        this.showCellNotice(cellId, 'inject-failed');
      }
      return result;
    } catch {
      this.showCellNotice(cellId, 'inject-failed');
      return false;
    }
  }

  private async injectNativeClickSiteText(
    cellId: string,
    text: string,
    nativeInjection: SiteNativeInjection,
  ): Promise<boolean> {
    if (this.isDestroyed()) {
      return false;
    }

    try {
      const view = this.views.get(cellId);
      if (!view || view.webContents.isDestroyed()) {
        return false;
      }

      const prepared = nativeInjection.usesNativeTextInsertion
        ? await this.prepareNativeTextInput(view.webContents, cellId, text, nativeInjection)
        : await this.executeCellScript(cellId, nativeInjection.prepareScript(text));
      if (!isNativeClickTarget(prepared)) {
        return false;
      }

      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return false;
      }

      if (nativeInjection.beforeNativeClickScript) {
        await this.executeCellScript(cellId, nativeInjection.beforeNativeClickScript(text));
        let accepted = await this.executeCellScript(cellId, nativeInjection.acceptedScript);
        if (accepted === true) {
          return true;
        }
      }

      view.webContents.focus();
      view.webContents.sendInputEvent({
        type: 'mouseMove',
        x: prepared.x,
        y: prepared.y,
      });
      view.webContents.sendInputEvent({
        type: 'mouseDown',
        x: prepared.x,
        y: prepared.y,
        button: 'left',
        clickCount: 1,
      });
      view.webContents.sendInputEvent({
        type: 'mouseUp',
        x: prepared.x,
        y: prepared.y,
        button: 'left',
        clickCount: 1,
      });

      let accepted = await this.executeCellScript(cellId, nativeInjection.acceptedScript);
      if (accepted === true) {
        return true;
      }

      if (nativeInjection.enterFallbackScript) {
        const focused = await this.executeCellScript(cellId, nativeInjection.enterFallbackScript);
        if (focused !== true || this.isDestroyed() || view.webContents.isDestroyed()) {
          return false;
        }

        view.webContents.focus();
        view.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'Enter',
        });
        view.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: 'Enter',
        });
        accepted = await this.executeCellScript(cellId, nativeInjection.acceptedScript);
      }

      return accepted === true;
    } catch {
      return false;
    }
  }

  private async prepareNativeTextInput(
    webContents: WebContents,
    cellId: string,
    text: string,
    nativeInjection: SiteNativeInjection,
  ): Promise<unknown> {
    if (!nativeInjection.clickTargetScript) {
      return null;
    }

    const focused = await this.executeCellScript(cellId, nativeInjection.prepareScript(text));
    if (focused !== true) {
      return null;
    }

    if (this.isDestroyed() || webContents.isDestroyed()) {
      return null;
    }

    webContents.focus();
    await webContents.insertText(text);
    return this.executeCellScript(cellId, nativeInjection.clickTargetScript(text));
  }

  private getReadableAdapter(cellId: string): {
    extractLatestResponse: () => string;
    isResponseComplete: () => string;
  } {
    const adapter = this.getAdapter(cellId);
    if (!adapter?.extractLatestResponse || !adapter.isResponseComplete) {
      throw new Error(`No readable adapter for ${cellId}: ${this.cellUrls[cellId]}.`);
    }

    return {
      extractLatestResponse: adapter.extractLatestResponse,
      isResponseComplete: adapter.isResponseComplete,
    };
  }

  private getAdapter(cellId: string) {
    if (!isKnownCellId(cellId)) {
      throw new Error(`Unknown cell: ${cellId}.`);
    }

    const url = this.cellUrls[cellId]?.trim();
    if (!url) {
      throw new Error(`No URL configured for ${cellId}.`);
    }

    const adapter = getAdapterForUrl(url);
    if (!adapter) {
      throw new Error(`No adapter for ${cellId}: ${url}.`);
    }

    return adapter;
  }

  private async executeCellScript(cellId: string, script: string): Promise<unknown> {
    if (this.isDestroyed()) {
      return null;
    }

    const view = this.views.get(cellId);
    if (!view || view.webContents.isDestroyed()) {
      throw new Error(`No active view for ${cellId}.`);
    }

    return view.webContents.executeJavaScript(script);
  }

  getBrowserState(): BrowserState {
    return {
      layoutMode: this.layoutMode,
      cellUrls: { ...this.cellUrls },
      cellModes: { ...this.cellModes },
      searchUrlTemplates: { ...this.searchUrlTemplates },
      activeCells: { ...this.activeCells },
      mutedCells: { ...this.mutedCells },
      tabs: cloneTabs(this.tabs),
      activeTabIds: { ...this.activeTabIds },
      themeMode: this.themeMode,
      language: this.language,
      conversationEntryMode: this.conversationEntryMode,
      forwardControlsEnabled: this.forwardControlsEnabled,
      focusedCellId: this.focusedCellId,
      maximizedCellId: this.maximizedCellId,
      hasCompletedOnboarding: Boolean(this.store.get('browser.hasCompletedOnboarding', false)),
    };
  }

  applyTemplate(payload: ApplyTemplatePayload): BrowserState {
    if (this.isDestroyed()) {
      return this.getBrowserState();
    }

    const { template } = payload;
    this.store.set('browser.hasCompletedOnboarding', true);

    template.siteIds.forEach((siteId, index) => {
      const cellId = CELL_IDS[index];
      const site = PRESET_SITES.find((presetSite) => presetSite.id === siteId);
      if (!cellId || !site) {
        return;
      }

      this.cellUrls[cellId] = site.url;
      this.cellModes[cellId] = site.mode;
      this.searchUrlTemplates[cellId] = site.searchUrlTemplate ?? '';
      this.store.set(`cells.${cellId}.url`, site.url);
      this.store.set(`cells.${cellId}.mode`, site.mode);
      this.store.set(`cells.${cellId}.searchUrlTemplate`, site.searchUrlTemplate ?? '');
      this.store.set(`cells.${cellId}.active`, true);
      this.activeCells[cellId] = true;
      this.syncCellState(cellId);
    });

    LAYOUT_CELLS[template.layout].slice(template.siteIds.length).forEach((cellId) => {
      this.cellUrls[cellId] = '';
      this.cellModes[cellId] = 'chat';
      this.searchUrlTemplates[cellId] = '';
      this.activeCells[cellId] = false;
      this.store.set(`cells.${cellId}.url`, '');
      this.store.set(`cells.${cellId}.mode`, 'chat');
      this.store.set(`cells.${cellId}.searchUrlTemplate`, '');
      this.store.set(`cells.${cellId}.active`, false);
      this.syncCellState(cellId);
    });

    this.focusCell('cell-0');
    this.setLayout(template.layout, false);
    LAYOUT_CELLS[template.layout].forEach((cellId) => {
      const url = this.cellUrls[cellId];
      if (url) {
        this.loadCellUrl(cellId, url);
      }
    });

    return this.getBrowserState();
  }

  dispose(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.loadTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.loadTimeouts.clear();

    this.views.forEach((view) => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.removeAllListeners();
      }
    });
  }

  private ensureView(cellId: string): WebContentsView {
    if (this.isDestroyed()) {
      throw new Error('WindowManager has been destroyed');
    }

    const partition = this.getPartitionForUrl(this.cellUrls[cellId], cellId);
    const existingView = this.views.get(cellId);
    if (existingView) {
      if (this.viewPartitions.get(cellId) !== partition) {
        return this.replaceView(cellId, partition);
      }

      return existingView;
    }

    return this.createView(cellId, partition);
  }

  private createView(cellId: string, partition: string): WebContentsView {
    if (this.isDestroyed()) {
      throw new Error('WindowManager has been destroyed');
    }

    this.rememberSitePartition(this.cellUrls[cellId], partition);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition,
      },
    });

    if (!view.webContents.isDestroyed()) {
      view.webContents.setUserAgent(CHROME_USER_AGENT);
      view.webContents.setAudioMuted(Boolean(this.mutedCells[cellId]));
    }
    this.bindViewEvents(cellId, view);
    this.views.set(cellId, view);
    this.viewPartitions.set(cellId, partition);
    this.loadViewUrl(view, this.getLoadUrl(this.cellUrls[cellId]));
    return view;
  }

  private replaceView(cellId: string, partition: string): WebContentsView {
    const existingView = this.views.get(cellId);
    const wasAttached = this.attachedViews.has(cellId);

    if (existingView) {
      this.clearLoadTimeout(cellId);
      if (wasAttached) {
        this.removeChildView(existingView);
        this.attachedViews.delete(cellId);
      }

      if (!existingView.webContents.isDestroyed()) {
        existingView.webContents.removeAllListeners();
        existingView.webContents.close({ waitForBeforeUnload: false });
      }
      this.views.delete(cellId);
      this.viewPartitions.delete(cellId);
    }

    const view = this.createView(cellId, partition);
    if (wasAttached) {
      this.addChildView(view);
      this.attachedViews.add(cellId);
    }

    return view;
  }

  private loadCellUrl(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    const view = this.ensureView(cellId);
    this.loadViewUrl(view, this.getLoadUrl(url));
  }

  private fillDefaultUrlsForVisibleCells(cellIds: string[]): void {
    cellIds.forEach((cellId) => {
      if (this.cellUrls[cellId]?.trim()) {
        return;
      }

      const defaultUrl = DEFAULT_URLS[cellId];
      if (!defaultUrl) {
        return;
      }

      this.cellUrls[cellId] = defaultUrl;
      this.store.set(`cells.${cellId}.url`, defaultUrl);
      this.setCellMode(cellId, inferCellMode(defaultUrl));
      this.setSearchUrlTemplate(cellId, inferSearchUrlTemplate(defaultUrl, this.cellModes[cellId]));
      this.syncCellState(cellId);
    });
  }

  private setCellMode(cellId: string, mode: CellMode): void {
    this.cellModes[cellId] = mode;
    this.store.set(`cells.${cellId}.mode`, mode);
    this.syncCellState(cellId);
  }

  private setSearchUrlTemplate(cellId: string, template: string): void {
    this.searchUrlTemplates[cellId] = template;
    this.store.set(`cells.${cellId}.searchUrlTemplate`, template);
  }

  private getSearchUrlTemplate(cellId: string): string {
    return this.searchUrlTemplates[cellId] || inferSearchUrlTemplate(this.cellUrls[cellId], this.cellModes[cellId]);
  }

  private updateKnownSiteMetadata(cellId: string, url: string): void {
    const site = findPresetSiteByUrl(url);
    if (!site) {
      return;
    }

    const searchUrlTemplate = site.searchUrlTemplate ?? inferSearchUrlTemplate(url, site.mode);
    this.cellModes[cellId] = site.mode;
    this.searchUrlTemplates[cellId] = searchUrlTemplate;
    this.store.set(`cells.${cellId}.mode`, site.mode);
    this.store.set(`cells.${cellId}.searchUrlTemplate`, searchUrlTemplate);
  }

  private createCellStates(): Map<string, CellState> {
    return new Map(
      CELL_IDS.map((cellId) => [
        cellId,
        {
          url: this.cellUrls[cellId] ?? '',
          active: Boolean(this.activeCells[cellId] && this.cellUrls[cellId]?.trim()),
          mode: this.cellModes[cellId] ?? 'chat',
        },
      ]),
    );
  }

  private syncCellState(cellId: string): void {
    if (!isKnownCellId(cellId)) {
      return;
    }

    this.cellStates.set(cellId, {
      url: this.cellUrls[cellId] ?? '',
      active: Boolean(this.activeCells[cellId] && this.cellUrls[cellId]?.trim()),
      mode: this.cellModes[cellId] ?? 'chat',
    });
  }

  private registerLegacySitePartitions(): void {
    CELL_IDS.forEach((cellId) => {
      const url = this.cellUrls[cellId];
      if (url) {
        this.rememberSitePartition(url, `persist:${cellId}`);
      }
    });
  }

  private rememberCurrentSitePartition(cellId: string): void {
    const currentUrl = this.cellUrls[cellId];
    const currentPartition = this.viewPartitions.get(cellId) ?? `persist:${cellId}`;
    this.rememberSitePartition(currentUrl, currentPartition);
  }

  private rememberSitePartition(url: string, partition: string): void {
    const siteKey = getSiteKey(url);
    if (!siteKey || this.getStoredSitePartition(siteKey)) {
      return;
    }

    this.store.set(getSitePartitionStoreKey(siteKey), partition);
  }

  private getPartitionForUrl(url: string, fallbackCellId: string): string {
    const siteKey = getSiteKey(url);
    if (!siteKey) {
      return `persist:${fallbackCellId}`;
    }

    const storedPartition = this.getStoredSitePartition(siteKey);
    if (storedPartition) {
      return storedPartition;
    }

    const partition = `persist:site-${siteKey}`;
    this.store.set(getSitePartitionStoreKey(siteKey), partition);
    return partition;
  }

  private getStoredSitePartition(siteKey: string): string | null {
    const storedPartition = this.store.get(getSitePartitionStoreKey(siteKey));
    return typeof storedPartition === 'string' && storedPartition.startsWith('persist:')
      ? storedPartition
      : null;
  }

  private getPersistedUrlAfterLoad(cellId: string, loadedUrl: string): string {
    if (isClaudeAiUrl(this.cellUrls[cellId]) && isClaudeComUrl(loadedUrl)) {
      return 'https://claude.ai/';
    }

    return loadedUrl;
  }

  private bindViewEvents(cellId: string, view: WebContentsView): void {
    this.bindShortcutEvents(view.webContents);
    view.webContents.on('focus', () => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.focusCell(cellId);
    });
    view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      if (!isInPlace && isMainFrame && !isEmptyStateUrl(url)) {
        this.startLoadTimeout(cellId, url);
      }
    });
    view.webContents.on('did-navigate', (_event, url) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      const publicUrl = this.toPublicUrl(url);
      if (this.shouldIgnoreNavigationDuringEmptyTabLoad(cellId, publicUrl)) {
        return;
      }
      this.commitCellUrlFromNavigation(cellId, publicUrl);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
    });
    view.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      // SPA navigation also fires for iframes; only the top-level URL belongs to the tab.
      if (!isMainFrame) {
        return;
      }

      const publicUrl = this.toPublicUrl(url);
      if (this.shouldIgnoreNavigationDuringEmptyTabLoad(cellId, publicUrl)) {
        return;
      }
      this.commitCellUrlFromNavigation(cellId, publicUrl);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
    });
    view.webContents.on('page-title-updated', (_event, title) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.updateActiveTab(cellId, { title });
      this.sendToRenderer(IPC.CELL_TITLE_CHANGED, { cellId, title });
    });
    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      if (this.shouldIgnoreFaviconForEmptyTab(cellId, view)) {
        return;
      }

      const favicon = favicons[0];
      if (favicon) {
        this.updateActiveTab(cellId, { favicon });
        this.sendToRenderer(IPC.CELL_FAVICON_CHANGED, { cellId, favicon });
      }
    });
    view.webContents.on('did-finish-load', () => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.clearLoadTimeout(cellId);
      const publicUrl = this.toPublicUrl(view.webContents.getURL());
      if (this.shouldIgnoreNavigationDuringEmptyTabLoad(cellId, publicUrl)) {
        return;
      }
      this.pendingEmptyTabLoads.delete(cellId);
      const persistedUrl = this.getPersistedUrlAfterLoad(cellId, publicUrl);
      this.resetTimelineForUrlChange(cellId, this.cellUrls[cellId], persistedUrl, { allowCarry: true });
      this.cellUrls[cellId] = persistedUrl;
      this.store.set(`cells.${cellId}.url`, persistedUrl);
      this.updateKnownSiteMetadata(cellId, publicUrl);
      this.updateActiveTab(cellId, {
        url: persistedUrl,
        title: publicUrl ? view.webContents.getTitle() || safeTabTitle(publicUrl) : getNewTabTitle(this.language),
      });
      this.syncCellState(cellId);
      this.sendUrl(cellId, publicUrl);
      this.checkNavigationNotice(cellId, publicUrl);
      this.sendToRenderer(IPC.CELL_TITLE_CHANGED, {
        cellId,
        title: publicUrl ? view.webContents.getTitle() : getNewTabTitle(this.language),
      });
    });
    view.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (this.isDestroyed() || view.webContents.isDestroyed()) {
        return;
      }

      this.clearLoadTimeout(cellId);
      if (isMainFrame && errorCode !== -3 && validatedURL !== BLANK_URL && !isEmptyStateUrl(validatedURL)) {
        this.showCellNotice(cellId, 'load-failed');
      }
    });
    view.webContents.on('destroyed', () => {
      this.clearLoadTimeout(cellId);
    });
  }

  private getBoundsByCell(width: number, contentHeight: number): Record<string, Electron.Rectangle> {
    const y = TOOLBAR_HEIGHT;

    if (this.layoutMode === 'single') {
      return {
        'cell-0': { x: 0, y, width, height: contentHeight },
        'cell-1': { x: 0, y, width: 0, height: 0 },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'horizontal') {
      const leftWidth = splitSize(width);
      return {
        'cell-0': { x: 0, y, width: leftWidth, height: contentHeight },
        'cell-1': {
          x: leftWidth + SPLITTER_SIZE,
          y,
          width: Math.max(0, width - leftWidth - SPLITTER_SIZE),
          height: contentHeight,
        },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'vertical') {
      const topHeight = splitSize(contentHeight);
      return {
        'cell-0': { x: 0, y, width, height: topHeight },
        'cell-1': {
          x: 0,
          y: y + topHeight + SPLITTER_SIZE,
          width,
          height: Math.max(0, contentHeight - topHeight - SPLITTER_SIZE),
        },
        'cell-2': { x: 0, y, width: 0, height: 0 },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    if (this.layoutMode === 'triple') {
      const leftWidth = splitSize(width);
      const rightWidth = Math.max(0, width - leftWidth - SPLITTER_SIZE);
      const topHeight = splitSize(contentHeight);

      return {
        'cell-0': { x: 0, y, width: leftWidth, height: contentHeight },
        'cell-1': { x: leftWidth + SPLITTER_SIZE, y, width: rightWidth, height: topHeight },
        'cell-2': {
          x: leftWidth + SPLITTER_SIZE,
          y: y + topHeight + SPLITTER_SIZE,
          width: rightWidth,
          height: Math.max(0, contentHeight - topHeight - SPLITTER_SIZE),
        },
        'cell-3': { x: 0, y, width: 0, height: 0 },
      };
    }

    const leftWidth = splitSize(width);
    const rightWidth = Math.max(0, width - leftWidth - SPLITTER_SIZE);
    const topHeight = splitSize(contentHeight);
    const bottomHeight = Math.max(0, contentHeight - topHeight - SPLITTER_SIZE);

    return {
      'cell-0': { x: 0, y, width: leftWidth, height: topHeight },
      'cell-1': { x: leftWidth + SPLITTER_SIZE, y, width: rightWidth, height: topHeight },
      'cell-2': { x: 0, y: y + topHeight + SPLITTER_SIZE, width: leftWidth, height: bottomHeight },
      'cell-3': {
        x: leftWidth + SPLITTER_SIZE,
        y: y + topHeight + SPLITTER_SIZE,
        width: rightWidth,
        height: bottomHeight,
      },
    };
  }

  private startLoadTimeout(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    this.clearLoadTimeout(cellId);
    if (!url || url === BLANK_URL) {
      return;
    }

    const timeout = setTimeout(() => {
      if (this.isDestroyed()) {
        return;
      }

      const view = this.views.get(cellId);
      if (!view || view.webContents.isDestroyed()) {
        return;
      }

      const currentUrl = view.webContents.getURL();
      if (currentUrl && currentUrl !== BLANK_URL && view.webContents.isLoading()) {
        this.showCellNotice(cellId, 'load-timeout');
      }
      this.loadTimeouts.delete(cellId);
    }, LOAD_TIMEOUT_MS);

    this.loadTimeouts.set(cellId, timeout);
  }

  private clearLoadTimeout(cellId: string): void {
    const timeout = this.loadTimeouts.get(cellId);
    if (!timeout) {
      return;
    }

    clearTimeout(timeout);
    this.loadTimeouts.delete(cellId);
  }

  private sendUrl(cellId: string, url: string): void {
    this.sendToRenderer(IPC.CELL_URL_CHANGED, { cellId, url });
  }

  private commitCellUrlFromNavigation(cellId: string, url: string): void {
    if (!url || url === BLANK_URL || isEmptyStateUrl(url)) {
      return;
    }

    const persistedUrl = this.getPersistedUrlAfterLoad(cellId, url);
    this.resetTimelineForUrlChange(cellId, this.cellUrls[cellId], persistedUrl, { allowCarry: true });
    this.cellUrls[cellId] = persistedUrl;
    this.store.set(`cells.${cellId}.url`, persistedUrl);
    this.updateKnownSiteMetadata(cellId, url);
    this.updateActiveTab(cellId, { url: persistedUrl });
    this.syncCellState(cellId);
  }

  private commitCurrentCellUrlFromView(cellId: string): void {
    const view = this.views.get(cellId);
    if (!view || view.webContents.isDestroyed()) {
      return;
    }

    this.commitCellUrlFromNavigation(cellId, this.toPublicUrl(view.webContents.getURL()));
  }

  private shouldIgnoreNavigationDuringEmptyTabLoad(cellId: string, publicUrl: string): boolean {
    if (!this.pendingEmptyTabLoads.has(cellId)) {
      return false;
    }

    if (!publicUrl) {
      return false;
    }

    const activeTab = this.tabs[cellId]?.find((tab) => tab.id === this.activeTabIds[cellId]);
    return !activeTab?.url;
  }

  private shouldIgnoreFaviconForEmptyTab(cellId: string, view: WebContentsView): boolean {
    const activeTab = this.tabs[cellId]?.find((tab) => tab.id === this.activeTabIds[cellId]);
    if (activeTab?.url) {
      return false;
    }

    return !this.toPublicUrl(view.webContents.getURL());
  }

  private resetTimelineForUrlChange(
    cellId: string,
    previousUrl: string,
    nextUrl: string,
    options: { allowCarry?: boolean } = {},
  ): void {
    if (!isKnownCellId(cellId)) {
      return;
    }

    const previous = normalizeTimelineNavigationUrl(previousUrl);
    const next = normalizeTimelineNavigationUrl(nextUrl);
    if (!previous || !next || previous === next) {
      return;
    }

    if (options.allowCarry && this.shouldCarryTimelineAcrossNavigation(cellId, previousUrl, nextUrl)) {
      return;
    }

    this.resetTimeline(cellId);
  }

  private checkNavigationNotice(cellId: string, url: string): void {
    if (this.isDestroyed()) {
      return;
    }

    if (url.includes('signin/rejected')) {
      this.showCellNotice(cellId, 'google-login-blocked');
    }
  }

  private showCellNotice(cellId: string, type: NoticeType): void {
    if (this.isDestroyed()) {
      return;
    }

    const payload = {
      cellId,
      type,
      messageKey: NOTICE_MESSAGE_KEYS[type],
    };

    this.sendToRenderer(IPC.SHOW_CELL_NOTICE, payload);
    setTimeout(() => {
      if (!this.isDestroyed()) {
        this.sendToRenderer(IPC.SHOW_CELL_NOTICE, payload);
      }
    }, NOTICE_REPLAY_DELAY_MS);
  }

  private getStoredLayoutMode(): LayoutMode {
    const storedLayout = this.store.get('browser.layout', 'single');
    return isLayoutMode(storedLayout) ? storedLayout : 'single';
  }

  private getStoredCellUrls(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((urls, cellId) => {
      const storedUrl = String(this.store.get(`cells.${cellId}.url`, DEFAULT_URLS[cellId]));
      urls[cellId] = repairPersistedSiteUrl(storedUrl);
      if (urls[cellId] !== storedUrl) {
        this.store.set(`cells.${cellId}.url`, urls[cellId]);
      }
      return urls;
    }, {});
  }

  private getStoredCellModes(): Record<string, CellMode> {
    return CELL_IDS.reduce<Record<string, CellMode>>((modes, cellId) => {
      const storedMode = this.store.get(`cells.${cellId}.mode`);
      modes[cellId] = isCellMode(storedMode) ? storedMode : inferCellMode(this.cellUrls[cellId]);
      return modes;
    }, {});
  }

  private getStoredSearchUrlTemplates(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((templates, cellId) => {
      templates[cellId] = String(
        this.store.get(
          `cells.${cellId}.searchUrlTemplate`,
          inferSearchUrlTemplate(this.cellUrls[cellId], this.cellModes[cellId]),
        ),
      );
      return templates;
    }, {});
  }

  private getStoredActiveCells(): Record<string, boolean> {
    return CELL_IDS.reduce<Record<string, boolean>>((activeCells, cellId) => {
      const hasUrl = Boolean(this.cellUrls[cellId]?.trim());
      activeCells[cellId] = Boolean(this.store.get(`cells.${cellId}.active`, hasUrl));
      return activeCells;
    }, {});
  }

  private getStoredMutedCells(): Record<string, boolean> {
    return CELL_IDS.reduce<Record<string, boolean>>((mutedCells, cellId) => {
      mutedCells[cellId] = Boolean(this.store.get(`cells.${cellId}.muted`, false));
      return mutedCells;
    }, {});
  }

  private getStoredTabs(): Record<string, CellTab[]> {
    return CELL_IDS.reduce<Record<string, CellTab[]>>((tabs, cellId) => {
      const storedTabs = this.store.get(`cells.${cellId}.tabs`);
      tabs[cellId] = isCellTabList(storedTabs)
        ? storedTabs.map((tab) => ({ ...tab, url: repairPersistedSiteUrl(tab.url) }))
        : [createTab(this.cellUrls[cellId], safeTabTitle(this.cellUrls[cellId]))];
      if (isCellTabList(storedTabs) && storedTabs.some((tab, index) => tab.url !== tabs[cellId][index].url)) {
        this.store.set(`cells.${cellId}.tabs`, tabs[cellId]);
      }
      return tabs;
    }, {});
  }

  private getStoredActiveTabIds(): Record<string, string> {
    return CELL_IDS.reduce<Record<string, string>>((activeTabIds, cellId) => {
      const storedTabId = this.store.get(`cells.${cellId}.activeTabId`);
      const tabs = this.tabs[cellId] ?? [];
      const activeTab = tabs.find((tab) => tab.id === storedTabId) ?? tabs[0];
      activeTabIds[cellId] = activeTab?.id ?? createTab('', getNewTabTitle(this.language)).id;
      return activeTabIds;
    }, {});
  }

  private getStoredThemeMode(): ThemeMode {
    const storedThemeMode = this.store.get('browser.themeMode', 'system');
    return isThemeMode(storedThemeMode) ? storedThemeMode : 'system';
  }

  private getStoredLanguage(): AppLanguage {
    const storedLanguage = this.store.get('app.language');
    return isAppLanguage(storedLanguage) ? storedLanguage : getSystemLanguage();
  }

  private getStoredConversationEntryMode(): ConversationEntryMode {
    const storedMode = this.store.get('conversation.entryMode');
    return isConversationEntryMode(storedMode) ? storedMode : 'embedded';
  }

  private getStoredForwardControlsEnabled(): boolean {
    return Boolean(this.store.get('features.forwardControlsEnabled', false));
  }

  private bindShortcutEvents(webContents: WebContents): void {
    webContents.on('before-input-event', (event, input) => {
      const nextLayout = getLayoutShortcut(input);
      if (!nextLayout) {
        return;
      }

      event.preventDefault();
      this.setLayout(nextLayout);
    });
  }

  private updateActiveTab(cellId: string, patch: Partial<Pick<CellTab, 'title' | 'url' | 'favicon'>>): void {
    const tabId = this.activeTabIds[cellId];
    const tabs = this.tabs[cellId];
    if (!tabId || !tabs) {
      return;
    }

    this.tabs[cellId] = tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
    this.storeTabs(cellId);
  }

  private storeTabs(cellId: string): void {
    this.store.set(`cells.${cellId}.tabs`, this.tabs[cellId] ?? []);
    this.store.set(`cells.${cellId}.activeTabId`, this.activeTabIds[cellId] ?? '');
  }

  private getStoredFocusedCellId(): string {
    const storedCellId = this.store.get('browser.focusedCellId', 'cell-0');
    return typeof storedCellId === 'string' && isKnownCellId(storedCellId) ? storedCellId : 'cell-0';
  }

  private isDestroyed(): boolean {
    return this.destroyed || this.window.isDestroyed() || this.window.webContents.isDestroyed();
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    if (this.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send(channel, payload);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private addChildView(view: WebContentsView): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    try {
      this.window.contentView.addChildView(view);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private syncAttachedViews(visibleCells: string[]): void {
    visibleCells.forEach((cellId) => {
      const view = this.ensureView(cellId);
      if (!this.attachedViews.has(cellId)) {
        this.addChildView(view);
        this.attachedViews.add(cellId);
      }
    });

    [...this.attachedViews].forEach((cellId) => {
      const view = this.views.get(cellId);
      if (view && !visibleCells.includes(cellId)) {
        this.removeChildView(view);
        this.attachedViews.delete(cellId);
      }
    });
  }

  private detachAllViews(): void {
    [...this.attachedViews].forEach((cellId) => {
      const view = this.views.get(cellId);
      if (view) {
        this.removeChildView(view);
      }
      this.attachedViews.delete(cellId);
    });
  }

  private removeChildView(view: WebContentsView): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    try {
      this.window.contentView.removeChildView(view);
    } catch (error) {
      if (!isDestroyedObjectError(error)) {
        throw error;
      }
    }
  }

  private loadViewUrl(view: WebContentsView, url: string): void {
    if (this.isDestroyed() || view.webContents.isDestroyed()) {
      return;
    }

    void view.webContents.loadURL(url).catch((error) => {
      if (!this.isDestroyed() && !isDestroyedObjectError(error)) {
        console.error('Failed to load URL:', error);
      }
    });
  }

  private getLoadUrl(url: string): string {
    return url || createEmptyStateUrl(this.language);
  }

  private toPublicUrl(url: string): string {
    return isEmptyStateUrl(url) || url === BLANK_URL ? '' : url;
  }

  private reloadEmptyStateViews(): void {
    if (this.isDestroyed()) {
      return;
    }

    CELL_IDS.forEach((cellId) => {
      if (this.cellUrls[cellId]) {
        return;
      }

      const view = this.views.get(cellId);
      if (!view || view.webContents.isDestroyed()) {
        return;
      }

      this.loadViewUrl(view, createEmptyStateUrl(this.language));
      this.updateActiveTab(cellId, { title: getNewTabTitle(this.language) });
      this.sendToRenderer(IPC.CELL_TITLE_CHANGED, { cellId, title: getNewTabTitle(this.language) });
    });
  }
}

function splitSize(total: number): number {
  if (total <= SPLITTER_SIZE) {
    return 0;
  }

  return Math.round((total - SPLITTER_SIZE) * 0.5);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function insetBounds(bounds: Electron.Rectangle, inset: number): Electron.Rectangle {
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(0, bounds.width - inset * 2),
    height: Math.max(0, bounds.height - inset * 2),
  };
}

function insetBoundsWithHeader(bounds: Electron.Rectangle, inset: number): Electron.Rectangle {
  const contentBounds = insetBounds(bounds, inset);
  return {
    ...contentBounds,
    y: contentBounds.y + CELL_HEADER_HEIGHT,
    height: Math.max(0, contentBounds.height - CELL_HEADER_HEIGHT),
  };
}

function isKnownCellId(cellId: string): boolean {
  return CELL_IDS.includes(cellId as (typeof CELL_IDS)[number]);
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && value in LAYOUT_CELLS;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'zh' || value === 'en';
}

function isConversationEntryMode(value: unknown): value is ConversationEntryMode {
  return value === 'embedded' || value === 'api';
}

function getNewDiscussionUrl(rawUrl: string): string {
  const preset = findPresetSiteByUrl(rawUrl);
  if (preset) {
    return preset.newConversationUrl ?? preset.url;
  }

  try {
    const url = new URL(normalizeUrl(rawUrl));
    return url.origin;
  } catch {
    return rawUrl;
  }
}
function isNativeClickTarget(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { x?: unknown; y?: unknown };
  return typeof candidate.x === 'number'
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y);
}

function getSystemLanguage(): AppLanguage {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function isCellTabList(value: unknown): value is CellTab[] {
  return Array.isArray(value)
    && value.every((tab) => (
      tab
      && typeof tab === 'object'
      && typeof (tab as CellTab).id === 'string'
      && typeof (tab as CellTab).title === 'string'
      && typeof (tab as CellTab).url === 'string'
      && (typeof (tab as CellTab).favicon === 'undefined' || typeof (tab as CellTab).favicon === 'string')
    ));
}

function createTab(url: string, title?: string): CellTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || safeTabTitle(url),
    url,
  };
}

function cloneTabs(tabs: Record<string, CellTab[]>): Record<string, CellTab[]> {
  return CELL_IDS.reduce<Record<string, CellTab[]>>((clonedTabs, cellId) => {
    clonedTabs[cellId] = [...(tabs[cellId] ?? [])];
    return clonedTabs;
  }, {});
}

function safeTabTitle(url: string): string {
  if (!url || url === 'about:blank' || isEmptyStateUrl(url)) {
    return 'New tab';
  }

  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function getLayoutShortcut(input: Electron.Input): LayoutMode | null {
  if (!(input.meta || input.control) || input.alt || input.shift) {
    return null;
  }

  const key = input.key.toLowerCase();
  if (key === '1') return 'single';
  if (key === '2') return 'horizontal';
  if (key === '3') return 'triple';
  if (key === '4') return 'quad';
  return null;
}

function isCellMode(value: unknown): value is CellMode {
  return value === 'chat' || value === 'search';
}

function inferCellMode(rawUrl: string): CellMode {
  const inferredMode = inferModeFromUrl(rawUrl);
  return inferredMode === 'unknown' ? 'chat' : inferredMode;
}

function inferSearchUrlTemplate(rawUrl: string, mode: CellMode): string {
  const presetTemplate = findPresetSiteByUrl(rawUrl)?.searchUrlTemplate;
  if (presetTemplate) {
    return presetTemplate;
  }

  if (mode !== 'search') {
    return '';
  }

  const url = parseUrl(rawUrl);
  if (!url) {
    return '';
  }

  const queryParam = url.hostname.includes('baidu.') || url.hostname.includes('sogou.') ? 'wd' : 'q';
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}?${queryParam}={query}`;
}

function buildSearchUrl(template: string, query: string): string {
  return template ? template.replace('{query}', encodeURIComponent(query)) : '';
}

function getSiteKey(rawUrl: string): string | null {
  const url = parseUrl(rawUrl);
  if (!url) {
    return null;
  }

  const presetSite = PRESET_SITES.find((site) => {
    const presetUrl = parseUrl(site.url);
    return presetUrl && normalizeHost(presetUrl.hostname) === normalizeHost(url.hostname);
  });

  return sanitizePartitionSegment(presetSite?.id ?? url.hostname);
}

function getSitePartitionStoreKey(siteKey: string): string {
  return `browser.sessions.${siteKey}.partition`;
}

function parseUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === BLANK_URL || isEmptyStateUrl(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(normalizeUrl(trimmed));
    } catch {
      return null;
    }
  }
}

function isEmptyStateUrl(url: string): boolean {
  return url.startsWith('data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%20lang%3D%22zh-CN%22%3E')
    || url.startsWith('data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%20lang%3D%22en%22%3E')
    || url.includes('multimind-empty-state');
}

function createEmptyStateUrl(language: AppLanguage): string {
  const text = EMPTY_STATE_TEXT[language];
  const html = `<!doctype html><html lang="${text.htmlLang}"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="multimind-empty-state" content="true"><title>${text.title}</title><style>
body{margin:0;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#111827;display:grid;place-items:center;height:100vh}
main{width:min(560px,calc(100vw - 48px));text-align:center}
h1{margin:0 0 10px;font-size:24px}
p{margin:0 0 22px;color:#64748b}
.links{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
a{display:block;border:1px solid rgba(15,23,42,.12);border-radius:8px;padding:12px;background:#fff;color:#1d4ed8;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#0f172a;color:#f8fafc}p{color:#94a3b8}a{background:#111827;border-color:rgba(255,255,255,.14);color:#93c5fd}}
</style></head><body><main><h1>${text.heading}</h1><p>${text.description}</p><div class="links">
<a href="https://claude.ai">Claude</a><a href="https://chatgpt.com">ChatGPT</a><a href="https://chat.deepseek.com">DeepSeek</a><a href="https://www.doubao.com">豆包</a>
</div></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const EMPTY_STATE_TEXT: Record<AppLanguage, {
  htmlLang: string;
  title: string;
  heading: string;
  description: string;
}> = {
  zh: {
    htmlLang: 'zh-CN',
    title: '新标签页',
    heading: '新标签页',
    description: '在地址栏输入网址或搜索内容，或选择常用站点开始。',
  },
  en: {
    htmlLang: 'en',
    title: 'New tab',
    heading: 'New tab',
    description: 'Enter a URL or search in the address bar, or choose a common site to start.',
  },
};

function getNewTabTitle(language: AppLanguage): string {
  return EMPTY_STATE_TEXT[language].title;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isClaudeAiUrl(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return normalizeHost(url?.hostname ?? '') === 'claude.ai';
}

function isClaudeComUrl(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return normalizeHost(url?.hostname ?? '') === 'claude.com';
}

function createRecordId(): string {
  return `forward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDomTimelineEntries(entries: ExtractedConversationEntry[]): Array<Omit<TimelineEntry, 'timestamp'>> {
  const normalized = entries
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(toTimelineEntryFromDom)
    .filter((entry): entry is Omit<TimelineEntry, 'timestamp'> => Boolean(entry));

  const reordered = moveFirstUserBeforeLeadingAssistants(normalized);
  const stripped = stripAssistantContentFromUserEntries(reordered);
  return dedupeTimelineEntriesAcrossRoles(stripped);
}

function toTimelineEntryFromDom(entry: ExtractedConversationEntry): Omit<TimelineEntry, 'timestamp'> | null {
  const forwardedContext = extractForwardPromptContext(entry.content);
  if (forwardedContext && entry.role === 'assistant') {
    return null;
  }

  const content = forwardedContext ?? entry.content;
  const cleanedContent = cleanExtractedText(content);
  if (!cleanedContent) {
    return null;
  }

  return {
    role: forwardedContext ? 'user' : entry.role,
    content: cleanedContent,
    source: forwardedContext ? 'forward-injection' : 'dom-detected',
    domId: entry.domId,
    order: entry.order,
  };
}

function stripAssistantContentFromUserEntries(
  entries: Array<Omit<TimelineEntry, 'timestamp'>>,
): Array<Omit<TimelineEntry, 'timestamp'>> {
  return entries
    .map((entry, index) => {
      if (entry.role !== 'user') {
        return entry;
      }

      const nextAssistant = entries.slice(index + 1).find((candidate) => candidate.role === 'assistant');
      if (!nextAssistant) {
        return entry;
      }

      const strippedContent = stripContainedTrailingContent(entry.content, nextAssistant.content);
      return strippedContent === entry.content ? entry : { ...entry, content: strippedContent };
    })
    .filter((entry) => Boolean(entry.content.trim()));
}

function moveFirstUserBeforeLeadingAssistants(
  entries: Array<Omit<TimelineEntry, 'timestamp'>>,
): Array<Omit<TimelineEntry, 'timestamp'>> {
  const firstUserIndex = entries.findIndex((entry) => entry.role === 'user');
  if (firstUserIndex <= 0) {
    return entries;
  }

  const leadingEntries = entries.slice(0, firstUserIndex);
  if (!leadingEntries.every((entry) => entry.role === 'assistant')) {
    return entries;
  }

  return [
    entries[firstUserIndex],
    ...leadingEntries,
    ...entries.slice(firstUserIndex + 1),
  ];
}

function stripContainedTrailingContent(content: string, trailingContent: string): string {
  const index = content.indexOf(trailingContent);
  if (index < 0) {
    return content;
  }

  const stripped = content.slice(0, index).trim();
  return stripped.length >= 2 ? stripped : content;
}

function stripExistingUserEntriesContainingAssistant(timeline: CellTimeline, assistantContent: string): void {
  timeline.entries
    .filter((entry) => entry.role === 'user')
    .forEach((entry) => {
      entry.content = stripContainedTrailingContent(entry.content, assistantContent);
    });
}

function stripExistingRoleBlocksFromForwardContent(timeline: CellTimeline, content: string): string {
  const blocks = parseRoleBlocks(content);
  if (!blocks) {
    return content;
  }

  const keptBlocks = blocks.filter((block) => {
    if (!block.content.trim()) {
      return false;
    }

    return !timeline.entries.some((entry) => (
      entry.role === block.role
      && existingContentCoversNewContent(entry.content, block.content)
    ));
  });

  return formatRoleBlocks(keptBlocks);
}

function dedupeTimelineEntriesAcrossRoles(
  entries: Array<Omit<TimelineEntry, 'timestamp'>>,
): Array<Omit<TimelineEntry, 'timestamp'>> {
  const deduped: Array<Omit<TimelineEntry, 'timestamp'>> = [];
  entries.forEach((entry) => {
    const normalizedContent = normalizeTimelineContent(entry.content);
    if (!normalizedContent) {
      return;
    }

    if (deduped.some((existing) => existingContentCoversNewContent(existing.content, normalizedContent))) {
      return;
    }

    for (let index = deduped.length - 1; index >= 0; index -= 1) {
      if (newContentCoversExistingContent(normalizedContent, deduped[index].content)) {
        deduped.splice(index, 1);
      }
    }

    deduped.push(entry);
  });
  return deduped;
}

function extractForwardPromptContext(text: string): string | null {
  const normalized = text.trim();
  const contextHeader = findHeaderIndex(normalized, ['# 对话上下文', '# Conversation Context']);
  const evaluateHeader = findHeaderIndex(normalized, ['# 请你评价', '# Your Evaluation']);
  if (contextHeader < 0 || evaluateHeader <= contextHeader) {
    return null;
  }

  const headerEnd = normalized.indexOf('\n', contextHeader);
  if (headerEnd < 0 || headerEnd >= evaluateHeader) {
    return null;
  }

  const content = normalized.slice(headerEnd + 1, evaluateHeader).trim();
  return content ? content : null;
}

function isForwardPromptText(text: string): boolean {
  return extractForwardPromptContext(text) !== null;
}

function findHeaderIndex(text: string, headers: string[]): number {
  return headers.reduce((foundIndex, header) => {
    const index = text.indexOf(header);
    if (index < 0) {
      return foundIndex;
    }
    return foundIndex < 0 ? index : Math.min(foundIndex, index);
  }, -1);
}

function normalizeExtractedConversation(value: unknown): ExtractedConversation | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as ExtractedConversation).entries)) {
    return null;
  }

  const entries = (value as ExtractedConversation).entries
    .map((entry): ExtractedConversationEntry | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const role = (entry as ExtractedConversationEntry).role;
      const content = (entry as ExtractedConversationEntry).content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return null;
      }

      const cleanedContent = cleanExtractedText(content);
      if (!cleanedContent) {
        return null;
      }

      const domId = (entry as ExtractedConversationEntry).domId;
      const order = (entry as ExtractedConversationEntry).order;
      return {
        role,
        content: cleanedContent,
        ...(typeof domId === 'string' && domId.trim() ? { domId: domId.trim() } : {}),
        ...(typeof order === 'number' && Number.isFinite(order) ? { order } : {}),
      };
    })
    .filter((entry): entry is ExtractedConversationEntry => Boolean(entry));

  return entries.length ? { entries } : null;
}

function formatTimelineContext(entries: TimelineEntry[]): string {
  return getTimelineEntriesInDisplayOrder(entries)
    .filter((entry) => !(entry.role === 'assistant' && isForwardPromptText(entry.content)))
    .map((entry) => {
      const content = entry.content.trim();
      if (entry.source === 'forward-injection' && startsWithRoleLabel(content)) {
        return content;
      }
      return `${entry.role === 'user' ? '用户' : 'AI'}：${content}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function getTimelineEntriesInDisplayOrder(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((left, right) => {
    if (left.source !== 'dom-detected' || right.source !== 'dom-detected') {
      return left.timestamp - right.timestamp;
    }

    if (typeof left.order === 'number' && typeof right.order === 'number' && left.order !== right.order) {
      return left.order - right.order;
    }
    return left.timestamp - right.timestamp;
  });
}

function normalizeTimelineContent(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeComparableTimelineContent(text: string): string {
  return normalizeTimelineContent(text)
    .replace(/[*_~`#>-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimelineNavigationUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === BLANK_URL || isEmptyStateUrl(trimmed)) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

function existingContentCoversNewContent(existing: string, next: string): boolean {
  const normalizedExisting = normalizeComparableTimelineContent(existing);
  const normalizedNext = normalizeComparableTimelineContent(next);
  if (!normalizedExisting || !normalizedNext) {
    return false;
  }
  if (normalizedExisting === normalizedNext) {
    return true;
  }

  return normalizedNext.length >= 80 && normalizedExisting.includes(normalizedNext);
}

function newContentCoversExistingContent(next: string, existing: string): boolean {
  const normalizedNext = normalizeComparableTimelineContent(next);
  const normalizedExisting = normalizeComparableTimelineContent(existing);
  if (!normalizedNext || !normalizedExisting || normalizedNext === normalizedExisting) {
    return false;
  }

  return normalizedExisting.length >= 80 && normalizedNext.includes(normalizedExisting);
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/[\u2460-\u2473\u24ea\u24f5-\u24fe\u2776-\u277f]/g, '')
    .replace(/(?<=\S)[\u00b9\u00b2\u00b3\u2070-\u2079]+(?=\s|$|[，。,.、；;：:])/g, '')
    .replace(/\[\s*\d{1,3}\s*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function startsWithRoleLabel(text: string): boolean {
  return /^(用户|AI)：/.test(text.trim());
}

function sanitizePartitionSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function safeSetBounds(view: WebContentsView, bounds: Electron.Rectangle): void {
  if (view.webContents.isDestroyed()) {
    return;
  }

  try {
    view.setBounds(bounds);
  } catch (error) {
    if (!isDestroyedObjectError(error)) {
      throw error;
    }
  }
}

function isDestroyedObjectError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Object has been destroyed');
}
