import type { LocalAgentId } from './botCatalog';
import type { LayoutTemplate } from './presetTemplates';

export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'triple' | 'quad';
export type CellMode = 'chat' | 'search';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppLanguage = 'zh' | 'en';
export type ConversationEntryMode = 'embedded' | 'api';

export interface CellConfig {
  id: string;
  defaultUrl: string;
  active: boolean;
}

export const CELL_IDS = ['cell-0', 'cell-1', 'cell-2', 'cell-3'] as const;

export const DEFAULT_URLS: Record<string, string> = {
  'cell-0': 'https://claude.ai',
  'cell-1': 'https://chatgpt.com',
  'cell-2': 'https://chat.deepseek.com',
  'cell-3': 'https://www.doubao.com',
};

export const LAYOUT_CELLS: Record<LayoutMode, string[]> = {
  single: ['cell-0'],
  horizontal: ['cell-0', 'cell-1'],
  vertical: ['cell-0', 'cell-1'],
  triple: ['cell-0', 'cell-1', 'cell-2'],
  quad: ['cell-0', 'cell-1', 'cell-2', 'cell-3'],
};

export const IPC = {
  GET_BROWSER_STATE: 'get-browser-state',
  APP_UPDATE: 'app-update',
  GET_APP_VERSION: 'get-app-version',
  OPEN_CONVERSATION_LINK: 'open-conversation-link',
  SEND_TO_ALL: 'send-to-all',
  START_NEW_DISCUSSION: 'start-new-discussion',
  FORWARD_RESPONSE: 'forward-response',
  GET_DOCUMENT_CANDIDATES: 'get-document-candidates',
  GENERATE_DOCUMENT: 'generate-document',
  CHOOSE_MEMORY_DIRECTORY: 'choose-memory-directory',
  LIST_MEMORY_SOURCES: 'list-memory-sources',
  REMOVE_MEMORY_SOURCE: 'remove-memory-source',
  SCAN_MEMORY_INBOX: 'scan-memory-inbox',
  GET_MEMORY_INBOX_DOCUMENT: 'get-memory-inbox-document',
  IMPORT_MEMORY_DOCUMENT: 'import-memory-document',
  SEARCH_MEMORY_DOCUMENTS: 'search-memory-documents',
  GET_MEMORY_DOCUMENT: 'get-memory-document',
  DISABLE_MEMORY_DOCUMENT: 'disable-memory-document',
  RECALL_MEMORY_FOR_AGENT_TASK: 'recall-memory-for-agent-task',
  GET_API_CONVERSATION_CONFIG: 'get-api-conversation-config',
  REFRESH_API_CONVERSATION_MODELS: 'refresh-api-conversation-models',
  SAVE_API_CONVERSATION_CONFIG: 'save-api-conversation-config',
  RUN_API_CONVERSATION: 'run-api-conversation',
  API_CONVERSATION_DELTA: 'api-conversation-delta',
  APPLY_TEMPLATE: 'apply-template',
  SET_LAYOUT: 'set-layout',
  SET_OVERLAY_OPEN: 'set-overlay-open',
  SET_MAXIMIZED_CELL: 'set-maximized-cell',
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigate-back',
  NAVIGATE_FORWARD: 'navigate-forward',
  RELOAD: 'reload',
  SET_CELL_URL: 'set-cell-url',
  TOGGLE_CELL: 'toggle-cell',
  TOGGLE_MUTE: 'toggle-mute',
  NEW_TAB: 'new-tab',
  CLOSE_TAB: 'close-tab',
  SWITCH_TAB: 'switch-tab',
  SET_THEME_MODE: 'set-theme-mode',
  SET_LANGUAGE: 'set-language',
  SET_CONVERSATION_ENTRY_MODE: 'set-conversation-entry-mode',
  SET_FORWARD_CONTROLS_ENABLED: 'set-forward-controls-enabled',
  CELL_FOCUSED: 'cell-focused',
  FORWARD_COMPLETED: 'forward-completed',
  SHOW_CELL_NOTICE: 'show-cell-notice',
  LAYOUT_CHANGED: 'layout-changed',
  CELL_URL_CHANGED: 'cell-url-changed',
  CELL_TITLE_CHANGED: 'cell-title-changed',
  CELL_FAVICON_CHANGED: 'cell-favicon-changed',
} as const;

