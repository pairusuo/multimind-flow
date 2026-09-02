# MultiMind Flow 多 AI 任务编排评审稿

> 状态：评审稿  
> 日期：2026-07-14  
> 参考论文：Benedetta Donato 等，MultiMind: A Plug-in for the Implementation of Development Tasks Aided by AI Assistants，FSE Companion 2025

## 1. 背景

论文中的 MultiMind 是一个 VS Code 插件框架，目标是降低在 IDE 中实现 AI 辅助开发任务的成本。它不是多 AI 分屏浏览器，而是把一次 AI 辅助任务拆成可组合的架构层：

- Action：用户在界面中触发的操作。
- Task Manager：负责编排多个任务，可以并行、串行或迭代执行。
- Task：一个具体 AI 辅助任务，通常由 prompt、上下文和目标输出组成。
- Driver Manager：统一管理不同 AI Driver，负责模型选择、请求分发和结果聚合。
- Driver：连接具体 AI 助手或外部 API，处理认证、请求格式、响应转换等细节。

这篇论文对 MultiMind Flow 的核心启发是：多 AI 产品的长期价值不在“同时打开多个 AI”，而在“把多个 AI 组织成可复用、可观察、可沉淀的任务流程”。

## 2. 当前项目状态

MultiMind Flow 当前已有的基础能力与论文中的组件有天然对应关系：

| 论文概念 | MultiMind Flow 当前对应物 | 当前成熟度 |
|---|---|---|
| Action | 底部统一发送、转发入口、总结入口 | 已有雏形 |
| Task Manager | 暂无显式抽象，主要由用户手动转发驱动 | 缺失 |
| Task | 转发 prompt、总结 prompt、统一输入 prompt | 隐式存在 |
| Driver Manager | `WindowManager` 调度格子和适配器 | 部分承担，但边界较重 |
| Driver | 各站点 `SiteAdapter` | 已有写入适配器，读取能力逐站补齐 |
| Result View | 分屏网页本身，少量 notice | 缺少统一比较与沉淀视图 |

第一阶段已经解决了“多 AI 同屏”和“统一发送”。第二阶段正在解决“交叉验证”和“讨论沉淀”，并且已经明确使用 `CellTimeline` 作为上下文主来源，避免完全依赖各网站 DOM 完整读取。这个方向与论文中的任务编排模型兼容。

当前主要缺口是：系统还没有把“用户想完成什么任务”建模为独立对象。转发、总结、比较仍是零散动作，尚未形成可复用工作流。

## 3. 产品判断

MultiMind Flow 不应简单照搬 IDE 插件形态。论文中的 VS Code 插件依赖 API Driver 和 IDE 上下文，而 MultiMind Flow 的核心差异是：

- 用户使用自己的 AI 官网账号，不强制 API Key。
- 核心载体是 `WebContentsView` 格子，而不是 IDE 编辑器。
- 交互更偏讨论、评审、沉淀，不只是代码补全或单次生成。
- 站点适配器需要处理真实网页输入、提交、读取、完成判断，工程不确定性更高。

因此，适合 MultiMind Flow 的落地方式不是“后端多 Agent 平台”，而是在现有分屏浏览器之上增加一层轻量任务编排：

1. 用户仍能自由分屏聊天。
2. 常见高价值流程被封装为任务模板。
3. 系统负责发送、等待、转发、收集、总结的状态编排。
4. 用户保留关键判断权，例如选择来源、选择总结者、确认是否继续下一轮。

## 4. 建议新增的核心抽象

### 4.1 Task Template

任务模板定义一次多 AI 协作的目标、参与格子、执行策略和输出形态。

```typescript
interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  inputMode: "user-input" | "selected-cell-context" | "all-active-context";
  strategy: "first-response" | "all-responses" | "sequential" | "iterative";
  steps: TaskStep[];
  output: "compare" | "review" | "markdown" | "none";
}
```

首批不需要开放复杂编辑器，可以先内置模板。

### 4.2 Task Step

任务步骤描述一次可执行动作。

```typescript
type TaskStep =
  | { type: "send"; target: "active-cells" | string[] }
  | { type: "wait-for-responses"; target: string[]; timeoutMs: number }
  | { type: "forward"; from: string; to: string; promptKind: "review" | "fact-check" | "summarize" }
  | { type: "collect"; target: string[] }
  | { type: "synthesize"; target: string; source: string[] };
```

