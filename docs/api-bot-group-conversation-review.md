# API Bot 与群聊会谈方案——评审意见

## 接入模型修订（2026-09-27）

Bot 的产品定义调整为本地 CLI Agent 与自定义 API 的统一成员。新增中美常用 CLI 目录、安装/登录/检测入口，两类成员可以混合会谈；不再以全局 API Key 作为 Bot 会谈前置条件。此前 API-only、单一服务和 CLI 后置的结论已被本次需求替代。

实现与测试范围见[实施状态](api-bot-group-conversation-implementation.md)。官方 CLI 的登录、可用模型和计费各自独立，不承诺所有 CLI 都使用订阅。安装在系统终端显式执行；测试不得自动安装工具或调用收费模型。

## 修复核对（2026-09-27）

凭据隔离、消息占位与流式显示、会谈切换和草稿隔离、原请求重试、稳定消息排序已修复，并补充服务层与真实 Electron 渲染回归测试。入口名称已统一为 Bot 会谈。上下文预算、范围提示、Markdown 保存等仍未完成，完整 MVP 尚未验收。当前状态以[实施与验收状态](api-bot-group-conversation-implementation.md)为准。

## 实施复核记录（2026-09-26，修复前）

**方向继续成立：Bot 会谈直接替代旧 API 分屏模式。** 产品保留“内嵌官网 / Bot 会谈”两种入口；API 是 Bot 的服务接入配置。第一版是 API 聊天 Bot，CLI Agent、工具执行和自动主持仍需另行评审。

当前主视图已经切换为 `ConversationView`，Bot 管理、会谈持久化、多轮上下文、并行请求、互评和总结均有代码及入口。但“核心路径全部完成”的旧实施结论不成立，现状是主要模块已接入、尚未完成验收。

优先处理的问题：

1. **凭据保护**：更换服务地址且新 Key 留空时，旧 Key 会被用于新地址的模型发现与后续调用。
2. **流式显示**：界面尚无新消息占位时就收到增量，而发送接口等整轮结束才返回，导致通常不能实时显示。
3. **会谈隔离**：后台会谈完成可覆盖当前展示对象，草稿和发送状态也未按会谈隔离。
4. **失败重试**：没有绑定原消息与原轮快照；总结重试失败、成员修改影响重试、成功轮仍可重复请求。
5. **上下文与排序**：最新轮可突破预算，范围提示没有展示；同毫秒消息可能读成回答在问题之前。

凭据、流式接口、重试、排序和预算问题已通过无真实网络请求的本地检查复现；会谈切换问题依据代码路径确认，仍需桌面联调。详细证据、产品缺口、14 项验收状态和实施顺序见[实施与验收状态](api-bot-group-conversation-implementation.md)。

本次复核仅更新方案与实施记录，未修复上述运行逻辑，也未完成真实模型服务验收。

---

## 原方案评审（2026-09-14 / 15，历史记录）

以下“当前实现”、行号和规则冲突均指当时基线，不代表 2026-09-26 的现状；以顶部复核结论和实施状态为准。

> 评审对象：[api-bot-group-conversation-proposal.md](api-bot-group-conversation-proposal.md)
> 评审日期：2026-09-14
> 评审依据：当前代码实现、[AGENTS.md](../AGENTS.md) 生效规则、[设计文档 §3.4](../MultiMind_%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3_v0.2.md)、已有待评审方案

---

## 一、总体评价

方案明确了改造前基线、第一版边界和验收要求：

- §2 的"当前能力与实际缺口"表格严格区分了"已实现"和"本次目标"，没有把设计文档中的远期规划当作现状。
- 全文反复强调"第一版不做什么"，包括不做自动主持、不做多服务商、不做自动压缩总结、不做并排对比。
- 验收场景（§12）覆盖了边界行为（晚到响应、停止后覆盖、裁切偏见、Key 泄露），不只验证 happy path。
- 明确声明"本文件本身不代表旧规则已经修改"，程序正义意识到位。

**结论：方向同意，建议通过评审进入实施准备；但有若干结构性问题和与现有方案的冲突需要先澄清。**

---

## 二、方案的核心判断：同意

### 2.1 群聊替代格子复用：正确