export interface NavigatePayload {
  cellId: string;
  url: string;
}

export interface SetCellUrlPayload {
  cellId: string;
  url: string;
  mode?: CellMode;
  searchUrlTemplate?: string;
}

export interface ToggleCellPayload {
  cellId: string;
  active: boolean;
}

export interface CellFocusedPayload {
  cellId: string;
}

export interface SendToAllPayload {
  text: string;
}

export interface ForwardResponsePayload {
  sourceCellId: string;
  targetCellId: string;
}

export interface GenerateDocumentPayload {
  summarizerCellId: string;
}

export interface MemoryImportSource {
  id: string;
  path: string;
  createdAt: number;
  lastScannedAt: number | null;
}

export interface RemoveMemorySourcePayload {
  id: string;
}

export type MemoryInboxStatus = 'new' | 'modified' | 'disabled' | 'imported';
export type MemoryDocumentType = 'profile' | 'project' | 'decision_rule' | 'event' | 'reference';
export type MemoryScope = 'global' | 'project';

export interface MemoryInboxItem {
  sourceId: string;
  sourcePath: string;
  filePath: string;
  fileName: string;
  title: string;
  hash: string;
  size: number;
  mtimeMs: number;
  status: MemoryInboxStatus;
  existingDocumentId?: string;
}

export interface MemoryInboxDocument {
  item: MemoryInboxItem;
  contentMarkdown: string;
  suggestedTitle: string;
  suggestedTags: string[];
}

export interface ImportMemoryDocumentPayload {
  sourceId?: string;
  sourcePath?: string;
  filePath?: string;
  title: string;
  memoryType?: MemoryDocumentType;
  memoryScope?: MemoryScope;
  originalQuestion?: string;
  participantSites?: string[];
  tags?: string[];
  contentMarkdown?: string;
}

export interface SearchMemoryDocumentsPayload {
  query: string;
}

export interface RecallMemoryForAgentTaskPayload {
  query: string;
}

export interface GetMemoryDocumentPayload {
  id: string;
}

export interface DisableMemoryDocumentPayload {
  id: string;
}

export interface MemoryDocumentSummary {
  id: string;
  title: string;
  originalQuestion: string;
  memoryType: MemoryDocumentType;
  memoryScope: MemoryScope;
  tags: string[];
  participantSites: string[];
  sourceType: string;
  sourcePath: string | null;
  sourceExists: boolean;
  createdAt: number;
  updatedAt: number;
  importedAt: number;
  version: number;
  snippet?: string;
}

export interface MemoryDocument extends MemoryDocumentSummary {
  contentMarkdown: string;
  sourceHash: string | null;
  sourceMtime: number | null;
  sourceSize: number | null;
}

export interface MemoryRecallItem {
  id: string;
  title: string;
  memoryType: MemoryDocumentType;
  memoryScope: MemoryScope;
  tags: string[];
  score: number;
  matchReasons: MemoryRecallReason[];
  scoreDetails: MemoryRecallScoreDetail[];
  excerpt: string;
}

export interface MemoryRecallScoreDetail {
  reason: MemoryRecallReason;
  score: number;
  matches?: string[];
}

export type MemoryRecallReason =
  | 'title'
  | 'tag'
  | 'body'
  | 'profile_priority'
  | 'decision_rule_priority'
  | 'project_scope'
  | 'global_scope'
  | 'recent';

export interface MemoryRecallContext {
  items: MemoryRecallItem[];
  agentContext: string;
}

export interface ApiConversationConfig {
  baseUrl: string;
  /** 推荐模型列表（带品牌筛选，仅用于帮助选择） */
  models: string[];
  /** 平台返回的完整模型列表；推荐列表不构成可调用白名单 */
  allModels?: string[];
  cellModels?: Record<string, string>;
  apiKeyConfigured: boolean;
}

export interface SaveApiConversationConfigPayload {
  baseUrl: string;
  models?: string[];
  cellModels?: Record<string, string>;
  apiKey?: string;
}

export interface RunApiConversationPayload {
  prompt: string;
  models?: string[];
  requestId?: string;
}

