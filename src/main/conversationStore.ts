import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { BuiltConversationContext } from '../shared/conversationContext';
import {
  Bot,
  BotConnection,
  CreateBotPayload,
  UpdateBotPayload,
  Conversation,
  ConversationMember,
  ConversationMessage,
  ConversationMessageStatus,
  ConversationMessageType,
  ConversationSummary,
} from '../shared/types';

/**
 * API Bot 群聊本地持久化（评审 3.3：采用 better-sqlite3，不把历史塞进 electron-store）。
 *
 * 表结构方向：
 * - conversation_bots：Bot 模板（名称 / 模型 / 角色说明），可重复加入会谈
 * - conversations：会谈标题与最近活动时间
 * - conversation_members：成员快照（创建时保存名称、模型、角色，不含 Key）；
 *   修改 Bot 模板不改写历史成员快照
 * - conversation_messages：按轮次（round_id）组织的消息，含状态与类型；
 *   同轮消息共享 roundId，是实现稳定占位排列和同轮相同历史范围的关键
 */

interface BotRow {
  avatar: string;
  connection_json: string;
  id: string;
  name: string;
  model: string;
  role_prompt: string;
  created_at: number;
  updated_at: number;
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  last_activity_at: number;
}

interface MemberRow {
  avatar: string;
  connection_json: string;
  conversation_id: string;
  bot_id: string;
  name: string;
  model: string;
  role_prompt: string;
  position: number;
}

interface MessageRow {
  bot_snapshot_source: string;
  id: string;
  conversation_id: string;
  round_id: string;
  bot_id: string | null;
  bot_snapshot_name: string;
  bot_snapshot_model: string;
  role: 'user' | 'assistant';
  content: string;
  status: ConversationMessageStatus;
  message_type: ConversationMessageType;
  quoted_message_id: string | null;
  created_at: number;
  elapsed_ms: number | null;
  error: string | null;
}

export interface ConversationRequestSnapshot {
  member: ConversationMember;
  context: BuiltConversationContext;
  baseUrl: string;
  language: 'zh' | 'en';
}

export interface InsertMessageInput {
  botSnapshotSource?: string;
  id?: string;
  conversationId: string;
  roundId: string;
  botId: string | null;
  botSnapshotName: string;
  botSnapshotModel: string;
  role: 'user' | 'assistant';
  content: string;
  status: ConversationMessageStatus;
  messageType: ConversationMessageType;
  quotedMessageId?: string | null;
}

export interface MessageUpdate {
  content?: string;
  status?: ConversationMessageStatus;
  elapsedMs?: number;
  error?: string | null;
}

