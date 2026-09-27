import { useEffect, useRef, useState } from 'react';
import i18n from './i18n';
import CellConfigPanel from './components/CellConfigPanel';
import ConversationView from './components/ConversationView';
import Toolbar from './components/Toolbar';
import SplitView from './components/SplitView';
import BottomInput from './components/BottomInput';
import DocumentSummaryModal from './components/DocumentSummaryModal';
import MemoryPanel from './components/MemoryPanel';
import TemplateChooser from './components/TemplateChooser';
import {
  ApiConversationCellState,
  ApiConversationConfig,
  BrowserState,
  CELL_IDS,
  AppLanguage,
  CellMode,
  CellTab,
  ConversationEntryMode,
  DEFAULT_URLS,
  DocumentCandidate,
  LAYOUT_CELLS,
  LayoutMode,
  ThemeMode,
} from '../shared/types';
import { buildDocumentPrompt, detectContentLanguage } from '../shared/documentPrompt';
import { LayoutTemplate } from '../shared/presetTemplates';
import { PRESET_SITES } from '../shared/presetSites';

const INITIAL_URLS = CELL_IDS.reduce<Record<string, string>>((urls, cellId) => {
  urls[cellId] = '';
  return urls;
}, {});

const INITIAL_ACTIVE_CELLS = CELL_IDS.reduce<Record<string, boolean>>((activeCells, cellId) => {
  activeCells[cellId] = true;
  return activeCells;
}, {});

const INITIAL_CELL_MODES = CELL_IDS.reduce<Record<string, CellMode>>((modes, cellId) => {
  modes[cellId] = 'chat';
  return modes;
}, {});

const INITIAL_SEARCH_TEMPLATES = CELL_IDS.reduce<Record<string, string>>((templates, cellId) => {
  templates[cellId] = '';
  return templates;
}, {});

const INITIAL_TABS = CELL_IDS.reduce<Record<string, CellTab[]>>((tabs, cellId) => {
  tabs[cellId] = [];
  return tabs;
}, {});

const INITIAL_ACTIVE_TAB_IDS = CELL_IDS.reduce<Record<string, string>>((activeTabIds, cellId) => {
  activeTabIds[cellId] = '';
  return activeTabIds;
}, {});

const INITIAL_MUTED_CELLS = CELL_IDS.reduce<Record<string, boolean>>((mutedCells, cellId) => {
  mutedCells[cellId] = false;
  return mutedCells;
}, {});

const DEFAULT_API_CONFIG: ApiConversationConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [],
  cellModels: {
    'cell-0': '',
    'cell-1': '',
    'cell-2': '',
    'cell-3': '',
  },
  apiKeyConfigured: false,
};