export interface ApiConversationModelResult {
  model: string;
  content: string;
  error?: string;
  elapsedMs: number;
}

export type ApiConversationCellStatus = 'idle' | 'running' | 'completed' | 'error';

export interface ApiConversationCellState {
  model: string;
  content: string;
  error?: string;
  elapsedMs?: number;
  status: ApiConversationCellStatus;
}

export interface ApiConversationResult {
  prompt: string;
  results: ApiConversationModelResult[];
  createdAt: number;
}

export interface ApiConversationDeltaPayload {
  requestId?: string;
  model: string;
  delta?: string;
  content: string;
  done: boolean;
  error?: string;
  elapsedMs?: number;
}

export interface ExtractedConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  domId?: string;
  order?: number;
}

// ---------------------------------------------------------------------------
// API Bot 与群聊会谈（docs/api-bot-group-conversation-proposal.md）
// ---------------------------------------------------------------------------

export const CONVERSATION_IPC = {
  GET_LOCAL_AGENT_CACHE: 'conversation-get-local-agent-cache',
  DETECT_LOCAL_AGENT: 'conversation-detect-local-agent',
  SETUP_LOCAL_AGENT: 'conversation-setup-local-agent',
  OPEN_BOT_GUIDE: 'conversation-open-bot-guide',
  // Bot 管理
  TEST_BOT_API: 'conversation-test-bot-api',
  CREATE_BOT: 'conversation-create-bot',
  UPDATE_BOT: 'conversation-update-bot',
  DELETE_BOT: 'conversation-delete-bot',
  LIST_BOTS: 'conversation-list-bots',
  // 会谈管理
  CREATE_CONVERSATION: 'conversation-create',
  UPDATE_CONVERSATION: 'conversation-update',
  DELETE_CONVERSATION: 'conversation-delete',
  LIST_CONVERSATIONS: 'conversation-list',
  GET_CONVERSATION: 'conversation-get',
  UPDATE_CONVERSATION_MEMBER: 'conversation-update-member',
  ADD_CONVERSATION_MEMBERS: 'conversation-add-members',
  REMOVE_CONVERSATION_MEMBER: 'conversation-remove-member',
  // 消息与轮次
  SEND_MESSAGE: 'conversation-send-message',
  STOP_ROUND: 'conversation-stop-round',
  STOP_MEMBER: 'conversation-stop-member',
  RETRY_MEMBER: 'conversation-retry-member',
  REQUEST_REVIEW: 'conversation-request-review',
  REQUEST_SUMMARY: 'conversation-request-summary',
  // 流式输出与轮次状态
  MESSAGE_DELTA: 'conversation-message-delta',
  ROUND_STATUS: 'conversation-round-status',
  // 迁移与状态
  GET_CONVERSATION_STATE: 'conversation-get-state',
  MIGRATE_FROM_CELLS: 'conversation-migrate-from-cells',
} as const;

export type BotConnection =
  | { kind: 'legacy-api' }
  | { kind: 'api'; baseUrl: string; credentialId?: string; maxOutputTokens?: number }
  | { kind: 'cli'; agent: LocalAgentId; executable?: string; cwd?: string };

export type LocalAgentSetupResult = { status: 'opened' } | { status: 'authenticated'; agentStatus: LocalAgentStatus };

export interface LocalAgentStatus {
  installed: boolean;
  executable?: string;
  authenticated: boolean;
  usable?: boolean;
  authChecked?: boolean;
  authMethod: 'subscription' | 'api' | 'unknown';
}

