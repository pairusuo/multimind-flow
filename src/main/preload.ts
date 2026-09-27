import { contextBridge, ipcRenderer } from 'electron';
import {
  AddConversationMembersPayload,
  ApplyTemplatePayload,
  AppLanguage,
  ApiConversationDeltaPayload,
  BrowserState,
  CellTabPayload,
  CellFaviconChangedPayload,
  CellFocusedPayload,
  ConversationEntryMode,
  ConversationMessageDeltaPayload,
  ConversationRoundStatusPayload,
  ConversationTargetPayload,
  CreateBotPayload,
  CreateConversationPayload,
  DisableMemoryDocumentPayload,
  ForwardCompletedPayload,
  ForwardResponsePayload,
  GetMemoryDocumentPayload,
  LayoutChangedPayload,
  CellNoticePayload,
  CellTitleChangedPayload,
  CellUrlChangedPayload,
  DocumentCandidate,
  ElectronAPI,
  GenerateDocumentPayload,
  ImportMemoryDocumentPayload,
  IPC,
  MigrateFromCellsPayload,
  NavigatePayload,
  RecallMemoryForAgentTaskPayload,
  RemoveConversationMemberPayload,
  RemoveMemorySourcePayload,
  RequestReviewPayload,
  RequestSummaryPayload,
  RunApiConversationPayload,
  SaveApiConversationConfigPayload,
  SearchMemoryDocumentsPayload,
  SendToAllPayload,
  SendMessagePayload,
  SetMaximizedCellPayload,
  SetCellUrlPayload,
  ThemeMode,
  ToggleCellPayload,
  UpdateBotPayload,
  UpdateConversationMemberPayload,
  UpdateConversationPayload,
  CONVERSATION_IPC,
} from '../shared/types';