这只是产品层评审模型，实际实现时应继续遵守现有边界：具体站点输入、读取和完成判断仍放在各自 adapter 内，不能把站点分支写回 `WindowManager`。

### 4.3 Task Run

任务运行实例用于记录一次任务的状态。

```typescript
interface TaskRun {
  id: string;
  templateId: string;
  status: "idle" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  startedAt: number;
  completedAt?: number;
  cellStatuses: Record<string, TaskCellStatus>;
  stepRuns: TaskStepRun[];
  notices: string[];
}
```

`TaskStepRun` 至少需要记录步骤类型、目标格子、开始/结束时间、状态和可安全展示的
错误摘要。它的作用不是保存 prompt 副本，而是让系统和用户都能回答：

- 当前任务正在等待哪个格子或模型？
- 哪些目标已完成、失败或超时？
- 取消操作是否已经停止后续步骤？
- 重试应该只重跑失败目标，还是会重复发送给已完成目标？

短期可以只在内存中维护运行状态。需要跨重启保留时，也只持久化任务摘要、
成果物关联和不含敏感正文的诊断元数据，不默认保存完整 prompt 和原始回答。

### 4.4 Discussion Artifact

任务运行状态和最终成果不是同一种数据。任务完成后产生的 Markdown 初稿应成为
轻量成果物，而不是直接写入长期记忆，也不应该只存在于某个网页格子的 DOM 中。

```typescript
interface DiscussionArtifact {
  id: string;
  taskRunId: string;
  title: string;
  format: "markdown";
  status: "draft" | "confirmed" | "superseded";
  version: number;
  content: string;
  sourceCellIds: string[];
  sourceModels?: string[];
  createdAt: number;
  updatedAt: number;
}
```

第一版只支持 Markdown，并保持以下边界：

- `CellTimeline` 保存纯讨论内容。
- `TaskRun` 保存执行状态和步骤结果。
- `DiscussionArtifact` 保存可查看、修订和导出的成果版本。
- 长期记忆只接收用户确认后的稳定成果，不接收未审阅草稿和完整运行日志。
- 新版本通过新增版本或标记旧版本为 `superseded` 处理，不静默覆盖已确认内容。

这不是通用文件管理器。现阶段不扩展到 HTML、CSV、演示文稿、附件索引或任意
二进制格式。

## 5. 首批可落地任务

### 5.1 多 AI 比较

目标：用户输入一个问题，多个活跃 AI 并行回答，系统等待全部或部分完成后生成比较视图。

执行策略：

1. 向所有活跃聊天格子并发发送用户输入。
2. 等待各格子回答完成，失败或超时的格子单独标记。
3. 读取各格子最新回答。
4. 在 MultiMind Flow 自己的结果面板中展示答案摘要、共识、分歧和风险点。

价值：这是当前同步发送能力的自然升级，能减少用户肉眼扫四个网页的负担。

### 5.2 一个 AI 回答，另一个 AI 审查

目标：把某个源格子的完整上下文转发给目标格子，让目标 AI 评审最后一条回答。

执行策略：

1. 用户选择源格子和目标格子。
2. 系统从源格子 `CellTimeline` 构造纯对话上下文。
3. 最外层包裹一次评审任务说明。
4. 注入目标格子并触发发送。
5. 目标格子完成后，把评审结果写入目标格子时间线。

价值：这是现有转发功能的标准化版本，可以作为 Task Manager 的第一块实现。

### 5.3 生成 -> 审查 -> 修订

目标：让一个 AI 生成方案，另一个 AI 审查，如果审查发现问题，再把审查意见发回原 AI 修订。

执行策略：

1. A 生成初稿。
2. B 审查 A 的初稿。
3. 如果用户确认需要修订，系统把 B 的审查意见和 A 的初稿发回 A。
4. 最多执行 N 轮，默认 1 轮，避免自动循环失控。

价值：对应论文中的“生成 AI + 验证 AI + 迭代重试”模式，但 MultiMind Flow 应保留用户确认点，不直接自动无限循环。

### 5.4 多 AI 总结成 Markdown

目标：从所有活跃格子的时间线和最新回答中生成一份结构化 Markdown 文档。

执行策略：

1. 收集活跃格子的 `CellTimeline`。
2. 清洗引用编号、重复任务说明、站点噪声。
3. 若超长则裁切，并同时进入 prompt 和界面 notice。
4. 发送给用户指定的总结者格子。
5. 用户复制或保存总结者输出；长期记忆阶段再接入本地数据库。