export interface Bot {
  avatar?: string;
  connection?: BotConnection;
  id: string;
  name: string;
  model: string;
  rolePrompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface TestBotApiPayload { baseUrl: string; apiKey?: string; model: string; botId?: string; }
export type TestBotApiResult = { status: 'success' | 'invalid' | 'auth' | 'credits' | 'model' | 'timeout' | 'network' | 'restart' | 'failed'; };

export interface CreateBotPayload {
  avatar?: string;
  connection?: BotConnection;
  apiKey?: string;
  name: string;
  model: string;
  rolePrompt?: string;
}

export interface UpdateBotPayload {
  avatar?: string;
  connection?: BotConnection;
  apiKey?: string;
  id: string;
  name?: string;
  model?: string;
  rolePrompt?: string;
}

/** 会谈成员：创建时保存的 Bot 身份快照（不含 Key）。 */
export interface ConversationMember {
  avatar?: string;
  connection?: BotConnection;
  botId: string;
  name: string;
  model: string;
  rolePrompt: string;
}

export interface AddConversationMembersPayload {
  conversationId: string;
  botIds: string[];
}

export interface RemoveConversationMemberPayload {
  conversationId: string;
  botId: string;
}

export interface UpdateConversationMemberPayload {
  conversationId: string;
  botId: string;
  name?: string;
  rolePrompt?: string;
}

export interface ConversationSummary {
  avatar?: string;
  lastMessage?: { name: string; content: string } | null;
  coordinatorId?: string | null;
  id: string;
  title: string;
  members: ConversationMember[];
  lastActivityAt: number;
  createdAt: number;
}

export interface Conversation extends ConversationSummary {
  coordinationPhase?: 'planning' | 'working' | 'summarizing';
  messages: ConversationMessage[];
  runningRoundId: string | null;
}

export interface CreateConversationPayload {
  title?: string;
  botIds: string[];
}

export interface UpdateConversationPayload {
  avatar?: string;
  coordinatorId?: string | null;
  id: string;
  title?: string;
}

export type ConversationMessageStatus =
  | 'streaming'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted';

export type ConversationMessageType = 'normal' | 'review' | 'summary';

export type AgentActivity = 'connecting' | 'waiting' | 'thinking' | 'searching' | 'working' | 'answering' | 'retrying';

export interface ConversationMessage {
  activity?: AgentActivity;
  botSnapshotSource?: string;
  id: string;
  conversationId: string;
  roundId: string;
  /** null = 用户消息 */
  botId: string | null;
  botSnapshotName: string;
  botSnapshotModel: string;
  role: 'user' | 'assistant';
  content: string;
  status: ConversationMessageStatus;
  messageType: ConversationMessageType;
  quotedMessageId?: string;
  createdAt: number;
  elapsedMs?: number;
  error?: string;
}

export type ConversationRoundStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed';

export interface ConversationRoundStatusPayload {
  /** Ordered message placeholders, published before the first delta. */
  conversation?: Conversation;
  conversationId: string;
  roundId: string | null;
  status: ConversationRoundStatus;
  /** 各成员（botId → 状态）快照，用于界面显示本轮进度 */
  memberStatuses?: Record<string, ConversationMessageStatus>;
}

export interface ConversationMessageDeltaPayload {
  activity?: AgentActivity;
  conversationId: string;
  roundId: string;
  messageId: string;
  botId: string;
  delta?: string;
  content: string;
  done: boolean;
  status?: ConversationMessageStatus;
  error?: string;
  elapsedMs?: number;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  /** 收件人选择器是最终依据；为空 = 发送给全体当前成员 */
  botIds?: string[];
  quotedMessageId?: string;
}

export interface ConversationTargetPayload {
  messageId?: string;
  conversationId: string;
  roundId?: string;
  botId?: string;
}

export interface RequestReviewPayload {
  conversationId: string;
  /** 为空 = 全体成员参与互评 */
  botIds?: string[];
}

export interface RequestSummaryPayload {
  conversationId: string;
  botId: string;
}

export interface ConversationState {
  bots: Bot[];
  conversations: ConversationSummary[];
  /** 旧格子模型是否已迁移为 Bot / 会谈 */
  cellsMigrated: boolean;
  legacyCellModels: Record<string, string>;
  apiKeyConfigured: boolean;
}

export interface MigrateFromCellsPayload {
  /** 用户确认保留的 cellId → 模型映射（含重复模型） */
  cellModels: Record<string, string>;
}

export interface ExtractedConversation {
  entries: ExtractedConversationEntry[];
}

export interface ForwardRecord {
  id: string;
  sourceCellId: string;
  targetCellId: string;
  sourceContent: string;
  sourceTruncated: boolean;
  targetReply: string;
  timestamp: number;
}

export interface ForwardCompletedPayload {
  record: ForwardRecord;
}

export interface DocumentCandidate {
  cellId: string;
  url: string;
  active: boolean;
  hasTimeline: boolean;
}

export interface CellTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
}