const api: ElectronAPI = {
  appUpdate: (action) => ipcRenderer.invoke(IPC.APP_UPDATE, action),
  getBrowserState: () => ipcRenderer.invoke(IPC.GET_BROWSER_STATE) as Promise<BrowserState>,
  openConversationLink: (url: string) => ipcRenderer.invoke(IPC.OPEN_CONVERSATION_LINK, url),
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION) as Promise<string>,
  applyTemplate: (payload: ApplyTemplatePayload) => ipcRenderer.invoke(IPC.APPLY_TEMPLATE, payload),
  sendToAll: (payload: SendToAllPayload) => ipcRenderer.invoke(IPC.SEND_TO_ALL, payload),
  startNewDiscussion: () => ipcRenderer.invoke(IPC.START_NEW_DISCUSSION),
  forwardResponse: (payload: ForwardResponsePayload) => ipcRenderer.invoke(IPC.FORWARD_RESPONSE, payload),
  getDocumentCandidates: () => ipcRenderer.invoke(IPC.GET_DOCUMENT_CANDIDATES) as Promise<DocumentCandidate[]>,
  generateDocument: (payload: GenerateDocumentPayload) => ipcRenderer.invoke(IPC.GENERATE_DOCUMENT, payload) as Promise<void>,
  chooseMemoryDirectory: () => ipcRenderer.invoke(IPC.CHOOSE_MEMORY_DIRECTORY),
  listMemorySources: () => ipcRenderer.invoke(IPC.LIST_MEMORY_SOURCES),
  removeMemorySource: (payload: RemoveMemorySourcePayload) => ipcRenderer.invoke(IPC.REMOVE_MEMORY_SOURCE, payload),
  scanMemoryInbox: () => ipcRenderer.invoke(IPC.SCAN_MEMORY_INBOX),
  getMemoryInboxDocument: (filePath: string) => ipcRenderer.invoke(IPC.GET_MEMORY_INBOX_DOCUMENT, filePath),
  importMemoryDocument: (payload: ImportMemoryDocumentPayload) => ipcRenderer.invoke(IPC.IMPORT_MEMORY_DOCUMENT, payload),
  searchMemoryDocuments: (payload: SearchMemoryDocumentsPayload) => ipcRenderer.invoke(IPC.SEARCH_MEMORY_DOCUMENTS, payload),
  getMemoryDocument: (payload: GetMemoryDocumentPayload) => ipcRenderer.invoke(IPC.GET_MEMORY_DOCUMENT, payload),
  disableMemoryDocument: (payload: DisableMemoryDocumentPayload) => ipcRenderer.invoke(IPC.DISABLE_MEMORY_DOCUMENT, payload),
  recallMemoryForAgentTask: (payload: RecallMemoryForAgentTaskPayload) => ipcRenderer.invoke(IPC.RECALL_MEMORY_FOR_AGENT_TASK, payload),
  getApiConversationConfig: () => ipcRenderer.invoke(IPC.GET_API_CONVERSATION_CONFIG),
  refreshApiConversationModels: () => ipcRenderer.invoke(IPC.REFRESH_API_CONVERSATION_MODELS),
  saveApiConversationConfig: (payload: SaveApiConversationConfigPayload) => ipcRenderer.invoke(IPC.SAVE_API_CONVERSATION_CONFIG, payload),
  runApiConversation: (payload: RunApiConversationPayload) => ipcRenderer.invoke(IPC.RUN_API_CONVERSATION, payload),
  onApiConversationDelta: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ApiConversationDeltaPayload) => callback(payload);
    ipcRenderer.on(IPC.API_CONVERSATION_DELTA, listener);
    return () => ipcRenderer.removeListener(IPC.API_CONVERSATION_DELTA, listener);
  },
  setLayout: (mode) => ipcRenderer.invoke(IPC.SET_LAYOUT, mode),
  setThemeMode: (mode: ThemeMode) => ipcRenderer.invoke(IPC.SET_THEME_MODE, mode),
  setLanguage: (language: AppLanguage) => ipcRenderer.invoke(IPC.SET_LANGUAGE, language),
  setConversationEntryMode: (mode: ConversationEntryMode) => ipcRenderer.invoke(IPC.SET_CONVERSATION_ENTRY_MODE, mode),
  setForwardControlsEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.SET_FORWARD_CONTROLS_ENABLED, enabled),
  setOverlayOpen: (open: boolean) => ipcRenderer.invoke(IPC.SET_OVERLAY_OPEN, open),
  setMaximizedCell: (payload: SetMaximizedCellPayload) => ipcRenderer.invoke(IPC.SET_MAXIMIZED_CELL, payload),
  navigate: (payload: NavigatePayload) => ipcRenderer.invoke(IPC.NAVIGATE, payload),
  navigateBack: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_BACK, cellId),
  navigateForward: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_FORWARD, cellId),
  reload: (cellId: string) => ipcRenderer.invoke(IPC.RELOAD, cellId),
  setCellUrl: (payload: SetCellUrlPayload) => ipcRenderer.invoke(IPC.SET_CELL_URL, payload),
  toggleCell: (payload: ToggleCellPayload) => ipcRenderer.invoke(IPC.TOGGLE_CELL, payload),
  toggleMute: (cellId: string) => ipcRenderer.invoke(IPC.TOGGLE_MUTE, cellId),
  newTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.NEW_TAB, payload),
  closeTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.CLOSE_TAB, payload),
  switchTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.SWITCH_TAB, payload),
  focusCell: (payload: CellFocusedPayload) => ipcRenderer.invoke(IPC.CELL_FOCUSED, payload),
  onCellFocused: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellFocusedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_FOCUSED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_FOCUSED, listener);
  },
  onLayoutChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LayoutChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.LAYOUT_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.LAYOUT_CHANGED, listener);
  },
  onCellNotice: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellNoticePayload) => callback(payload);
    ipcRenderer.on(IPC.SHOW_CELL_NOTICE, listener);
    return () => ipcRenderer.removeListener(IPC.SHOW_CELL_NOTICE, listener);
  },
  onForwardCompleted: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ForwardCompletedPayload) => callback(payload);
    ipcRenderer.on(IPC.FORWARD_COMPLETED, listener);
    return () => ipcRenderer.removeListener(IPC.FORWARD_COMPLETED, listener);
  },
  onCellUrlChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellUrlChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_URL_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_URL_CHANGED, listener);
  },
  onCellTitleChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellTitleChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_TITLE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_TITLE_CHANGED, listener);
  },
  onCellFaviconChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellFaviconChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_FAVICON_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_FAVICON_CHANGED, listener);
  },
  // API Bot 与群聊会谈
  openBotGuide: (key) => ipcRenderer.invoke(CONVERSATION_IPC.OPEN_BOT_GUIDE, key),
  setupLocalAgent: (agent, action, executable) => ipcRenderer.invoke(CONVERSATION_IPC.SETUP_LOCAL_AGENT, agent, action, executable),
  getLocalAgentCache: (agent, executable) => ipcRenderer.invoke(CONVERSATION_IPC.GET_LOCAL_AGENT_CACHE, agent, executable),
  detectLocalAgent: (agent, executable?: string, force?: boolean) => ipcRenderer.invoke(CONVERSATION_IPC.DETECT_LOCAL_AGENT, agent, executable, force),
  testBotApi: (payload) => ipcRenderer.invoke(CONVERSATION_IPC.TEST_BOT_API, payload),
  createBot: (payload: CreateBotPayload) => ipcRenderer.invoke(CONVERSATION_IPC.CREATE_BOT, payload),
  updateBot: (payload: UpdateBotPayload) => ipcRenderer.invoke(CONVERSATION_IPC.UPDATE_BOT, payload),
  deleteBot: (id: string) => ipcRenderer.invoke(CONVERSATION_IPC.DELETE_BOT, id),
  listBots: () => ipcRenderer.invoke(CONVERSATION_IPC.LIST_BOTS),
  createConversation: (payload: CreateConversationPayload) => ipcRenderer.invoke(CONVERSATION_IPC.CREATE_CONVERSATION, payload),
  updateConversation: (payload: UpdateConversationPayload) => ipcRenderer.invoke(CONVERSATION_IPC.UPDATE_CONVERSATION, payload),
  deleteConversation: (id: string) => ipcRenderer.invoke(CONVERSATION_IPC.DELETE_CONVERSATION, id),
  listConversations: () => ipcRenderer.invoke(CONVERSATION_IPC.LIST_CONVERSATIONS),
  getConversation: (id: string) => ipcRenderer.invoke(CONVERSATION_IPC.GET_CONVERSATION, id),
  updateConversationMember: (payload: UpdateConversationMemberPayload) =>
    ipcRenderer.invoke(CONVERSATION_IPC.UPDATE_CONVERSATION_MEMBER, payload),
  addConversationMembers: (payload: AddConversationMembersPayload) =>
    ipcRenderer.invoke(CONVERSATION_IPC.ADD_CONVERSATION_MEMBERS, payload),
  removeConversationMember: (payload: RemoveConversationMemberPayload) =>
    ipcRenderer.invoke(CONVERSATION_IPC.REMOVE_CONVERSATION_MEMBER, payload),
  sendConversationMessage: (payload: SendMessagePayload) => ipcRenderer.invoke(CONVERSATION_IPC.SEND_MESSAGE, payload),
  stopConversationRound: (payload: ConversationTargetPayload) => ipcRenderer.invoke(CONVERSATION_IPC.STOP_ROUND, payload),
  stopConversationMember: (payload: ConversationTargetPayload) => ipcRenderer.invoke(CONVERSATION_IPC.STOP_MEMBER, payload),
  retryConversationMember: (payload: ConversationTargetPayload) => ipcRenderer.invoke(CONVERSATION_IPC.RETRY_MEMBER, payload),
  requestConversationReview: (payload: RequestReviewPayload) => ipcRenderer.invoke(CONVERSATION_IPC.REQUEST_REVIEW, payload),
  requestConversationSummary: (payload: RequestSummaryPayload) => ipcRenderer.invoke(CONVERSATION_IPC.REQUEST_SUMMARY, payload),
  getConversationState: () => ipcRenderer.invoke(CONVERSATION_IPC.GET_CONVERSATION_STATE),
  migrateConversationFromCells: (payload: MigrateFromCellsPayload) =>
    ipcRenderer.invoke(CONVERSATION_IPC.MIGRATE_FROM_CELLS, payload),
  onConversationMessageDelta: (callback: (payload: ConversationMessageDeltaPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ConversationMessageDeltaPayload) => callback(payload);
    ipcRenderer.on(CONVERSATION_IPC.MESSAGE_DELTA, listener);
    return () => ipcRenderer.removeListener(CONVERSATION_IPC.MESSAGE_DELTA, listener);
  },
  onConversationRoundStatus: (callback: (payload: ConversationRoundStatusPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ConversationRoundStatusPayload) => callback(payload);
    ipcRenderer.on(CONVERSATION_IPC.ROUND_STATUS, listener);
    return () => ipcRenderer.removeListener(CONVERSATION_IPC.ROUND_STATUS, listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