export default function App() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [cellUrls, setCellUrls] = useState<Record<string, string>>(INITIAL_URLS);
  const [cellModes, setCellModes] = useState<Record<string, CellMode>>(INITIAL_CELL_MODES);
  const [searchUrlTemplates, setSearchUrlTemplates] = useState<Record<string, string>>(INITIAL_SEARCH_TEMPLATES);
  const [activeCells, setActiveCells] = useState<Record<string, boolean>>(INITIAL_ACTIVE_CELLS);
  const [, setMutedCells] = useState<Record<string, boolean>>(INITIAL_MUTED_CELLS);
  const [tabs, setTabs] = useState<Record<string, CellTab[]>>(INITIAL_TABS);
  const [activeTabIds, setActiveTabIds] = useState<Record<string, string>>(INITIAL_ACTIVE_TAB_IDS);
  const activeTabIdsRef = useRef<Record<string, string>>(INITIAL_ACTIVE_TAB_IDS);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [language, setLanguage] = useState<AppLanguage>('zh');
  const [conversationEntryMode, setConversationEntryMode] = useState<ConversationEntryMode>('embedded');
  const [apiConfig, setApiConfig] = useState<ApiConversationConfig>(DEFAULT_API_CONFIG);
  const [apiCellStates, setApiCellStates] = useState<Record<string, ApiConversationCellState>>({});
  const [forwardControlsEnabled, setForwardControlsEnabled] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [showDocumentSummary, setShowDocumentSummary] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [documentCandidates, setDocumentCandidates] = useState<DocumentCandidate[]>([]);
  const [isGeneratingDocument, setIsGeneratingDocument] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [focusedCellId, setFocusedCellId] = useState('cell-0');
  const [maximizedCellId, setMaximizedCellId] = useState<string | null>(null);
  const url = cellUrls[focusedCellId] ?? '';

  useEffect(() => {
    activeTabIdsRef.current = activeTabIds;
  }, [activeTabIds]);

  useEffect(() => {
    const screenshotMode = new URLSearchParams(window.location.search).get('screenshotMode');
    if (screenshotMode === 'triple' || screenshotMode === 'config' || screenshotMode === 'risk' || screenshotMode === 'notice') {
      void applyScreenshotState(screenshotMode);
      return;
    }

    void window.electronAPI.getBrowserState().then(applyBrowserState);
  }, []);

  useEffect(() => {
    void window.electronAPI.setOverlayOpen(
      showConfigPanel || showDocumentSummary || showMemoryPanel || !hasCompletedOnboarding,
    );
  }, [hasCompletedOnboarding, showConfigPanel, showDocumentSummary, showMemoryPanel]);

  useEffect(() => {
    const removeFocusListener = window.electronAPI.onCellFocused((payload) => {
      setFocusedCellId(payload.cellId);
    });
    const removeUrlListener = window.electronAPI.onCellUrlChanged((payload) => {
      setCellUrls((current) => ({
        ...current,
        [payload.cellId]: payload.url,
      }));
      patchActiveTab(payload.cellId, { url: payload.url });
    });
    const removeTitleListener = window.electronAPI.onCellTitleChanged((payload) => {
      patchActiveTab(payload.cellId, { title: payload.title });
    });
    const removeFaviconListener = window.electronAPI.onCellFaviconChanged((payload) => {
      patchActiveTab(payload.cellId, { favicon: payload.favicon });
    });
    const removeLayoutListener = window.electronAPI.onLayoutChanged((payload) => {
      setLayoutMode(payload.layoutMode);
    });

    return () => {
      removeFocusListener();
      removeUrlListener();
      removeTitleListener();
      removeFaviconListener();
      removeLayoutListener();
    };
  }, []);

  useEffect(() => {
    return window.electronAPI.onApiConversationDelta((payload) => {
      const cellId = payload.requestId;
      if (!cellId || !CELL_IDS.some((knownCellId) => knownCellId === cellId)) {
        return;
      }

      setApiCellStates((current) => {
        const currentState = current[cellId];
        const content = payload.content || (currentState?.content ?? '') + (payload.delta ?? '');
        return {
          ...current,
          [cellId]: {
            model: payload.model,
            content,
            error: payload.error,
            elapsedMs: payload.elapsedMs ?? currentState?.elapsedMs,
            status: payload.error ? 'error' : payload.done ? 'completed' : 'running',
          },
        };
      });
    });
  }, []);

  function handleFocusCell(cellId: string, nextUrl: string) {
    setFocusedCellId(cellId);
    setCellUrls((current) => ({
      ...current,
      [cellId]: nextUrl,
    }));
    void window.electronAPI.focusCell({ cellId });
  }

  function patchActiveTab(cellId: string, patch: Partial<CellTab>) {
    const tabId = activeTabIdsRef.current[cellId];
    setTabs((current) => ({
      ...current,
      [cellId]: patchTabList(current[cellId] ?? [], tabId, patch),
    }));
  }

  async function handleNavigate(nextUrl: string) {
    setCellUrls((current) => ({
      ...current,
      [focusedCellId]: nextUrl,
    }));
    const state = await window.electronAPI.navigate({ cellId: focusedCellId, url: nextUrl });
    applyBrowserState(state);
  }

  async function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    setMaximizedCellId(null);
    await window.electronAPI.setMaximizedCell({ cellId: null });
    await window.electronAPI.setLayout(mode);
    setCellUrls((current) => fillDefaultUrlsForLayout(current, mode));
    const firstCell = 'cell-0';
    setFocusedCellId(firstCell);
    await window.electronAPI.focusCell({ cellId: firstCell });
  }

  async function handleApplyTemplate(template: LayoutTemplate) {
    const state = await window.electronAPI.applyTemplate({ template });
    applyBrowserState(state);
    setShowConfigPanel(template.id === 'custom');
  }

  async function handleSaveCellConfig(
    nextUrls: Record<string, string>,
    nextModes: Record<string, CellMode>,
    nextSearchTemplates: Record<string, string>,
  ) {
    const visibleCells = getVisibleCells(layoutMode);
    setCellUrls((current) => ({
      ...current,
      ...nextUrls,
    }));
    setCellModes((current) => ({
      ...current,
      ...nextModes,
    }));
    setSearchUrlTemplates((current) => ({
      ...current,
      ...nextSearchTemplates,
    }));

    for (const cellId of visibleCells) {
      const nextUrl = nextUrls[cellId]?.trim();
      await window.electronAPI.setCellUrl({
        cellId,
        url: nextUrl ?? '',
        mode: nextModes[cellId],
        searchUrlTemplate: nextSearchTemplates[cellId],
      });
      if (!nextUrl) {
        setActiveCells((current) => ({
          ...current,
          [cellId]: false,
        }));
      }
    }

    setShowConfigPanel(false);
    setHasCompletedOnboarding(true);
  }

  function handleToggleCell(cellId: string, active: boolean) {
    setActiveCells((current) => ({
      ...current,
      [cellId]: active,
    }));
    void window.electronAPI.toggleCell({ cellId, active });
  }

  async function handleThemeModeChange(mode: ThemeMode) {
    const state = await window.electronAPI.setThemeMode(mode);
    applyBrowserState(state);
  }

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    const state = await window.electronAPI.setLanguage(nextLanguage);
    applyBrowserState(state);
  }

  async function handleForwardControlsEnabledChange(enabled: boolean) {
    const state = await window.electronAPI.setForwardControlsEnabled(enabled);
    applyBrowserState(state);
  }

  async function handleConversationEntryModeChange(mode: ConversationEntryMode) {
    const state = await window.electronAPI.setConversationEntryMode(mode);
    applyBrowserState(state);
    if (mode === 'api') {
      setMaximizedCellId(null);
      await window.electronAPI.setMaximizedCell({ cellId: null });
    }
  }

  async function handleSaveApiConfig(payload: { baseUrl: string; apiKey?: string; models?: string[]; cellModels?: Record<string, string> }) {
    const nextConfig = await window.electronAPI.saveApiConversationConfig(payload);
    setApiConfig(nextConfig);
    setApiCellStates((current) => buildApiCellStates(nextConfig.cellModels ?? {}, current));
    return nextConfig;
  }

  async function handleApiCellModelChange(cellId: string, model: string) {
    const nextCellModels = {
      ...apiConfig.cellModels,
      [cellId]: model,
    };
    const nextConfig = await handleSaveApiConfig({
      baseUrl: apiConfig.baseUrl,
      cellModels: nextCellModels,
    });
    setApiCellStates((current) => buildApiCellStates(nextConfig.cellModels ?? {}, current));
  }

  async function handleApiForward(sourceCellId: string, targetCellId: string) {
    const source = apiCellStates[sourceCellId];
    const targetModel = apiConfig.cellModels?.[targetCellId] ?? '';
    if (!source?.content.trim() || !targetModel || !apiConfig.apiKeyConfigured) {
      return;
    }

    setApiCellStates((current) => markApiCells([{ cellId: targetCellId, model: targetModel }], current, 'running'));
    const result = await window.electronAPI.runApiConversation({
      prompt: buildApiForwardPrompt(source.model, source.content),
      models: [targetModel],
      requestId: targetCellId,
    });
    const modelResult = result.results[0];
    setApiCellStates((current) => ({
      ...current,
      [targetCellId]: {
        model: targetModel,
        content: modelResult?.content ?? '',
        error: modelResult?.error,
        elapsedMs: modelResult?.elapsedMs,
        status: modelResult?.error ? 'error' : 'completed',
      },
    }));
  }

  async function handleSendUnifiedInput(text: string) {
    if (conversationEntryMode === 'embedded') {
      await window.electronAPI.sendToAll({ text });
      return;
    }

    const visibleCells = getVisibleCells(layoutMode);
    const targets = visibleCells
      .map((cellId) => ({ cellId, model: apiConfig.cellModels?.[cellId] ?? '' }))
      .filter((target) => target.model && activeCells[target.cellId]);

    if (!apiConfig.apiKeyConfigured) {
      setApiCellStates((current) => markApiCells(targets, current, 'error', i18n.t('apiConversation.errors.missingKey')));
      return;
    }

    if (!targets.length) {
      return;
    }

    setApiCellStates((current) => markApiCells(targets, current, 'running'));
    const results = await Promise.all(targets.map((target) =>
      window.electronAPI.runApiConversation({
        prompt: text,
        models: [target.model],
        requestId: target.cellId,
      }),
    ));

    setApiCellStates((current) => {
      const next = { ...current };
      targets.forEach((target, index) => {
        const modelResult = results[index].results[0];
        next[target.cellId] = {
          model: target.model,
          content: modelResult?.content ?? next[target.cellId]?.content ?? '',
          error: modelResult?.error,
          elapsedMs: modelResult?.elapsedMs,
          status: modelResult?.error ? 'error' : 'completed',
        };
      });
      return next;
    });
  }

  async function handleNewTab(cellId: string, url?: string) {
    const state = await window.electronAPI.newTab({ cellId, url });
    applyBrowserState(state);
  }

  async function handleCloseTab(cellId: string, tabId?: string) {
    const state = await window.electronAPI.closeTab({ cellId, tabId });
    applyBrowserState(state);
  }

  async function handleSwitchTab(cellId: string, tabId?: string) {
    const state = await window.electronAPI.switchTab({ cellId, tabId });
    applyBrowserState(state);
  }

  async function handleStartNewDiscussion() {
    if (conversationEntryMode === 'api') {
      setApiCellStates((current) => buildApiCellStates(apiConfig.cellModels ?? {}, current, true));
      return;
    }

    const state = await window.electronAPI.startNewDiscussion();
    applyBrowserState(state);
  }

  function handleClearApiCell(cellId: string) {
    setApiCellStates((current) => ({
      ...current,
      [cellId]: {
        model: current[cellId]?.model ?? apiConfig.cellModels?.[cellId] ?? '',
        content: '',
        status: 'idle',
      },
    }));
  }

  async function handleOpenDocumentSummary() {
    setDocumentError(null);
    setShowDocumentSummary(true);
    if (conversationEntryMode === 'api') {
      setDocumentCandidates(getApiDocumentCandidates(layoutMode, activeCells, apiCellStates));
      return;
    }

    const candidates = await window.electronAPI.getDocumentCandidates();
    setDocumentCandidates(candidates);
  }

  async function handleGenerateDocument(summarizerCellId: string) {
    setIsGeneratingDocument(true);
    setDocumentError(null);
    try {
      if (conversationEntryMode === 'api') {
        await generateApiDocument(summarizerCellId);
        setShowDocumentSummary(false);
        return;
      }

      await window.electronAPI.generateDocument({ summarizerCellId });
      setShowDocumentSummary(false);
    } catch {
      setDocumentError(i18n.t('documentSummary.errors.generateFailed'));
    } finally {
      setIsGeneratingDocument(false);
    }
  }

  async function generateApiDocument(summarizerCellId: string) {
    const model = apiConfig.cellModels?.[summarizerCellId] ?? '';
    if (!model) {
      throw new Error(i18n.t('apiConversation.errors.missingModel'));
    }
    if (!apiConfig.apiKeyConfigured) {
      throw new Error(i18n.t('apiConversation.errors.missingKey'));
    }

    const prompt = buildApiDocumentPrompt(layoutMode, apiCellStates);
    setApiCellStates((current) => markApiCells([{ cellId: summarizerCellId, model }], current, 'running'));
    const result = await window.electronAPI.runApiConversation({
      prompt,
      models: [model],
      requestId: summarizerCellId,
    });
    const modelResult = result.results[0];
    setApiCellStates((current) => ({
      ...current,
      [summarizerCellId]: {
        model,
        content: modelResult?.content ?? '',
        error: modelResult?.error,
        elapsedMs: modelResult?.elapsedMs,
        status: modelResult?.error ? 'error' : 'completed',
      },
    }));
  }

  function handleToggleMaximizedCell(cellId: string) {
    const nextCellId = maximizedCellId === cellId ? null : cellId;
    setMaximizedCellId(nextCellId);
    if (nextCellId) {
      setFocusedCellId(nextCellId);
    }
    void window.electronAPI.setMaximizedCell({ cellId: nextCellId });
  }

  function applyBrowserState(state: BrowserState) {
    setLayoutMode(state.layoutMode);
    setCellUrls({
      ...INITIAL_URLS,
      ...state.cellUrls,
    });
    setCellModes({
      ...INITIAL_CELL_MODES,
      ...state.cellModes,
    });
    setSearchUrlTemplates({
      ...INITIAL_SEARCH_TEMPLATES,
      ...state.searchUrlTemplates,
    });
    setActiveCells({
      ...INITIAL_ACTIVE_CELLS,
      ...state.activeCells,
    });
    setMutedCells({
      ...INITIAL_MUTED_CELLS,
      ...state.mutedCells,
    });
    setTabs({
      ...INITIAL_TABS,
      ...state.tabs,
    });
    setActiveTabIds({
      ...INITIAL_ACTIVE_TAB_IDS,
      ...state.activeTabIds,
    });
    activeTabIdsRef.current = {
      ...INITIAL_ACTIVE_TAB_IDS,
      ...state.activeTabIds,
    };
    setThemeMode(state.themeMode);
    setLanguage(state.language);
    setConversationEntryMode(state.conversationEntryMode);
    setForwardControlsEnabled(state.forwardControlsEnabled);
    if (i18n.language !== state.language) {
      void i18n.changeLanguage(state.language);
    }
    setFocusedCellId(state.focusedCellId);
    setMaximizedCellId(state.maximizedCellId);
    setHasCompletedOnboarding(state.hasCompletedOnboarding);
  }

  async function applyScreenshotState(mode: string) {
    const demoUrls = {
      ...INITIAL_URLS,
      'cell-0': mode === 'risk' ? 'https://gemini.google.com' : PRESET_SITES.find((site) => site.id === 'claude')?.url ?? '',
      'cell-1': PRESET_SITES.find((site) => site.id === 'chatgpt')?.url ?? '',
      'cell-2': PRESET_SITES.find((site) => site.id === 'deepseek')?.url ?? '',
    };

    setLayoutMode('triple');
    setCellUrls(demoUrls);
    setCellModes(INITIAL_CELL_MODES);
    setSearchUrlTemplates(INITIAL_SEARCH_TEMPLATES);
    setActiveCells(INITIAL_ACTIVE_CELLS);
    setMutedCells(INITIAL_MUTED_CELLS);
    setTabs(INITIAL_TABS);
    setActiveTabIds(INITIAL_ACTIVE_TAB_IDS);
    setThemeMode('system');
    setLanguage('zh');
    if (i18n.language !== 'zh') {
      void i18n.changeLanguage('zh');
    }
    setFocusedCellId('cell-0');
    setHasCompletedOnboarding(true);
    setShowConfigPanel(mode === 'config' || mode === 'risk');
    await window.electronAPI.setLayout('triple');
    if (mode === 'notice') {
      window.setTimeout(() => {
        void window.electronAPI.setCellUrl({
          cellId: 'cell-0',
          url: 'https://accounts.google.com/v3/signin/rejected?app_domain=https%3A%2F%2Fauth.openai.com',
        });
      }, 1200);
    }
  }

  return (
    <div className="app-shell">
      <Toolbar
        conversationEntryMode={conversationEntryMode}
        currentUrl={url}
        focusedCellId={focusedCellId}
        tabs={tabs[focusedCellId] ?? []}
        activeTabId={activeTabIds[focusedCellId] ?? ''}
        layoutMode={layoutMode}
        onNewTab={() => void handleNewTab(focusedCellId)}
        onCloseTab={(tabId) => void handleCloseTab(focusedCellId, tabId)}
        onSwitchTab={(tabId) => void handleSwitchTab(focusedCellId, tabId)}
        onOpenConfig={() => setShowConfigPanel(true)}
        onNavigate={(url) => void handleNavigate(url)}
      />
      <main
        className={`browser-stage browser-stage-${layoutMode}${conversationEntryMode === 'api' ? ' browser-stage-api-mode' : ''}${maximizedCellId ? ' browser-stage-maximized' : ''}`}
        aria-label="Browser content"
      >
        {conversationEntryMode === 'api' ? (
          <ConversationView
            language={language}
          />
        ) : (
          <SplitView
            activeCells={activeCells}
            apiCellStates={buildApiCellStates(apiConfig.cellModels ?? {}, apiCellStates)}
            apiModels={apiConfig.models}
            cellModes={cellModes}
            cellUrls={cellUrls}
            conversationEntryMode={conversationEntryMode}
            focusedCellId={focusedCellId}
            forwardControlsEnabled={forwardControlsEnabled}
            layoutMode={layoutMode}
            maximizedCellId={maximizedCellId}
            onFocusCell={handleFocusCell}
            onToggleMaximized={handleToggleMaximizedCell}
            onNewTab={(cellId, url) => void handleNewTab(cellId, url)}
            onToggleCell={handleToggleCell}
            onApiCellModelChange={(cellId, model) => void handleApiCellModelChange(cellId, model)}
            onApiForward={handleApiForward}
            onClearApiCell={handleClearApiCell}
          />
        )}
      </main>
      {conversationEntryMode === 'embedded' && !maximizedCellId && (
        <BottomInput
          activeCells={activeCells}
          availableCells={getAvailableCells(conversationEntryMode, layoutMode, cellUrls, apiConfig.cellModels ?? {})}
          conversationEntryMode={conversationEntryMode}
          layoutMode={layoutMode}
          onGenerateDocument={() => void handleOpenDocumentSummary()}
          onSend={(text) => handleSendUnifiedInput(text)}
          onStartNewDiscussion={() => void handleStartNewDiscussion()}
          onToggleCell={handleToggleCell}
        />
      )}
      {!hasCompletedOnboarding && <TemplateChooser onApplyTemplate={(template) => void handleApplyTemplate(template)} />}
      {showConfigPanel && (
        <CellConfigPanel
          cellUrls={cellUrls}
          cellModes={cellModes}
          searchUrlTemplates={searchUrlTemplates}
          language={language}
          conversationEntryMode={conversationEntryMode}
          forwardControlsEnabled={forwardControlsEnabled}
          layoutMode={layoutMode}
          themeMode={themeMode}
          onClose={() => setShowConfigPanel(false)}
          onLayoutChange={(mode) => void handleLayoutChange(mode)}
          onLanguageChange={(nextLanguage) => void handleLanguageChange(nextLanguage)}
          onConversationEntryModeChange={(mode) => void handleConversationEntryModeChange(mode)}
          onForwardControlsEnabledChange={(enabled) => void handleForwardControlsEnabledChange(enabled)}
          onThemeModeChange={(mode) => void handleThemeModeChange(mode)}
          onOpenMemory={() => {
            setShowConfigPanel(false);
            setShowMemoryPanel(true);
          }}
          onSave={(nextUrls, nextModes, nextSearchTemplates) =>
            void handleSaveCellConfig(nextUrls, nextModes, nextSearchTemplates)
          }
        />
      )}
      {showDocumentSummary && (
        <DocumentSummaryModal
          candidates={documentCandidates}
          error={documentError}
          isGenerating={isGeneratingDocument}
          onClose={() => setShowDocumentSummary(false)}
          onGenerate={(cellId) => void handleGenerateDocument(cellId)}
        />
      )}
      {showMemoryPanel && <MemoryPanel onClose={() => setShowMemoryPanel(false)} />}
    </div>
  );
}