export interface CellTabPayload {
  cellId: string;
  tabId?: string;
  url?: string;
}

export type NoticeType =
  | 'google-login-blocked'
  | 'inject-failed'
  | 'load-failed'
  | 'load-timeout'
  | 'source-response-pending'
  | 'conversation-truncated';

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  messageKey: string;
}

export interface SetMaximizedCellPayload {
  cellId: string | null;
}

export interface BrowserState {
  layoutMode: LayoutMode;
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  activeCells: Record<string, boolean>;
  mutedCells: Record<string, boolean>;
  tabs: Record<string, CellTab[]>;
  activeTabIds: Record<string, string>;
  themeMode: ThemeMode;
  language: AppLanguage;
  conversationEntryMode: ConversationEntryMode;
  forwardControlsEnabled: boolean;
  focusedCellId: string;
  maximizedCellId: string | null;
  hasCompletedOnboarding: boolean;
}

export interface ApplyTemplatePayload {
  template: LayoutTemplate;
}

export interface CellUrlChangedPayload {
  cellId: string;
  url: string;
}

export interface CellTitleChangedPayload {
  cellId: string;
  title: string;
}

export interface CellFaviconChangedPayload {
  cellId: string;
  favicon: string;
}

export interface LayoutChangedPayload {
  layoutMode: LayoutMode;
}

export interface AppUpdateState {
  autoCheck: boolean;
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  progress?: number;
  canInstall: boolean;
  error?: 'network' | 'busy' | 'development';
}
export type AppUpdateAction = 'state' | 'check' | 'download' | 'install' | 'releases' | 'enable-auto-check' | 'disable-auto-check';