价值：直接服务第二阶段“讨论 -> 文档沉淀”。

## 6. UI 建议

### 6.1 任务入口

底部输入框旁增加一个轻量任务入口，首批可命名为“工作流”或“任务”。

内置选项：

- 普通发送
- 多 AI 比较
- 让其它 AI 审查
- 总结成 Markdown

默认仍保持普通发送，避免改变用户现有使用习惯。

### 6.2 任务状态面板

新增一个可收起的任务状态面板，展示：

- 当前任务名称。
- 参与格子数量。
- 每个格子的状态：未发送、已发送、生成中、完成、失败、超时。
- 可执行动作：取消、重试失败格子、继续下一步、生成总结。

这能解决多 AI 编排中最容易让用户困惑的问题：不知道系统正在等谁，也不知道失败发生在哪个格子。

### 6.3 结果比较视图

保留分屏网页作为原始上下文，同时增加 MultiMind Flow 自己的比较视图：

- 每个 AI 的答案摘要。
- 共识点。
- 分歧点。
- 明确风险和待核查事实。
- 一键转发给某个 AI 继续评审。
- 一键发送给总结者生成 Markdown。

结果比较视图不需要第一版就自动做到高质量总结。第一版可以先把各 AI 的最新回答并列、提供人工选择和转发入口。

## 7. 与现有架构的关系

### 7.1 不建议重构掉现有适配器

现有 `SiteAdapter` 是 MultiMind Flow 的关键资产。任务编排层应调用现有能力，而不是替换它：

- `injectScript` 继续负责写入。
- `readyCheckScript` 继续负责就绪判断。
- `extractLatestResponse` 继续负责最新回答读取。
- `isResponseComplete` 继续负责完成判断。
- `extractConversation` 继续作为 DOM 增量检测补充。

### 7.2 `WindowManager` 不应继续膨胀

当前 `WindowManager` 已经承担窗口、视图、格子状态、注入调度等职责。任务编排建议新增独立模块，例如：

```text
src/main/taskOrchestrator.ts
src/main/taskTemplates.ts
src/shared/taskTypes.ts
```

`WindowManager` 只暴露必要能力：

- 获取活跃格子。
- 向格子发送文本。
- 等待格子回答完成。
- 读取格子最新回答。
- 获取格子完整上下文。
- 发送 notice。

任务逻辑不要写成 `if Claude / if ChatGPT / if DeepSeek`，站点差异仍由 adapter 处理。

### 7.3 时间线仍是第二阶段核心

任务编排必须以 `CellTimeline` 为主要上下文来源。原因：

- 转发链路中，应用已经掌握的上下文不应因为某个站点缺少完整 DOM 读取而丢失。
- 多跳转发时，时间线能避免重复包裹任务说明。
- 总结成 Markdown 时，时间线比网页 DOM 更可控。

DOM 读取只用于补充检测用户在网页内的手动追问。

### 7.4 运行状态、成果物与记忆必须分层

三类数据生命周期不同，不能共用一个大对象或一张表：

| 数据层 | 保存内容 | 默认生命周期 |
|---|---|---|
| `TaskRun` | 步骤状态、目标状态、耗时、错误摘要 | 当前任务；按需保留摘要 |
| `CellTimeline` | 用户与 AI 的纯对话内容 | 当前讨论会话 |
| `DiscussionArtifact` | Markdown 草稿、版本、来源关联 | 保留到用户删除或替换 |
| Long-Term Memory | 用户确认的稳定知识 | 长期有效，可停用和恢复 |

成果物应保留最小来源信息，例如任务、参与格子或 API 模型、生成时间和版本；
不需要把完整任务 prompt 重复嵌入成果物。这样既能追溯结论来源，也避免将内部
编排指令和临时失败信息污染最终文档。

## 8. 风险与边界

### 8.1 自动化过强会制造低价值内容

项目现有设计已经明确：不自动遍历所有 AI 两两交叉验证。任务编排也应遵守这个原则。默认流程应该短、可解释、有用户确认点。

建议：

- 第一版不做全自动多轮 Agent。
- 生成 -> 审查 -> 修订默认只跑一轮。
- 多轮继续必须由用户显式点击。

### 8.2 站点读取能力不一致