function buildApiCellStates(
  cellModels: Record<string, string>,
  current: Record<string, ApiConversationCellState>,
  clearContent = false,
): Record<string, ApiConversationCellState> {
  return CELL_IDS.reduce<Record<string, ApiConversationCellState>>((states, cellId) => {
    const model = cellModels[cellId] ?? '';
    const existing = current[cellId];
    states[cellId] = {
      model,
      content: !clearContent && existing?.model === model ? existing.content : '',
      error: !clearContent && existing?.model === model ? existing.error : undefined,
      elapsedMs: !clearContent && existing?.model === model ? existing.elapsedMs : undefined,
      status: !clearContent && existing?.model === model ? existing.status : 'idle',
    };
    return states;
  }, {});
}

function markApiCells(
  targets: Array<{ cellId: string; model: string }>,
  current: Record<string, ApiConversationCellState>,
  status: ApiConversationCellState['status'],
  error?: string,
): Record<string, ApiConversationCellState> {
  const next = { ...current };
  targets.forEach((target) => {
    next[target.cellId] = {
      model: target.model,
      content: status === 'running' ? '' : current[target.cellId]?.content ?? '',
      error,
      status,
    };
  });
  return next;
}

function getAvailableCells(
  mode: ConversationEntryMode,
  layoutMode: LayoutMode,
  cellUrls: Record<string, string>,
  apiCellModels: Record<string, string>,
): Record<string, boolean> {
  return CELL_IDS.reduce<Record<string, boolean>>((available, cellId) => {
    available[cellId] = mode === 'api'
      ? Boolean(apiCellModels[cellId]?.trim())
      : Boolean(cellUrls[cellId]?.trim());
    return available;
  }, {});
}