export interface ElectronAPI {
  appUpdate: (action: AppUpdateAction) => Promise<AppUpdateState>;
  openBotGuide: (key: import('./botCatalog').BotGuideLink) => Promise<void>;
  setupLocalAgent: (agent: LocalAgentId, action: 'install' | 'login' | 'docs', executable?: string) => Promise<LocalAgentSetupResult>;
  getLocalAgentCache: (agent: LocalAgentId, executable?: string) => Promise<Partial<Record<LocalAgentId, LocalAgentStatus>>>;
  detectLocalAgent: (agent: LocalAgentId, executable?: string, force?: boolean) => Promise<LocalAgentStatus>;
  getBrowserState: () => Promise<BrowserState>;
  getAppVersion: () => Promise<string>;
  openConversationLink: (url: string) => Promise<void>;
  applyTemplate: (payload: ApplyTemplatePayload) => Promise<BrowserState>;
  sendToAll: (payload: SendToAllPayload) => Promise<void>;
  startNewDiscussion: () => Promise<BrowserState>;
  forwardResponse: (payload: ForwardResponsePayload) => Promise<ForwardRecord>;
  getDocumentCandidates: () => Promise<DocumentCandidate[]>;
  generateDocument: (payload: GenerateDocumentPayload) => Promise<void>;
  chooseMemoryDirectory: () => Promise<MemoryImportSource | null>;
  listMemorySources: () => Promise<MemoryImportSource[]>;
  removeMemorySource: (payload: RemoveMemorySourcePayload) => Promise<void>;
  scanMemoryInbox: () => Promise<MemoryInboxItem[]>;
  getMemoryInboxDocument: (filePath: string) => Promise<MemoryInboxDocument>;
  importMemoryDocument: (payload: ImportMemoryDocumentPayload) => Promise<MemoryDocument>;
  searchMemoryDocuments: (payload: SearchMemoryDocumentsPayload) => Promise<MemoryDocumentSummary[]>;
  getMemoryDocument: (payload: GetMemoryDocumentPayload) => Promise<MemoryDocument | null>;
  disableMemoryDocument: (payload: DisableMemoryDocumentPayload) => Promise<void>;
  recallMemoryForAgentTask: (payload: RecallMemoryForAgentTaskPayload) => Promise<MemoryRecallContext>;
  getApiConversationConfig: () => Promise<ApiConversationConfig>;
  refreshApiConversationModels: () => Promise<ApiConversationConfig>;
  saveApiConversationConfig: (payload: SaveApiConversationConfigPayload) => Promise<ApiConversationConfig>;
  runApiConversation: (payload: RunApiConversationPayload) => Promise<ApiConversationResult>;
  onApiConversationDelta: (callback: (payload: ApiConversationDeltaPayload) => void) => () => void;
  setLayout: (mode: LayoutMode) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<BrowserState>;
  setLanguage: (language: AppLanguage) => Promise<BrowserState>;
  setConversationEntryMode: (mode: ConversationEntryMode) => Promise<BrowserState>;
  setForwardControlsEnabled: (enabled: boolean) => Promise<BrowserState>;
  setOverlayOpen: (open: boolean) => Promise<void>;
  setMaximizedCell: (payload: SetMaximizedCellPayload) => Promise<void>;
  navigate: (payload: NavigatePayload) => Promise<BrowserState>;
  navigateBack: (cellId: string) => Promise<void>;
  navigateForward: (cellId: string) => Promise<void>;
  reload: (cellId: string) => Promise<void>;
  setCellUrl: (payload: SetCellUrlPayload) => Promise<void>;
  toggleCell: (payload: ToggleCellPayload) => Promise<void>;
  toggleMute: (cellId: string) => Promise<BrowserState>;
  newTab: (payload: CellTabPayload) => Promise<BrowserState>;
  closeTab: (payload: CellTabPayload) => Promise<BrowserState>;
  switchTab: (payload: CellTabPayload) => Promise<BrowserState>;
  focusCell: (payload: CellFocusedPayload) => Promise<void>;
  onCellFocused: (callback: (payload: CellFocusedPayload) => void) => () => void;
  onLayoutChanged: (callback: (payload: LayoutChangedPayload) => void) => () => void;
  onCellNotice: (callback: (payload: CellNoticePayload) => void) => () => void;
  onForwardCompleted: (callback: (payload: ForwardCompletedPayload) => void) => () => void;
  onCellUrlChanged: (callback: (payload: CellUrlChangedPayload) => void) => () => void;
  onCellTitleChanged: (callback: (payload: CellTitleChangedPayload) => void) => () => void;
  onCellFaviconChanged: (callback: (payload: CellFaviconChangedPayload) => void) => () => void;
  // API Bot 与群聊会谈
  testBotApi: (payload: TestBotApiPayload) => Promise<TestBotApiResult>;
  createBot: (payload: CreateBotPayload) => Promise<Bot>;
  updateBot: (payload: UpdateBotPayload) => Promise<Bot>;
  deleteBot: (id: string) => Promise<void>;
  listBots: () => Promise<Bot[]>;
  createConversation: (payload: CreateConversationPayload) => Promise<Conversation>;
  updateConversation: (payload: UpdateConversationPayload) => Promise<ConversationSummary>;
  deleteConversation: (id: string) => Promise<void>;
  listConversations: () => Promise<ConversationSummary[]>;
  getConversation: (id: string) => Promise<Conversation | null>;
  updateConversationMember: (payload: UpdateConversationMemberPayload) => Promise<Conversation>;
  addConversationMembers: (payload: AddConversationMembersPayload) => Promise<Conversation>;
  removeConversationMember: (payload: RemoveConversationMemberPayload) => Promise<Conversation>;
  sendConversationMessage: (payload: SendMessagePayload) => Promise<Conversation>;
  stopConversationRound: (payload: ConversationTargetPayload) => Promise<void>;
  stopConversationMember: (payload: ConversationTargetPayload) => Promise<void>;
  retryConversationMember: (payload: ConversationTargetPayload) => Promise<Conversation>;
  requestConversationReview: (payload: RequestReviewPayload) => Promise<Conversation>;
  requestConversationSummary: (payload: RequestSummaryPayload) => Promise<Conversation>;
  getConversationState: () => Promise<ConversationState>;
  migrateConversationFromCells: (payload: MigrateFromCellsPayload) => Promise<ConversationState>;
  onConversationMessageDelta: (callback: (payload: ConversationMessageDeltaPayload) => void) => () => void;
  onConversationRoundStatus: (callback: (payload: ConversationRoundStatusPayload) => void) => () => void;
}
