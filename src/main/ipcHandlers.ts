import { cachedAgentDetection, localAgentDetectionSnapshot } from './localAgentDetection';
import { AppUpdater } from './appUpdater';
import { app, shell, BrowserWindow, dialog, ipcMain, OpenDialogOptions } from 'electron';
import {
  ApplyTemplatePayload,
  AppLanguage,
  CellTabPayload,
  ConversationEntryMode,
  DisableMemoryDocumentPayload,
  ForwardResponsePayload,
  GetMemoryDocumentPayload,
  GenerateDocumentPayload,
  IPC,
  ImportMemoryDocumentPayload,
  CellFocusedPayload,
  LayoutMode,
  NavigatePayload,
  RecallMemoryForAgentTaskPayload,
  RemoveMemorySourcePayload,
  SearchMemoryDocumentsPayload,
  SendToAllPayload,
  SetMaximizedCellPayload,
  SetCellUrlPayload,
  RunApiConversationPayload,
  SaveApiConversationConfigPayload,
  ThemeMode,
  ToggleCellPayload,
} from '../shared/types';
import { ApiConversationService } from './apiConversationService';
import { setupLocalAgent } from './localAgentRuntime';
import { botGuideUrl, type LocalAgentId } from '../shared/botCatalog';
import { ConversationService } from './conversationService';
import { MemoryStore } from './memoryStore';
import { WindowManager } from './windowManager';
import {
  CONVERSATION_IPC,
  ConversationTargetPayload,
  TestBotApiPayload,
  CreateBotPayload,
  CreateConversationPayload,
  AddConversationMembersPayload,
  RemoveConversationMemberPayload,
  UpdateConversationMemberPayload,
  UpdateBotPayload,
  UpdateConversationPayload,
  MigrateFromCellsPayload,
  RequestReviewPayload,
  RequestSummaryPayload,
  SendMessagePayload,
} from '../shared/types';