function getApiDocumentCandidates(
  layoutMode: LayoutMode,
  activeCells: Record<string, boolean>,
  apiCellStates: Record<string, ApiConversationCellState>,
): DocumentCandidate[] {
  return LAYOUT_CELLS[layoutMode]
    .filter((cellId) => {
      const state = apiCellStates[cellId];
      return Boolean(activeCells[cellId] && state?.model && state.content.trim());
    })
    .map((cellId) => ({
      cellId,
      url: `api:${apiCellStates[cellId].model}`,
      active: Boolean(activeCells[cellId]),
      hasTimeline: true,
    }));
}

function buildApiDocumentPrompt(layoutMode: LayoutMode, apiCellStates: Record<string, ApiConversationCellState>): string {
  const sourceBlocks = LAYOUT_CELLS[layoutMode]
    .map((cellId, index) => {
      const state = apiCellStates[cellId];
      if (!state?.model || !state.content.trim()) {
        return null;
      }
      return {
        index: index + 1,
        model: state.model,
        content: state.content.trim(),
      };
    })
    .filter((block): block is { index: number; model: string; content: string } => Boolean(block));
  const promptLanguage = detectContentLanguage(sourceBlocks.map((block) => block.content).join('\n'));
  return buildDocumentPrompt(promptLanguage, sourceBlocks);
}