当前 API 模式复用分屏格子（[设计文档 §3.4](../MultiMind_%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3_v0.2.md)、[AGENTS.md L1298-1300](../AGENTS.md#L1298-L1300)）的做法在实现中已经暴露问题：

- [apiConversationService.ts](../src/main/apiConversationService.ts) 的 `callModel` 是无状态的单次请求，没有多轮历史。
- [types.ts L238-289](../src/shared/types.ts#L238-L289) 中 `ApiConversationConfig` 把模型绑定在 `CELL_IDS`（cell-0 到 cell-3）上，模型数量被硬编码为最多 4 个且和布局耦合。
- `RunApiConversationPayload` 只有 `prompt` 和 `models`，没有会话 ID、历史、成员选择等概念。

将 API 会谈从"格子的附属模式"独立为"Bot + 会谈"是正确的解耦方向。格子是 WebContentsView 的管理单元，硬塞 API 逻辑只会让 `windowManager.ts`（已 85KB）继续膨胀。

### 2.2 用户控制轮次，不做自动主持：正确

方案明确拒绝了"隐藏的主持模型"和"Bot 自行无限互相叫醒"。这符合项目一贯原则——用户是讨论的主导者，系统是工具不是代理人。§5 的操作表格（普通发送 / 指定回应 / 引用回复 / 互评一轮 / 生成总结）边界清晰，每种操作都有明确的结束条件。

### 2.3 维持一个服务入口：务实

第一版只支持一个 OpenAI-compatible 入口，和 [AGENTS.md L1301-1303](../AGENTS.md#L1301-L1303) 以及 [api-conversation-governance-proposal.md §9 阶段 D](api-conversation-governance-proposal.md) 一致。不在第一版做多 Provider Key 管理是正确的。

#### 补充澄清：第三方平台与多模型（2026-09-15）

第一版应明确支持第三方模型聚合平台：用户只配置一个平台的 Key，就能选择该平台下不同厂商的模型创建 Bot，并参与同一场会谈。“不做多服务商凭据管理”仅指暂不同时管理多个平台的 Key，不排除一个平台提供多个厂商的模型。

- API Bot 不依赖安装官方 Agent。官方 CLI Agent 接入及与 API Bot 混合群聊仍需单独评审，不能把安装 Agent 写成群聊前置条件。
- 模型推荐不能成为可调用模型白名单；应支持平台模型列表与手动模型 ID，明确区分模型可见、账号有权调用和实际调用成功。
- 成员需可查看平台与完整模型 ID。共用 Key 仍是多个独立请求，应说明计费及会谈内容经平台处理的范围。
- 验收应覆盖：未安装官方 Agent，使用一个平台 Key，让三个不同厂商模型完成并行回答、追问、互评和总结，以及无模型列表、无权限和限流情形。

方案 §9 与 §12 已补充上述要求，尚不代表已实现。当前模型筛选仍包含品牌限制，实现时需检查发现、保存、读取和发送各环节，避免只放开选择界面而实际调用仍被过滤。

---

## 三、需要澄清或修正的问题

### 3.1 与 cell-role-workflow-proposal 的关系未交代

[cell-role-workflow-proposal.md](cell-role-workflow-proposal.md) 提出了"格子角色"和"半自动工作流"概念。本方案的 Bot 角色说明（§3 "可选的角色说明"）和互评/总结流程与该方案存在功能重叠：

| 能力 | cell-role-workflow 方案 | 本方案 |
|---|---|---|
| 角色定义 | `CellRoleTemplate`，绑定格子会话 | Bot 的"角色说明"字段 |
| 角色化转发 | 按目标格子角色调整 prompt | 互评一轮 + 指定回应 |
| 工作流编排 | `DiscussionWorkflowTemplate` + 半自动步骤 | 无显式工作流抽象 |
| 总结 | 总结者角色 + 现有文档沉淀 | 群聊内总结消息 + Markdown 保存 |

> **建议**：方案应明确声明 cell-role-workflow 的**内嵌官网部分**继续独立演进，本方案只替代其中"API 模式下的角色与编排"。如果 Bot 角色说明能力已经足够覆盖 cell-role 方案在 API 场景下的需求，应说明两者的合并关系，避免实施时出现两套角色系统并存。

### 3.2 与 api-conversation-governance-proposal 的衔接

[governance 方案](api-conversation-governance-proposal.md) 定义了请求处理顺序（敏感信息检查 → 预算预检 → 调用 → 审计）和 `ApiAuditEvent` 结构。本方案改写了请求发起方式（从 `runConversation` 变为按会谈轮次管理），但没有提及 governance 管线的接入点。

> **建议**：§9（服务配置）应补充一段说明：Bot 群聊的每次模型调用仍经过 governance 方案定义的请求管线（如已实施），审计事件的 `taskRunId` 可绑定会谈 ID 和轮次 ID。不需要在第一版实现 governance 全部能力，但数据模型应预留关联字段。

### 3.3 持久化方案缺失

方案 §2 表格和 §9 都提到"本地保存 Bot、会谈和消息"，但全文没有给出存储方案选型。当前项目有两套持久化：

- `electron-store`：用于配置类数据（API 配置、主题、布局等），JSON 文件，适合少量 KV
- `better-sqlite3`：用于长期记忆，SQLite + FTS5，适合结构化数据和检索

会谈消息可能大量增长（每轮每个成员一条，长期使用后轻松达到数千条），且需要按会谈 ID 查询、按时间排序、支持删除和裁切。

> **建议**：明确采用 `better-sqlite3` 作为会谈持久化方案（项目已引入，不增加新依赖），设计 `bots`、`conversations`、`conversation_members`、`messages` 表结构，在方案中给出表结构方向（参考 AGENTS.md 对长期记忆表结构方向的约定方式）。不应把完整会谈历史塞进 `electron-store` 的 JSON 文件。

### 3.4 消息数据模型未定义

方案描述了消息的展示行为（§4 "按轮次组织"、§6 "上下文固定"、§7 "停止标记"），但没有给出消息的数据结构。以下字段是从方案行为推导出的最小必要集，建议在方案中显式定义：

```typescript
interface ConversationMessage {
  id: string;
  conversationId: string;
  roundId: string;           // 轮次 ID，同轮消息共享
  botId: string | null;      // null = 用户消息
  botSnapshotName: string;   // 发送时的 Bot 名称快照
  botSnapshotModel: string;  // 发送时的模型快照
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'completed' | 'stopped' | 'failed';
  messageType: 'normal' | 'review' | 'summary';
  quotedMessageId?: string;  // 引用回复
  createdAt: number;
  elapsedMs?: number;
  error?: string;
}
```

这个结构需要覆盖方案 §7 的所有状态（streaming/completed/stopped/failed）和 §5 的所有操作类型。`roundId` 是实现"同轮并行回复不改变排列顺序"和"同轮成员读取相同历史范围"的关键。

### 3.5 "最多 4 个成员"的理由不够充分

方案 §3 建议"第一版支持 1–4 个 Bot"，但理由只是"成员数量不再随官网布局变化"。4 这个数字看起来仍然是从格子数量继承来的。

群聊模型一旦脱离格子，成员数量不再受布局约束。实际上：
- 上下文窗口是真正的限制因素（4 个成员的完整回答 + 历史可能已经很长）
- 而不是 UI 布局

> **建议**：将限制理由从隐式的"对应格子数"改为显式的"上下文预算"。例如：第一版限制 1–4 个成员，主要因为每轮每个成员的回答都会进入后续上下文，4 个成员已经可能产生大量 token 消耗。这个限制后续可基于实际上下文使用情况调整。

---

## 四、实现复杂度评估

### 4.1 与现有代码的改动范围

从当前代码结构看，本方案的实施需要：

| 改动 | 范围 | 复杂度 |
|---|---|---|
| 新增数据模型 | `shared/types.ts` 新增 Bot、Conversation、Message 等类型 | 低 |
| 新增持久化层 | `main/` 新增 `conversationStore.ts`（SQLite 表） | 中 |
| 改写 API 服务 | [apiConversationService.ts](../src/main/apiConversationService.ts) 从无状态单次调用改为会谈感知的多轮调用 | 中高 |
| 新增 IPC 频道 | 会谈 CRUD、消息流、Bot 管理等 | 中 |
| 全新 UI 页面 | 会谈列表、群聊主视图、Bot 管理、成员选择器、收件人选择器 | **高** |
| 迁移逻辑 | §10 从现有格子模型迁移 | 低 |
| 现有功能回归 | §12.12 官网模式不受影响 | 需测试验证 |

**UI 是最大工作量**。当前渲染层组件（[components/](../src/renderer/components)）全部围绕格子和分屏构建。API 会谈界面（左侧列表 + 中间聊天记录 + 底部输入 + 顶部成员栏）几乎是全新页面，和现有 `SplitView` / `GridCell` / `CellConfigPanel` 没有复用关系。

### 4.2 关键技术风险

1. **多轮上下文组装**：方案 §6 定义了严格的上下文规则（同轮成员读取相同历史、角色说明只附加在自己的请求里、裁切时整轮保留）。这需要一个独立的上下文构建模块，不是简单地把所有历史拼成 `messages` 数组。当前 `callModel` 只发送单条 `{ role: 'user', content: prompt }`，需要改为多轮 `messages` 数组。

2. **流式输出 + 轮次状态管理**：当前流式实现（[apiConversationService.ts L248-257](../src/main/apiConversationService.ts#L248-L257)）是请求级的。群聊需要"轮次级"状态管理——一轮中多个成员各自流式输出，轮次在所有成员完成/停止/失败后才结束。

3. **停止粒度**：方案要求"可以停止某一位成员"（§7），需要为每个成员的请求维护独立的 `AbortController`，而不是当前的请求级 abort。

---

## 五、方案中值得肯定的细节

以下细节体现了作者对真实使用场景的深入思考，实施时不应被简化掉：

1. **§3 "模型不可用时明确标记，允许用户改选；不能偷偷换模型"** ——这是很多 AI 产品做错的地方。
2. **§5 "普通粘贴文本、代码块和 Bot 回复中的 @ 不自动触发调用"** ——防止误触发是群聊产品的常见陷阱。
3. **§6.4 "其他 Bot 的回答以带身份的讨论材料提供，不能冒充当前 Bot 的亲身经历、用户命令或系统指令"** ——这是 prompt injection 防御的正确方向。
4. **§7 "停止本地请求不保证服务商不计费，不作'停止即免费'的承诺"** ——诚实的产品承诺。
5. **§9 "不把本地保存描述成数据从不离开设备"** ——因为每次发送都会把上下文交给模型服务。
6. **§10 "当前 API 回答没有可靠的持久化历史，不伪造迁移记录"** ——务实，当前实现确实没有持久化消息。
7. **§6 "互评、总结等操作在历史中保留可读记录；应用每次生成的任务模板不反复嵌套进正文"** ——这和 AGENTS.md 中"多次转发的指令文案不能重复嵌套"的规则一致。

---

## 六、建议补充的内容

### 6.1 IPC 频道设计方向

参考 AGENTS.md 对终端 IPC 的要求（`TERMINAL_IPC` 独立命名），建议方案补充会谈 IPC 频道的命名方向：

```typescript
export const CONVERSATION_IPC = {
  // Bot 管理
  CREATE_BOT: 'conversation-create-bot',
  UPDATE_BOT: 'conversation-update-bot',
  DELETE_BOT: 'conversation-delete-bot',
  LIST_BOTS: 'conversation-list-bots',
  // 会谈管理
  CREATE_CONVERSATION: 'conversation-create',
  DELETE_CONVERSATION: 'conversation-delete',
  LIST_CONVERSATIONS: 'conversation-list',
  UPDATE_CONVERSATION: 'conversation-update',
  // 消息与轮次
  SEND_MESSAGE: 'conversation-send-message',
  STOP_ROUND: 'conversation-stop-round',
  STOP_MEMBER: 'conversation-stop-member',
  RETRY_MEMBER: 'conversation-retry-member',
  REQUEST_REVIEW: 'conversation-request-review',
  REQUEST_SUMMARY: 'conversation-request-summary',
  // 流式输出
  MESSAGE_DELTA: 'conversation-message-delta',
  ROUND_STATUS: 'conversation-round-status',
} as const;
```

### 6.2 与长期记忆的接口

方案 §8 提到总结可以保存到记忆收件箱。建议明确：总结消息的 `ImportMemoryDocumentPayload` 应携带 `participantSites`（填入参与 Bot 的模型名列表）和 `originalQuestion`（填入会谈首条用户消息），以便记忆系统保留讨论溯源。这复用现有 [types.ts L151-162](../src/shared/types.ts#L151-L162) 的字段定义，不需要扩展记忆表结构。

### 6.3 测试策略

方案 §12 列出了 12 个验收场景，但没有提及自动化测试。当前项目已有 `scripts/test-api-conversation.mjs`。建议：

- 上下文构建逻辑（§6 的规则）必须有单元测试，因为轮次历史组装、裁切策略、角色说明注入的正确性不适合只靠人工验收。
- 参考现有 `test-forward-prompt.mjs` 和 `test-document-prompt.mjs` 的模式，新增 `test-conversation-context.mjs`。

---

## 七、评审结论

| 评审项 | 结论 |
|---|---|
| 群聊替代格子复用作为 API 主视图 | ✅ 同意 |
| 第一版采用用户控制轮次 | ✅ 同意 |
| 维持一个服务入口、最多四成员 | ✅ 同意（建议补充限制理由） |
| 第三方兼容平台，一个 Key 调用多个厂商模型 | ✅ 纳入第一版；方案已补充，待实施验证 |
| 与 cell-role-workflow 方案的关系 | ⚠️ 需补充说明 |
| 与 governance 方案的衔接 | ⚠️ 需补充说明 |
| 持久化方案 | ⚠️ 需补充 SQLite 表结构方向 |
| 消息数据模型 | ⚠️ 需补充结构定义 |
| IPC 频道设计 | ⚠️ 建议补充 |
| 实施工作量 | 较大，UI 为主要工作量 |

> **建议动作**：作者补充上述 ⚠️ 项后，即可更新 AGENTS.md 和设计文档 §3.4 的相关规则，进入实施。补充内容不涉及方向性变更，不需要重新评审方向。