不同 AI 网站 DOM 结构差异大，`extractConversation` 并不总可靠。任务编排必须能降级：

- 支持读取最新回答的站点可参与比较。
- 不支持完整对话读取的站点仍可使用应用时间线。
- 不支持读取最新回答的站点只能作为“打开网页让用户看”的参与者，不能承诺自动比较。

### 8.3 Prompt 污染风险

转发和任务模板要继续遵守当前规则：

- 给用户看的不确定性提示不能进入 prompt。
- 裁切提示必须同时进入 prompt 和界面 notice。
- 多跳转发时，任务说明只包裹最外层一次。
- 时间线里存纯对话内容，不存任务模板外壳。

### 8.4 名称冲突

论文产品也叫 MultiMind。它是学术原型和 VS Code 插件，MultiMind Flow 是桌面多 AI 工作台。后续对外传播时应尽量使用完整名称 MultiMind Flow，强调“Flow”与讨论沉淀、任务执行链路。

### 8.5 API 任务必须经过统一治理

由任务编排器发起的 API 步骤不能绕过敏感信息预检、预算检查和最小审计。具体
边界见 [API 对话治理方案](./api-conversation-governance-proposal.md)。嵌入式
网站不具备同等可观测性，任务状态面板不能把网站请求标记为“已审计”或展示虚构
的 token、费用数据。

## 9. 建议实施顺序

### 第一阶段：显式任务状态

目标：不改变现有功能语义，只把同步发送和转发的过程状态显性化。

交付：

- `TaskRun` 内存状态。
- 每个格子的任务状态展示。
- 失败、超时、完成的统一状态文案。

### 第二阶段：标准化转发任务

目标：把现有转发能力收敛成第一个 `TaskManager`。

交付：

- 源格子完整上下文构造。
- 目标格子评审 prompt 生成。
- 注入、等待、读取、notice 的统一流程。
- 转发结果进入时间线。

### 第三阶段：多 AI 比较视图

目标：把“多个 AI 回答”从网页分屏提升为可比较结果。

交付：

- 收集多个格子的最新回答。
- 并列展示。
- 用户选择主答案、转发审查、发送总结。

### 第四阶段：总结成 Markdown 工作流

目标：服务第二阶段最终产品价值。

交付：

- 从多个格子时间线构造总结上下文。
- 指定总结者。
- 生成结构化 Markdown。
- 生成可预览、修订和确认的轻量成果物。

### 第五阶段：成果物确认与记忆衔接

目标：闭合“讨论 -> 文档 -> 长期记忆”的产品链路。

交付：

- Markdown 成果物版本和来源元数据。
- 用户确认、导出和生成新版本。
- 将已确认成果物送入现有记忆候选/导入流程。
- 不自动把未审阅总结写入长期记忆。

## 10. 评审问题

1. 第一版任务入口是否应该叫“任务”“工作流”还是“讨论模板”？
2. 多 AI 比较视图是否需要第一版就自动生成共识/分歧，还是先做并列展示？
3. 生成 -> 审查 -> 修订是否应该默认自动回发修订，还是必须用户确认？
4. 任务状态是否只在当前窗口内存存在，还是需要写入本地存储以便重启恢复？
5. 结果比较视图是作为底部抽屉、右侧面板，还是独立页面？
6. 第三阶段终端接入后，AI 讨论结果是否允许形成“待执行命令草稿”，以及确认边界放在哪里？
7. 任务运行摘要需要保留多久，哪些诊断字段可以持久化而不暴露对话正文？
8. 成果物修改采用应用内轻量编辑，还是先以预览、复制、导出和重新生成版本为主？

## 11. 结论

这篇论文对 MultiMind Flow 的最大价值，是提供了一个清晰的产品架构方向：从“多 AI 并排回答”走向“多 AI 任务编排”。

MultiMind Flow 当前不缺更多站点清单，真正需要补的是任务层：

- 把用户意图建模为任务。
- 把多个 AI 的协作方式建模为流程。
- 把每个格子的执行状态可视化。
- 把多 AI 输出收敛成比较视图和有版本、可确认的 Markdown 成果物。
- 只把用户确认后的稳定成果送入长期记忆。

建议先以“标准化转发任务”和“多 AI 比较视图”为最小落地点。这样既能复用当前已经完成的同步发送、站点适配器和时间线系统，又能明显提升第二阶段“讨论 -> 文档沉淀”的产品完成度。