export class ConversationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    // 关闭应用后未完成请求标记为中断（方案 §7），重启不自动续发。
    this.markInterruptedMessages();
  }

  close(): void {
    this.db.close();
  }

  // --- Bot 模板 -----------------------------------------------------------

  createBot(input: CreateBotPayload): Bot {
    const now = Date.now();
    const bot: Bot = {
      avatar: input.avatar ?? '',
      connection: input.connection ?? { kind: 'legacy-api' },
      id: createId('bot'),
      name: input.name.trim(),
      model: input.model.trim(),
      rolePrompt: input.rolePrompt?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO conversation_bots (id, name, model, role_prompt, created_at, updated_at, connection_json, avatar)
         VALUES (@id, @name, @model, @rolePrompt, @createdAt, @updatedAt, @connection, @avatar)`,
      )
      .run({
        avatar: bot.avatar,
        connection: JSON.stringify(bot.connection),
        id: bot.id,
        name: bot.name,
        model: bot.model,
        rolePrompt: bot.rolePrompt,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      });
    return bot;
  }

  updateBot(input: UpdateBotPayload): Bot {
    const row = this.db.prepare('SELECT * FROM conversation_bots WHERE id = ?').get(input.id) as BotRow | undefined;
    if (!row) {
      throw new Error(`Bot not found: ${input.id}`);
    }
    const next = {
      avatar: input.avatar ?? row.avatar,
      connection: JSON.stringify(input.connection ?? JSON.parse(row.connection_json)),
      id: row.id,
      name: input.name?.trim() || row.name,
      model: input.model !== undefined ? input.model.trim() : row.model,
      rolePrompt: input.rolePrompt !== undefined ? input.rolePrompt.trim() : row.role_prompt,
      createdAt: row.created_at,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE conversation_bots SET name = @name, model = @model, role_prompt = @rolePrompt, updated_at = @updatedAt, connection_json = @connection, avatar = @avatar
         WHERE id = @id`,
      )
      .run(next);
    return {
      avatar: next.avatar,
      connection: JSON.parse(next.connection) as BotConnection,
      id: next.id,
      name: next.name,
      model: next.model,
      rolePrompt: next.rolePrompt,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
    };
  }

  deleteBot(id: string): void {
    // 删除 Bot 模板不删除历史会谈；历史成员仍使用自己的快照（方案 §3）。
    this.db.prepare('DELETE FROM conversation_bots WHERE id = ?').run(id);
  }

  listBots(): Bot[] {
    const rows = this.db
      .prepare('SELECT * FROM conversation_bots ORDER BY created_at ASC')
      .all() as BotRow[];
    return rows.map(mapBot);
  }

  getBot(id: string): Bot | null {
    const row = this.db.prepare('SELECT * FROM conversation_bots WHERE id = ?').get(id) as BotRow | undefined;
    return row ? mapBot(row) : null;
  }

  // --- 会谈 ---------------------------------------------------------------

  createConversation(input: { title: string; members: Array<Pick<Bot, 'id' | 'name' | 'model' | 'rolePrompt' | 'connection' | 'avatar'>> }): Conversation {
    const now = Date.now();
    const conversation: ConversationRow = {
      id: createId('conv'),
      title: input.title.trim() || '',
      created_at: now,
      last_activity_at: now,
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO conversations (id, title, created_at, last_activity_at)
           VALUES (@id, @title, @createdAt, @lastActivityAt)`,
        )
        .run({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.created_at,
          lastActivityAt: conversation.last_activity_at,
        });
      this.setMembers(conversation.id, input.members);
    });
    tx();
    return this.getConversation(conversation.id)!;
  }

  updateConversation(id: string, patch: { title?: string; avatar?: string; coordinatorId?: string | null }): void {
    if (patch.avatar !== undefined) this.setMeta(`groupAvatar:${id}`, patch.avatar);
    if (patch.coordinatorId !== undefined) this.setMeta(`coordinator:${id}`, patch.coordinatorId ?? '');
    if (patch.title !== undefined) {
      this.db
        .prepare('UPDATE conversations SET title = ? WHERE id = ?')
        .run(patch.title.trim(), id);
    }
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM conversation_meta WHERE key = ?').run(`coordinator:${id}`);
    this.db.prepare('DELETE FROM conversation_meta WHERE key = ?').run(`groupAvatar:${id}`);
  }

  touchConversation(id: string): void {
    this.db
      .prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  private lastMessage(id: string): { name: string; content: string } | null {
    const row = this.db.prepare("SELECT bot_snapshot_name, content FROM conversation_messages WHERE conversation_id = ? AND TRIM(content) != '' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(id) as { bot_snapshot_name: string; content: string } | undefined;
    return row ? { name: row.bot_snapshot_name, content: row.content.replace(/\s+/g, ' ').slice(0, 160) } : null;
  }

  listConversations(): ConversationSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations ORDER BY last_activity_at DESC')
      .all() as ConversationRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      members: this.listMembers(row.id),
      coordinatorId: this.getMeta(`coordinator:${row.id}`) || null,
      avatar: this.getMeta(`groupAvatar:${row.id}`) || undefined,
      lastMessage: this.lastMessage(row.id),
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
    }));
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      title: row.title,
      members: this.listMembers(row.id),
      coordinatorId: this.getMeta(`coordinator:${row.id}`) || null,
      avatar: this.getMeta(`groupAvatar:${row.id}`) || undefined,
      lastMessage: this.lastMessage(row.id),
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      messages: this.listMessages(row.id),
      runningRoundId: null,
    };
  }

  // --- 成员快照 -----------------------------------------------------------

  setMembers(conversationId: string, members: Array<Pick<Bot, 'id' | 'name' | 'model' | 'rolePrompt' | 'connection' | 'avatar'>>): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO conversation_members (conversation_id, bot_id, name, model, role_prompt, position, connection_json, avatar)
       VALUES (@conversationId, @botId, @name, @model, @rolePrompt, @position, @connection, @avatar)`,
    );
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
      members.forEach((member, index) => {
        insert.run({
          avatar: member.avatar ?? '',
          connection: JSON.stringify(member.connection ?? { kind: 'legacy-api' }),
          conversationId,
          botId: member.id,
          name: member.name,
          model: member.model,
          rolePrompt: member.rolePrompt ?? '',
          position: index,
        });
      });
    });
    tx();
  }

  addMembers(conversationId: string, members: Array<Pick<Bot, 'id' | 'name' | 'model' | 'rolePrompt' | 'connection' | 'avatar'>>): void {
    const existing = this.listMembers(conversationId).map((member) => ({
      avatar: member.avatar,
      connection: member.connection,
      id: member.botId,
      name: member.name,
      model: member.model,
      rolePrompt: member.rolePrompt,
    }));
    const known = new Set(existing.map((member) => member.id));
    const merged = [...existing, ...members.filter((member) => !known.has(member.id))];
    this.setMembers(conversationId, merged);
  }

  removeMember(conversationId: string, botId: string): void {
    this.db
      .prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND bot_id = ?')
      .run(conversationId, botId);
  }

  updateMember(
    conversationId: string,
    botId: string,
    patch: { name?: string; rolePrompt?: string },
  ): void {
    const row = this.db
      .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND bot_id = ?')
      .get(conversationId, botId) as MemberRow | undefined;
    if (!row) {
      throw new Error(`Conversation member not found: ${botId}`);
    }
    this.db
      .prepare(
        `UPDATE conversation_members SET name = ?, role_prompt = ?
         WHERE conversation_id = ? AND bot_id = ?`,
      )
      .run(
        patch.name?.trim() || row.name,
        patch.rolePrompt !== undefined ? patch.rolePrompt.trim() : row.role_prompt,
        conversationId,
        botId,
      );
  }

  listMembers(conversationId: string): ConversationMember[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY position ASC',
      )
      .all(conversationId) as MemberRow[];
    return rows.map(mapMember);
  }

  // --- 消息 ---------------------------------------------------------------

  insertMessage(input: InsertMessageInput): ConversationMessage {
    const message: ConversationMessage = {
      botSnapshotSource: input.botSnapshotSource ?? '',
      id: input.id ?? createId('msg'),
      conversationId: input.conversationId,
      roundId: input.roundId,
      botId: input.botId,
      botSnapshotName: input.botSnapshotName,
      botSnapshotModel: input.botSnapshotModel,
      role: input.role,
      content: input.content,
      status: input.status,
      messageType: input.messageType,
      ...(input.quotedMessageId ? { quotedMessageId: input.quotedMessageId } : {}),
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO conversation_messages (
           id, conversation_id, round_id, bot_id, bot_snapshot_name, bot_snapshot_model,
           role, content, status, message_type, quoted_message_id, created_at, sequence, bot_snapshot_source
         ) VALUES (
           @id, @conversationId, @roundId, @botId, @botSnapshotName, @botSnapshotModel,
           @role, @content, @status, @messageType, @quotedMessageId, @createdAt,
           (SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages), @botSnapshotSource
         )`,
      )
      .run({
        botSnapshotSource: message.botSnapshotSource,
        id: message.id,
        conversationId: message.conversationId,
        roundId: message.roundId,
        botId: message.botId,
        botSnapshotName: message.botSnapshotName,
        botSnapshotModel: message.botSnapshotModel,
        role: message.role,
        content: message.content,
        status: message.status,
        messageType: message.messageType,
        quotedMessageId: message.quotedMessageId ?? null,
        createdAt: message.createdAt,
      });
    return message;
  }

  updateMessage(id: string, patch: MessageUpdate): void {
    const row = this.db
      .prepare('SELECT * FROM conversation_messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    if (!row) {
      return;
    }
    this.db
      .prepare(
        `UPDATE conversation_messages
         SET content = ?, status = ?, elapsed_ms = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        patch.content ?? row.content,
        patch.status ?? row.status,
        patch.elapsedMs ?? row.elapsed_ms,
        patch.error !== undefined ? patch.error : row.error,
        id,
      );
  }

  getMessage(id: string): ConversationMessage | null {
    const row = this.db
      .prepare('SELECT * FROM conversation_messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  listMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY sequence ASC',
      )
      .all(conversationId) as MessageRow[];
    return rows.map(mapMessage);
  }

  getLatestRoundId(conversationId: string): string | null {
    const row = this.db
      .prepare(
        'SELECT round_id FROM conversation_messages WHERE conversation_id = ? ORDER BY sequence DESC LIMIT 1',
      )
      .get(conversationId) as { round_id: string } | undefined;
    return row?.round_id ?? null;
  }

  saveRequestSnapshot(messageId: string, snapshot: ConversationRequestSnapshot): void {
    this.db.prepare('UPDATE conversation_messages SET request_snapshot = ? WHERE id = ?')
      .run(JSON.stringify(snapshot), messageId);
  }

  getRequestSnapshot(messageId: string): ConversationRequestSnapshot | null {
    const row = this.db.prepare('SELECT request_snapshot FROM conversation_messages WHERE id = ?')
      .get(messageId) as { request_snapshot: string | null } | undefined;
    return row?.request_snapshot ? JSON.parse(row.request_snapshot) as ConversationRequestSnapshot : null;
  }

  hasRunningMessages(): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE status = 'streaming'")
      .get() as { count: number };
    return row.count > 0;
  }

  markInterruptedMessages(): void {
    this.db
      .prepare(
        `UPDATE conversation_messages
         SET status = 'interrupted', error = 'interrupted by app exit'
         WHERE status = 'streaming'`,
      )
      .run();
  }

  saveCredential(id: string, value: string): void {
    this.db.prepare('INSERT INTO bot_credentials (id, encrypted_value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET encrypted_value = excluded.encrypted_value').run(id, value);
  }

  getCredential(id: string): string | null {
    const row = this.db.prepare('SELECT encrypted_value FROM bot_credentials WHERE id = ?').get(id) as { encrypted_value: string } | undefined;
    return row?.encrypted_value ?? null;
  }

  // --- 元数据（迁移完成标记等） --------------------------------------------

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM conversation_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO conversation_meta (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        role_prompt TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        role_prompt TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, bot_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        bot_id TEXT,
        bot_snapshot_name TEXT NOT NULL DEFAULT '',
        bot_snapshot_model TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'normal',
        quoted_message_id TEXT,
        created_at INTEGER NOT NULL,
        elapsed_ms INTEGER,
        error TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv
      ON conversation_messages(conversation_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_round
      ON conversation_messages(round_id);
    `);
    this.db.exec('CREATE TABLE IF NOT EXISTS bot_credentials (id TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL)');
    for (const table of ['conversation_bots', 'conversation_members']) {
      const fields = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!fields.some((field) => field.name === 'avatar')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN avatar TEXT NOT NULL DEFAULT ''`);
      }
      if (!fields.some((field) => field.name === 'connection_json')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN connection_json TEXT NOT NULL DEFAULT '{"kind":"legacy-api"}'`);
      }
    }
    // Additive local migration, applied when opening both existing and new databases.
    const columns = this.db.prepare('PRAGMA table_info(conversation_messages)').all() as { name: string }[];
    this.db.transaction(() => {
      if (!columns.some((column) => column.name === 'bot_snapshot_source')) {
        this.db.exec("ALTER TABLE conversation_messages ADD COLUMN bot_snapshot_source TEXT NOT NULL DEFAULT ''");
      }
      if (!columns.some((column) => column.name === 'sequence')) {
        this.db.exec('ALTER TABLE conversation_messages ADD COLUMN sequence INTEGER');
        this.db.exec('UPDATE conversation_messages SET sequence = rowid');
      }
      if (!columns.some((column) => column.name === 'request_snapshot')) {
        this.db.exec('ALTER TABLE conversation_messages ADD COLUMN request_snapshot TEXT');
      }
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_message_sequence ON conversation_messages(sequence)');
    })();
  }
}

function mapBot(row: BotRow): Bot {
  return {
    avatar: row.avatar,
    connection: JSON.parse(row.connection_json) as BotConnection,
    id: row.id,
    name: row.name,
    model: row.model,
    rolePrompt: row.role_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): ConversationMember {
  return {
    avatar: row.avatar,
    connection: JSON.parse(row.connection_json) as BotConnection,
    botId: row.bot_id,
    name: row.name,
    model: row.model,
    rolePrompt: row.role_prompt,
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    botSnapshotSource: row.bot_snapshot_source,
    id: row.id,
    conversationId: row.conversation_id,
    roundId: row.round_id,
    botId: row.bot_id,
    botSnapshotName: row.bot_snapshot_name,
    botSnapshotModel: row.bot_snapshot_model,
    role: row.role,
    content: row.content,
    status: row.status,
    messageType: row.message_type,
    ...(row.quoted_message_id ? { quotedMessageId: row.quoted_message_id } : {}),
    createdAt: row.created_at,
    ...(row.elapsed_ms !== null ? { elapsedMs: row.elapsed_ms } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