function buildApiForwardPrompt(sourceModel: string, sourceContent: string): string {
  const fixedT = i18n.getFixedT(detectApiPromptLanguage(sourceContent));
  return [
    fixedT('apiConversation.prompts.forwardIntro'),
    '',
    fixedT('apiConversation.prompts.aiAnswerHeader'),
    fixedT('apiConversation.prompts.modelLine', { model: sourceModel }),
    sourceContent.trim(),
    '',
    fixedT('apiConversation.prompts.evaluateHeader'),
    fixedT('apiConversation.prompts.evaluateInstruction'),
  ].join('\n');
}

function detectApiPromptLanguage(text: string): AppLanguage {
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.15 ? 'zh' : 'en';
}

function patchTabList(tabs: CellTab[], tabId: string, patch: Partial<CellTab>): CellTab[] {
  if (!tabId) {
    return tabs;
  }

  return tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
}

function getVisibleCells(layoutMode: LayoutMode): string[] {
  return LAYOUT_CELLS[layoutMode];
}

function fillDefaultUrlsForLayout(urls: Record<string, string>, layoutMode: LayoutMode): Record<string, string> {
  return LAYOUT_CELLS[layoutMode].reduce<Record<string, string>>(
    (nextUrls, cellId) => ({
      ...nextUrls,
      [cellId]: nextUrls[cellId]?.trim() ? nextUrls[cellId] : DEFAULT_URLS[cellId],
    }),
    { ...urls },
  );
}