export function registerIpcHandlers(
  windowManager: WindowManager,
  memoryStore: MemoryStore,
  apiConversationService: ApiConversationService,
  conversationService: ConversationService,
): void {
  const updater = new AppUpdater(() => conversationService.listConversations().some(item => !!conversationService.getConversation(item.id)?.runningRoundId), { get: () => windowManager.getAutoCheckUpdates(), set: enabled => windowManager.setAutoCheckUpdates(enabled) });
  registerHandler(IPC.APP_UPDATE, (_event, action) => {
    if (!['state', 'check', 'download', 'install', 'releases', 'enable-auto-check', 'disable-auto-check'].includes(action)) throw new Error('Invalid update action');
    return updater.action(action);
  });
  void updater.checkOnStartup();
  registerHandler(IPC.GET_BROWSER_STATE, () => windowManager.getBrowserState());

  registerHandler(IPC.OPEN_CONVERSATION_LINK, async (_event, value: string) => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid link');
    await shell.openExternal(url.href);
  });
  registerHandler(IPC.GET_APP_VERSION, () => app.getVersion());

  registerHandler(IPC.APPLY_TEMPLATE, (_event, payload: ApplyTemplatePayload) => windowManager.applyTemplate(payload));

  registerHandler(IPC.SEND_TO_ALL, (_event, payload: SendToAllPayload) => {
    return windowManager.sendToAll(payload.text);
  });

  registerHandler(IPC.START_NEW_DISCUSSION, () => {
    return windowManager.startNewDiscussion();
  });

  registerHandler(IPC.FORWARD_RESPONSE, (_event, payload: ForwardResponsePayload) => {
    return windowManager.forwardResponse(payload);
  });

  registerHandler(IPC.GET_DOCUMENT_CANDIDATES, () => {
    return windowManager.getDocumentCandidates();
  });

  registerHandler(IPC.GENERATE_DOCUMENT, (_event, payload: GenerateDocumentPayload) => {
    return windowManager.generateDocument(payload);
  });

  registerHandler(IPC.CHOOSE_MEMORY_DIRECTORY, async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: 'Choose Memory Inbox Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return memoryStore.addImportSource(result.filePaths[0]);
  });

  registerHandler(IPC.LIST_MEMORY_SOURCES, () => {
    return memoryStore.listImportSources();
  });

  registerHandler(IPC.REMOVE_MEMORY_SOURCE, (_event, payload: RemoveMemorySourcePayload) => {
    return memoryStore.removeImportSource(payload.id);
  });

  registerHandler(IPC.SCAN_MEMORY_INBOX, () => {
    return memoryStore.scanInbox();
  });

  registerHandler(IPC.GET_MEMORY_INBOX_DOCUMENT, (_event, filePath: string) => {
    return memoryStore.getInboxDocument(filePath);
  });

  registerHandler(IPC.IMPORT_MEMORY_DOCUMENT, (_event, payload: ImportMemoryDocumentPayload) => {
    return memoryStore.importDocument(payload);
  });

  registerHandler(IPC.SEARCH_MEMORY_DOCUMENTS, (_event, payload: SearchMemoryDocumentsPayload) => {
    return memoryStore.searchDocuments(payload.query);
  });

  registerHandler(IPC.GET_MEMORY_DOCUMENT, (_event, payload: GetMemoryDocumentPayload) => {
    return memoryStore.getDocument(payload.id);
  });

  registerHandler(IPC.DISABLE_MEMORY_DOCUMENT, (_event, payload: DisableMemoryDocumentPayload) => {
    return memoryStore.disableDocument(payload.id);
  });

  registerHandler(IPC.RECALL_MEMORY_FOR_AGENT_TASK, (_event, payload: RecallMemoryForAgentTaskPayload) => {
    return memoryStore.recallForAgentTask(payload.query);
  });

  registerHandler(IPC.GET_API_CONVERSATION_CONFIG, () => {
    return apiConversationService.getConfig();
  });

  registerHandler(IPC.REFRESH_API_CONVERSATION_MODELS, () => {
    return apiConversationService.refreshModels();
  });

  registerHandler(IPC.SAVE_API_CONVERSATION_CONFIG, (_event, payload: SaveApiConversationConfigPayload) => {
    return apiConversationService.saveConfig(payload);
  });

  registerHandler(IPC.RUN_API_CONVERSATION, (_event, payload: RunApiConversationPayload) => {
    return apiConversationService.runConversation(payload, (delta) => {
      _event.sender.send(IPC.API_CONVERSATION_DELTA, delta);
    });
  });

  registerHandler(IPC.SET_THEME_MODE, (_event, mode: ThemeMode) => {
    return windowManager.setThemeMode(mode);
  });

  registerHandler(IPC.SET_LANGUAGE, (_event, language: AppLanguage) => {
    return windowManager.setLanguage(language);
  });

  registerHandler(IPC.SET_CONVERSATION_ENTRY_MODE, (_event, mode: ConversationEntryMode) => {
    return windowManager.setConversationEntryMode(mode);
  });

  registerHandler(IPC.SET_FORWARD_CONTROLS_ENABLED, (_event, enabled: boolean) => {
    return windowManager.setForwardControlsEnabled(enabled);
  });

  registerHandler(IPC.NEW_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.newTab(payload.cellId, payload.url);
  });

  registerHandler(IPC.CLOSE_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.closeTab(payload.cellId, payload.tabId);
  });

  registerHandler(IPC.SWITCH_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.switchTab(payload.cellId, payload.tabId);
  });

  registerHandler(IPC.TOGGLE_MUTE, (_event, cellId: string) => {
    return windowManager.toggleMute(cellId);
  });

  registerHandler(IPC.NAVIGATE, (_event, payload: NavigatePayload) => {
    return windowManager.navigate(payload.cellId, payload.url);
  });

  registerHandler(IPC.NAVIGATE_BACK, (_event, cellId: string) => {
    windowManager.navigateBack(cellId);
  });

  registerHandler(IPC.NAVIGATE_FORWARD, (_event, cellId: string) => {
    windowManager.navigateForward(cellId);
  });

  registerHandler(IPC.RELOAD, (_event, cellId: string) => {
    windowManager.reload(cellId);
  });

  registerHandler(IPC.SET_LAYOUT, (_event, mode: LayoutMode) => {
    windowManager.setLayout(mode);
  });

  registerHandler(IPC.SET_OVERLAY_OPEN, (_event, open: boolean) => {
    windowManager.setOverlayOpen(open);
  });

  registerHandler(IPC.SET_MAXIMIZED_CELL, (_event, payload: SetMaximizedCellPayload) => {
    windowManager.setMaximizedCell(payload.cellId);
  });

  registerHandler(IPC.SET_CELL_URL, (_event, payload: SetCellUrlPayload) => {
    windowManager.setCellUrl(payload.cellId, payload.url, payload.mode, payload.searchUrlTemplate);
  });

  registerHandler(IPC.TOGGLE_CELL, (_event, payload: ToggleCellPayload) => {
    windowManager.toggleCell(payload.cellId, payload.active);
  });

  registerHandler(IPC.CELL_FOCUSED, (_event, payload: CellFocusedPayload) => {
    windowManager.focusCell(payload.cellId);
  });

  // --- API Bot 与群聊会谈 ---------------------------------------------------
  // 所有会话 IPC 都会登记事件目标，保证流式增量与轮次状态能推送到渲染层。

  registerHandler(CONVERSATION_IPC.GET_LOCAL_AGENT_CACHE, (_event, agent: LocalAgentId, executable?: string) => localAgentDetectionSnapshot(agent, executable));
  registerHandler(CONVERSATION_IPC.DETECT_LOCAL_AGENT, (_event, agent: LocalAgentId, executable?: string, force?: boolean) => cachedAgentDetection(agent, executable, force === true));

  registerHandler(CONVERSATION_IPC.OPEN_BOT_GUIDE, async (_event, key: string) => { await shell.openExternal(botGuideUrl(key)); });
  registerHandler(CONVERSATION_IPC.SETUP_LOCAL_AGENT, (_event, agent: LocalAgentId, action: 'install' | 'login' | 'docs', executable?: string) => setupLocalAgent(agent, action, executable));

  const track = (event: Electron.IpcMainInvokeEvent) => conversationService.addEventTarget(event.sender);

  registerHandler(CONVERSATION_IPC.TEST_BOT_API, (_event, payload: TestBotApiPayload) => conversationService.testBotApi(payload));

  registerHandler(CONVERSATION_IPC.CREATE_BOT, (event, payload: CreateBotPayload) => {
    track(event);
    return conversationService.createBot(payload);
  });

  registerHandler(CONVERSATION_IPC.UPDATE_BOT, (event, payload: UpdateBotPayload) => {
    track(event);
    return conversationService.updateBot(payload);
  });

  registerHandler(CONVERSATION_IPC.DELETE_BOT, (event, id: string) => {
    track(event);
    return conversationService.deleteBot(id);
  });

  registerHandler(CONVERSATION_IPC.LIST_BOTS, (event) => {
    track(event);
    return conversationService.listBots();
  });

  registerHandler(CONVERSATION_IPC.CREATE_CONVERSATION, (event, payload: CreateConversationPayload) => {
    track(event);
    return conversationService.createConversation(payload);
  });

  registerHandler(CONVERSATION_IPC.UPDATE_CONVERSATION, (event, payload: UpdateConversationPayload) => {
    track(event);
    return conversationService.updateConversation(payload);
  });

  registerHandler(CONVERSATION_IPC.DELETE_CONVERSATION, (event, id: string) => {
    track(event);
    return conversationService.deleteConversation(id);
  });

  registerHandler(CONVERSATION_IPC.LIST_CONVERSATIONS, (event) => {
    track(event);
    return conversationService.listConversations();
  });

  registerHandler(CONVERSATION_IPC.GET_CONVERSATION, (event, id: string) => {
    track(event);
    return conversationService.getConversation(id);
  });

  registerHandler(CONVERSATION_IPC.ADD_CONVERSATION_MEMBERS, (event, payload: AddConversationMembersPayload) => {
    track(event);
    return conversationService.addConversationMembers(payload);
  });

  registerHandler(CONVERSATION_IPC.REMOVE_CONVERSATION_MEMBER, (event, payload: RemoveConversationMemberPayload) => {
    track(event);
    return conversationService.removeConversationMember(payload);
  });

  registerHandler(CONVERSATION_IPC.UPDATE_CONVERSATION_MEMBER, (event, payload: UpdateConversationMemberPayload) => {
    track(event);
    return conversationService.updateConversationMember(payload);
  });

  registerHandler(CONVERSATION_IPC.SEND_MESSAGE, (event, payload: SendMessagePayload) => {
    track(event);
    return conversationService.sendMessage(payload, event.sender);
  });

  registerHandler(CONVERSATION_IPC.STOP_ROUND, (event, payload: ConversationTargetPayload) => {
    track(event);
    return conversationService.stopRound(payload);
  });

  registerHandler(CONVERSATION_IPC.STOP_MEMBER, (event, payload: ConversationTargetPayload) => {
    track(event);
    return conversationService.stopMember(payload);
  });

  registerHandler(CONVERSATION_IPC.RETRY_MEMBER, (event, payload: ConversationTargetPayload) => {
    track(event);
    return conversationService.retryMember(payload, event.sender);
  });

  registerHandler(CONVERSATION_IPC.REQUEST_REVIEW, (event, payload: RequestReviewPayload) => {
    track(event);
    return conversationService.requestReview(payload, event.sender);
  });

  registerHandler(CONVERSATION_IPC.REQUEST_SUMMARY, (event, payload: RequestSummaryPayload) => {
    track(event);
    return conversationService.requestSummary(payload, event.sender);
  });

  registerHandler(CONVERSATION_IPC.GET_CONVERSATION_STATE, (event) => {
    track(event);
    return conversationService.getConversationState();
  });

  registerHandler(CONVERSATION_IPC.MIGRATE_FROM_CELLS, (event, payload: MigrateFromCellsPayload) => {
    track(event);
    return conversationService.migrateFromCells(payload);
  });
}

function registerHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}
