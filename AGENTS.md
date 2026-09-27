# MultiMind Flow — AGENTS.md

> 本文件供 AI 编码 Agent（Codex CLI 等）读取。所有技术决策均以本文件为准。
>
> **v2 说明**：第一阶段 MVP（多 AI 分屏浏览器）已经完成并验收通过。本文件
> 已从开发过程记录精简为「当前生效的规则集」，移除了 Week 1-8 的过程性
> 任务清单和已经走完的 bug 修复叙述，只保留对后续开发仍有约束力的内容。
> 完整历史决策过程见 AGENTS_v1_archive.md（仅供追溯查阅，不再作为开发依据）。

---

## 项目描述

MultiMind Flow 是一个三阶段产品：

- **第一阶段（已完成）**：多 AI 分屏浏览器。Electron 桌面应用，把窗口分割为
  1/2/3/4 个 WebView 格子，底部统一输入框同步发送到所有格子里的 AI 网站
  或搜索引擎。
- **第二阶段（开发中）**：讨论 → 文档沉淀。AI 互相查看彼此回答、交叉验证，
  用户指定一个 AI 汇总成 Markdown 结构化文档；当前实现边界是把总结指令
  发送给总结者 AI，由用户自行复制/保存 `.md` 文档。长期记忆基础能力
  已接入：授权目录收件箱、用户确认导入、本地 SQLite + FTS5 记忆库、
  停用/恢复、源文件缺失标记、记忆类型和 Agent 召回上下文生成。
- **第三阶段（远期）**：浏览器 + 终端 + Agent。内置真实终端（可运行用户
  已安装的 Codex CLI 等工具），内置 Agent 能力驱动代码生成或通用
  任务执行，用户自备 API Key。

产品设计的完整产品层描述见 `MultiMind_设计文档_v0.2.md`，本文件只关注
技术实现规则。

---

## 技术栈（锁定版本，不要擅自升级或替换）

```
electron          ^33.0.0
react             ^18.3.0
react-dom         ^18.3.0
typescript        ^5.5.0
tailwindcss       ^3.4.0
electron-store    ^10.0.0
electron-builder  ^25.0.0
vite              ^5.0.0
@vitejs/plugin-react ^4.0.0
```

第二阶段引入长期记忆系统时，新增：

```
better-sqlite3    （SQLite，含 FTS5 全文检索支持）
```

第三阶段引入内置终端时，新增（**第一个需要原生编译的依赖，见下方
「内置终端模块」章节的打包注意事项**）：

```
@homebridge/node-pty-prebuilt-multiarch    （PTY 进程管理，多平台预编译）
xterm.js                                    （终端渲染前端）
```

---

## 目录结构

```
multimind/
├── AGENTS.md
├── MultiMind_设计文档_v0.2.md
├── adapter-reference.md
├── package.json
├── tsconfig.json / tsconfig.main.json
├── vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── index.ts
│   │   ├── windowManager.ts    # 管理所有 WebContentsView 和标签页状态
│   │   ├── terminalManager.ts  # 管理所有终端 PTY 进程（第三阶段，独立于 windowManager）
│   │   ├── ipcHandlers.ts
│   │   ├── constants.ts        # UA 等构建时常量
│   │   └── adapters/           # 各 AI/搜索引擎网站的读写适配器
│   │       ├── index.ts
│   │       ├── claude.ts
│   │       ├── chatgpt.ts
│   │       ├── deepseek.ts
│   │       └── ...（按需扩展）
│   ├── renderer/                # React 渲染进程
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── Toolbar.tsx
│   │       ├── SplitView.tsx
│   │       ├── GridCell.tsx
│   │       ├── BottomInput.tsx
│   │       ├── CellConfigPanel.tsx
│   │       ├── CellNotice.tsx
│   │       └── TerminalPane.tsx # 终端面板渲染（xterm.js 容器，第三阶段）
│   └── shared/
│       ├── types.ts            # IPC 频道、CellState、LayoutMode 等共享类型
│       ├── presetSites.ts      # 内置 AI/搜索引擎清单
│       ├── presetTemplates.ts  # 内置布局模板
│       ├── riskySites.ts       # 已知风险网址清单（如 Gemini）
│       └── notices.ts          # 统一提示文案
└── dist/（构建输出，gitignore）
```

---

## 核心架构规则（不可违反）

### WebView 技术

- 必须使用 `WebContentsView`，禁止 `BrowserView`（已废弃）和 `<webview>` 标签
- 每个分屏格子对应一个 `WebContentsView` 实例，由 `windowManager.ts` 统一管理
  在 `Map<string, WebContentsView>` 中
- 每个格子使用独立 `partition: persist:cell-${cellId}`，保证登录状态隔离且持久化

### 进程通信

- 渲染进程只能通过 `window.electronAPI`（contextBridge 暴露）与主进程通信
- 禁止在渲染进程使用 `require('electron')` 或 `remote` 模块
- 禁止在主进程中直接操作 DOM

### 安全设置（BrowserWindow 和 WebContentsView 创建时固定配置）

```typescript
// BrowserWindow
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(__dirname, 'preload.js'),
}

// 每个格子的 WebContentsView
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  partition: `persist:cell-${cellId}`,
}
```

### 健壮性：销毁状态检查（崩溃修复后确立的规则）

`WindowManager` 所有对外方法和所有事件回调内部，第一行必须检查窗口/视图
是否已被销毁，避免应用退出时的竞态崩溃：

```typescript
someMethod(...) {
  if (this.window.isDestroyed()) return;
}

view.webContents.on('did-navigate', (_, url) => {
  if (this.window.isDestroyed()) return;
});
```

主进程入口需要全局兜底（只记录日志，不弹窗、不退出）：

```typescript
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
```

### 发送按钮必须轮询等待可用，禁止固定延迟（通用规则，2026年6月提升）

> 这条规则已在 Claude、DeepSeek 两个站点独立踩坑后确认为通用问题，
> 不是单个站点的特例：发送按钮从"输入已填入"到"真正可点击触发发送"
> 之间存在不固定的延迟，用固定的 `setTimeout` 等待（如 300ms）会
> 在延迟更长时点击过早，导致"文本写入但没有真正发送"，上层编排逻辑
> 会误以为已发送、陷入等待新回答超时。

**新接入任何站点的写入适配器，必须遵循以下模式，不允许用固定延迟**：

```typescript
async function waitForEnabledButton(
  getBtn: () => HTMLButtonElement | null,
  timeout: number,
): Promise<HTMLButtonElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn = getBtn();
    if (btn && !btn.disabled) return btn;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// 点击后必须确认输入框已清空，确认发送真正生效，不能只确认"点击了按钮"
async function injectAndConfirm(
  input: HTMLElement,
  btn: HTMLButtonElement,
): Promise<boolean> {
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  return input.textContent?.trim() === "";
}
```

后续接入新站点（Claude/ChatGPT/DeepSeek/豆包之外的任何新站点）时，
这是写入适配器的标准开发模式，不要重新发明，也不要假设"先试试固定
延迟，能用就行"——已有三个站点的真实教训证明固定延迟不可靠。

### 文本已写入但未提交：必须区分"写入成功"和"发送成功"

部分站点会出现"文本已经稳定进入输入框，但点击/回车没有触发真正发送"
的情况。此时问题不在 URL 识别、登录态或输入写入，而在站点的提交事件
入口没有被命中。不要继续通过增加固定延迟或反复调整通用选择器来碰运气。

新站点排查顺序必须明确分层：

1. 确认站点命中正确的独立适配器。
2. 确认文本是否真实写入输入框。
3. 如果文本已写入但未发送，先尝试原生鼠标点击和原生 Enter。
4. 如果仍未发送，改为站点专用提交脚本，按该站点真实结构组合触发：
   `form.requestSubmit()` / `submit` 事件、发送控件的 DOM click、
   Pointer/Mouse 事件、Keyboard Enter 事件。
5. 每次提交后都必须确认"输入框清空"或"进入生成中/停止生成状态"，
   禁止只因为执行过 click/Enter 就返回成功。

智谱清言（`chatglm.cn`）已经验证过这种模式：可见输入写入成功，但通用
按钮选择、坐标点击、单独原生 Enter 都不足以稳定提交，最终需要站点专用
提交组合。因此后续每个 AI 站点仍必须维护自己的写入/提交适配器，不允许
把这类逻辑折回通用 AI DOM 适配器。

---

## 转发功能：信息流分层规则（2026年6月，重要修正）

> 这是一次重要的实现纠偏：转发功能上线测试后发现，"给用户看的提示"
> 和"发给目标 AI 的 prompt 内容"被混在了一起，没有清晰分开，导致
> 提示文案泄漏进了 AI 看到的文本里。以下规则必须严格遵守，任何新增
> 的转发相关文案，开发前先判断属于哪一类。

### 两条信息流必须严格分离

**第一类：发给目标 AI 的 prompt 内容**——只能包含真正需要 AI 理解的
讨论素材：原始问题、各方回答正文、明确要求 AI 完成的任务说明（如
"请评价这份回答"）。

**第二类：给用户看的界面提示**——通过 `SHOW_CELL_NOTICE` 统一提示
系统展示，**绝对不能拼进发给 AI 的 prompt 文本里**。包括：

- "可能未完整记录用户在网页内的手动追问"这类不确定性说明——这是
  说给操作 MultiMind Flow 的用户听的，目标 AI 不需要也不应该看到这句话，
  它对 AI 完成评价任务没有任何帮助，只会造成困惑
- 任何关于"应用内部如何获取这段上下文"的元信息

### 修正：不确定性提示移出 prompt，改为界面提示

之前实现里那句"提示：以下内容来自 MultiMind Flow 已记录的讨论；如果
用户曾在源网站页面内手动追加提问，且该网站暂不支持完整 DOM 增量
检测，可能未完整包含"——**这句话必须从 prompt 文本中删除**，改为
转发触发时，如果检测到目标场景符合"该站点不支持完整 DOM 提取"
的条件，通过 `SHOW_CELL_NOTICE` 在界面上提示用户，不要让目标 AI
看到这句话。

### 裁切提示是例外：prompt 和界面提示都需要

裁切（`conversation-truncated`）这种情况不一样——"注意：原始对话
较长，已省略最早的部分"这句话**应该保留在 prompt 里**，因为这是
目标 AI 理解自己看到的是不是完整对话所必需的信息，删掉会让 AI
误以为看到的就是全部讨论脉络。但同时，裁切发生的事实也必须**同时**
通过 `SHOW_CELL_NOTICE` 告知发起转发的用户——这是两边都要保留的
情况，和上面的"不确定性提示"（只在界面、不进 prompt）正好相反，
开发时不要混淆这两类规则。

### 转发素材清洗：剔除引用编号等非内容元素

目标 AI 的回答中如果包含引用标记（如部分支持网络搜索的站点，会在
正文里插入①⑨⑩这类圆圈数字、或类似的角标编号，指向参考资料列表），
这些标记在被进一步转发给下一个 AI 时必须被清洗掉，不计入上下文。
清洗规则建议：识别并移除常见的圆圈数字字符（Unicode 范围
`\u2460-\u2473` 等）、以及类似的角标编号格式，在 `extractLatestResponse`
和 `extractConversation` 提取内容后统一做一次清洗，而不是在每个
转发点各自处理。

### 多次转发的指令文案不能重复嵌套

"下面是一段用户与其它 AI 的完整对话上下文"和"请先理解上面的完整
讨论脉络，再评价这个 AI 的回答"这类**任务说明文案**，本质是"这次
转发任务的框架性指令"，在整个转发链路中只应该出现一次（在最终
prompt 的开头和结尾各一次），不应该随着转发跳数增加而重复累积。

**根因排查方向**：如果当前实现是"每次转发都套一层完整模板再拼接
上一轮的完整 prompt"，会导致 A→B→C 这种多跳转发时，模板被嵌套
多层。正确做法是：任务说明文案只在最外层包裹一次，中间的多轮历史
内容（时间线拼接的部分）不应该带着上一次转发时包裹的任务说明文案，
时间线里存储的应该是纯粹的对话内容（"用户：xxx" / "AI：xxx"），
任务说明文案是渲染最终 prompt 时才在最外层加一次，不属于时间线
存储的内容本身。

### 布局模式

```typescript
export type LayoutMode =
  | "single"
  | "horizontal"
  | "vertical"
  | "triple"
  | "quad";
```

`triple` 布局：左侧一格占 50% 宽（上下贯穿），右侧两格各占 50% 宽 × 50% 高。

### 格子状态结构

```typescript
export type CellMode = 'chat' | 'search';

interface CellState {
  url: string;
  active: boolean;     // 是否参与统一发送
  mode: CellMode;
}

private cellStates: Map<string, CellState> = new Map();
```

**mode 的判定规则**：通过域名匹配 `PRESET_SITES` 自动判定，不要求用户手动
标注。只有当用户输入的 URL 在内置清单中完全找不到匹配时，才向用户展示
"这是搜索引擎"的手动选择开关：

```typescript
function inferModeFromUrl(url: string): CellMode | "unknown" {
  const matched = PRESET_SITES.find((site) => {
    try {
      return new URL(url).hostname.includes(new URL(site.url).hostname);
    } catch {
      return false;
    }
  });
  return matched ? matched.mode : "unknown";
}
```

### 内置网站清单（`shared/presetSites.ts`）

```typescript
export interface PresetSite {
  id: string;
  name: string;
  url: string;
  region: "international" | "china";
  mode: CellMode;
  searchUrlTemplate?: string;
}
```

当前清单：AI 助手（国际：Claude、ChatGPT、Grok、Perplexity、Copilot；
国内：DeepSeek、Kimi、文心一言、通义千问、豆包、智谱清言）+ 搜索引擎
（Google、Bing、DuckDuckGo、百度、搜狗）。

**Gemini 不在清单中**：仅支持 Google 账号登录，Google 全面禁止嵌入式
浏览器登录 Google 账号，无法绕过。用户仍可通过自定义 URL 手动添加，
此时会命中 `riskySites.ts` 中的风险提示。

### 格子配置面板（`CellConfigPanel.tsx`）交互规则

- 下拉框选项 = `PRESET_SITES` 全部条目（按分组显示）+ "自定义 URL"
- 下拉框默认选中项根据当前格子 URL 反推（域名匹配），不是固定显示"自定义 URL"
- 选择内置网站后，右侧文本框自动填入对应 URL 并立即生效
- 只有匹配不到任何内置网站时，才显示"这是搜索引擎"开关

### URL 持久化语义（产品决策，不要改动）

格子的 `url` 字段记录"最后一次实际停留的地址"，不是模板/预设的原始地址。
模板 URL 只在格子「从无到有创建」时生效一次。这是有意为之的浏览器标准
行为（类似 Chrome 重启恢复标签页），不是 bug。

---

## 内置终端模块（第三阶段，独立于格子系统）

### 核心架构原则：终端与浏览器格子是两套独立系统

终端管理的是 PTY 进程的生命周期，浏览器格子管理的是 `WebContentsView` 的
生命周期，两者底层无共享逻辑。**终端绝对不进入 `CellState` / `cellStates`
这套数据结构**，不要因为"终端也能出现在分屏网格里"而试图把两者合并。

### 网格位置的内容类型抽象

为了让终端可以出现在分屏网格的任意位置（同时和浏览器格子混排），引入一层
独立于 `CellState` 的抽象：

```typescript
export type PaneContent =
  | { type: 'cell'; cellId: string }
  | { type: 'terminal'; terminalId: string };

// 每个网格位置（'cell-0' | 'cell-1' | 'cell-2' | 'cell-3'，复用现有的
// 位置编号）绑定一个 PaneContent，而不是直接绑定一个 CellState
private paneAssignments: Map<string, PaneContent> = new Map();
```

`SplitView.tsx` 渲染每个网格位置时，先查 `paneAssignments` 判断这个位置
应该渲染浏览器格子还是终端，再分别调用对应的渲染逻辑和数据源
（`cellStates` 或 `terminalManager` 的状态）。布局网格的尺寸计算
（`LayoutMode` 对应的矩形划分）保持不变，不区分位置上放的是格子还是终端。

同一个布局里允许出现多个独立终端实例，四分屏可以全部放终端。每个终端
都有自己的 `terminalId`、PTY 进程、`cwd` 和标题；不要把“终端数量”绑定到
浏览器格子数量，也不要把多个终端做成共享同一个 PTY 的镜像视图。

### TerminalManager（主进程，独立于 WindowManager）

```typescript
interface TerminalState {
  id: string;
  cwd: string; // 当前工作目录
  title: string; // 显示标题（默认 shell 名称，用户可重命名）
}

class TerminalManager {
  private terminals: Map<string, IPty> = new Map(); // IPty 来自 node-pty

  createTerminal(cwd?: string): string {
    const id = generateId();
    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "bash";
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: cwd || process.env.HOME,
      env: process.env,
    });
    this.terminals.set(id, ptyProcess);
    return id;
  }

  write(id: string, data: string): void {
    this.terminals.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.terminals.get(id)?.resize(cols, rows);
  }

  destroy(id: string): void {
    this.terminals.get(id)?.kill();
    this.terminals.delete(id);
  }

  destroyAll(): void {
    // 应用退出时调用，避免残留子进程
    for (const id of this.terminals.keys()) this.destroy(id);
  }
}
```

应用退出时（`before-quit` 或 `window-all-closed`）必须调用
`terminalManager.destroyAll()`，避免 PTY 子进程成为孤儿进程残留在用户
系统里，这是终端模块特有的清理责任，浏览器格子（WebContentsView）不需要
这一步是因为它们随窗口销毁自动清理。

### IPC（终端专属频道，不复用浏览器格子的 IPC）

```typescript
export const TERMINAL_IPC = {
  CREATE: "terminal-create",
  WRITE: "terminal-write", // 渲染进程 → 主进程，用户输入
  DATA: "terminal-data", // 主进程 → 渲染进程，PTY 输出
  RESIZE: "terminal-resize",
  DESTROY: "terminal-destroy",
} as const;
```

终端的 IPC 频道独立命名（`TERMINAL_IPC` 而不是塞进现有的 `IPC`
常量对象），避免和浏览器格子的导航/状态广播频道混在一起。

### 渲染前端：xterm.js

`TerminalPane.tsx` 用 `xterm.js` 渲染终端界面，通过 IPC 把用户键盘输入
转发给主进程的 `TerminalManager.write()`，并监听 `TERMINAL_IPC.DATA`
把 PTY 输出写入 xterm 实例。窗口/网格尺寸变化时调用
`TERMINAL_IPC.RESIZE` 同步终端的行列数，否则会出现内容显示错乱。

### 底部输入对终端的广播语义

底部输入可以复用“统一输入”的界面位置，但 AI 发送和终端命令是两种不同
执行语义：

- AI 格子：发送的是 prompt，走站点适配器、时间线和 notice 机制
- 终端：发送的是命令文本，走 `TerminalManager.write(terminalId, data)`，
  不进入 AI 适配器、不写入 `CellTimeline`

第三阶段应支持一次把同一条命令广播到多个被选中的终端，例如四个不同项目
目录同时执行同一个安全漏洞修复命令。终端广播必须并发 fan-out 到所有目标
终端，不能逐个等待前一个命令执行完成；每个终端在自己的 `cwd` 中独立运行。

终端广播的交互要求：

- 只有被明确选中或激活参与广播的终端接收命令
- 发送按钮或状态文案必须显示目标数量，例如“发送到 4 个终端”
- 每个终端面板必须清楚显示当前 `cwd`，避免用户误把命令发到错误项目
- 广播时写入内容应自动补齐回车（如 `\r`），确保命令真正提交执行；单终端
  的直接键盘输入仍保持 xterm 原生交互

### 打包注意事项（原生模块，必须额外处理）

`node-pty` 是当前技术栈第一个需要原生编译的依赖，打包时必须注意：

1. **依赖选型**：使用 `@homebridge/node-pty-prebuilt-multiarch`，它为
   macOS（x64/arm64）、Windows、Linux 提供预编译二进制，安装时自动
   匹配当前平台，避免本机从源码编译（需要 Python + C++ 编译器，
   普通用户环境很可能没有）
2. **asar 解包**：`node-pty` 除了 `.node` 二进制本身，还包含一个独立的
   `spawn-helper` 可执行文件，打包成 `asar` 后这个 helper 的相对路径
   会失效。`electron-builder.yml` 中需要配置：
   ```yaml
   asarUnpack:
     - "**/node_modules/@homebridge/node-pty-prebuilt-multiarch/**"
   ```
3. **跨架构验证**：macOS Universal Binary 打包后，除了之前用 `lipo -info`
   验证主程序架构，还需要单独确认 `node-pty` 这个原生模块在 Intel 和
   Apple Silicon 上都能正常加载（不能假设和主程序的 Universal Binary
   是同一回事，原生依赖可能需要分别验证）
4. **首次接入预期**：这是新增的工程脆弱点，第一次让终端在三个平台的
   打包产物里都正常工作，大概率不会一次成功，需要预留排查时间，
   常见的失败现象是"开发环境能跑、打包后的产物里终端打不开"，遇到这种
   情况先检查 `asarUnpack` 配置和路径解析逻辑

### 当前阶段边界（有意收窄，不要在没有需求验证的情况下扩展）

- 不做"讨论结果自动传递给终端"这类跨模块数据打通，本阶段只做终端本身
  的接入和可用性
- 不做代码编辑器（语法高亮、文件树等），只做终端
- 终端默认收起还是常驻、多个终端是用标签还是直接占用多个网格位置，留待
  开发时按实际体验调整；但多个独立终端实例和多终端命令广播是已确认能力

---

## 统一发送机制

```typescript
async sendToAll(text: string): Promise<void> {
  const activeCells = [...this.cellStates.entries()].filter(
    ([, state]) => state.active && state.url
  );

  await Promise.all(activeCells.map(async ([cellId, state]) => {
    await delay(Math.random() * SEND_FAN_OUT_JITTER_MS);
    if (state.mode === 'search') {
      const site = findPresetSiteByUrl(state.url);
      const searchUrl = buildSearchUrl(site?.searchUrlTemplate, text);
      this.navigate(cellId, searchUrl);
    } else {
      const success = await this.injectScript(cellId, text);
      if (!success) {
        this.sendNotice(cellId, 'inject-failed');
      }
    }
  }));
}
```

- 空格子（`url` 为空）和未激活格子（`active: false`）自动跳过，不报错不提示
- `search` 模式直接 `navigate` 跳转，不走注入逻辑，不会触发 `inject-failed`
- `chat` 模式走 `injectScript`，失败时统一走提示系统
- 统一发送必须并发 fan-out 到所有活跃格子；禁止按格子顺序串行 `await`
  注入完成。单个站点注入确认慢、登录异常或提交失败，只能影响该格子自己的
  notice 和时间线，不能拖慢其它 AI 收到同一条用户输入
- 如需降低站点风控，只允许在每个并发任务内部加入小幅随机起跑抖动
  （例如 0-220ms）；不允许用 `for` 循环逐个等待发送完成

---

## 注入与读取适配器系统

### 写入适配器（第一阶段，已实现）

每个网站的注入逻辑封装为独立文件（`adapters/claude.ts` 等），接口：

```typescript
export interface SiteAdapter {
  urlPattern: RegExp;
  injectScript: (text: string) => string;
  readyCheckScript: string;
  nativeInjection?: SiteNativeInjection; // 需要 Electron 原生输入/点击时由站点自己声明
}

export function getAdapterForUrl(url: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.urlPattern.test(url)) ?? null;
}
```

找不到匹配适配器时返回 `null`，调用方据此返回 `false` 触发失败提示，
不抛异常导致主进程崩溃。

**适配器边界规则**：每个格子只根据当前 URL 命中一个站点适配器；格子本身
不绑定具体 AI。每个 AI 站点必须维护自己的独立适配器文件，站点专用的
输入框定位、发送按钮定位、原生点击、提交兜底、读取和完成判断都必须放在
对应 adapter 内。`windowManager.ts` 只负责按格子调度、执行 adapter 返回的
脚本和处理通用 WebContents 行为，禁止在 `WindowManager` 里写
`if Kimi / if 千问 / if 智谱` 这类具体 AI 分支，也禁止把多个 AI 折回
通用 AI DOM 适配器兜底。

注入前增加随机延迟（300-800ms），避免"加载完成立即填充提交"这种机械
时序（详见下方风控规避部分）。

具体每个网站的 DOM 结构、选择器策略由 `adapter-reference.md` 维护。

### 读取适配器（第二阶段，新增能力）

为支持「交叉验证」流程，需要新增读取能力：从 AI 网站的对话界面中提取
最新一条 AI 回答的文本内容，并判断该回答是否已生成完毕。

```typescript
export interface SiteAdapter {
  extractLatestResponse?: () => string;
  isResponseComplete?: () => string;
  extractConversation?: () => string; // 见下方「完整对话上下文提取」
}
```

每个网站判断"生成完毕"的方式不同（常见模式：发送按钮从禁用恢复可用、
停止生成按钮消失、流式光标停止闪烁），具体实现细节由
`adapter-reference.md` 维护，开发前先查阅该文档。

### 格子时间线与上下文合并（第二次设计修正，取代纯 DOM 读取方案）

> ⚠️ 设计修正（2026年6月，第二次）：上一版方案（"转发时调用
> `extractConversation` 重新读取源格子完整 DOM"）在多步转发场景下
> 暴露了缺陷——豆包→ChatGPT→DeepSeek 这种链式转发中，"ChatGPT"作为
> 中间环节的源格子时，如果 ChatGPT 站点还没实现 `extractConversation`，
> 会整体降级为"仅最新回答"，丢失了"用户最初问豆包的问题经转发后
> 传到 ChatGPT、ChatGPT 给出的回答"这一整段本来已经被应用完整掌握
> 的上下文。**根本问题**：纯粹依赖每次重新读取源站点 DOM，等于扔掉了
> 应用自己在转发过程中已经知道的信息，且要求每个站点都实现完整的
> DOM 历史解析，否则任意一处降级会让整条转发链路的上下文断裂。
>
> **正确方案**：应用为每个格子维护一份「时间线」（`CellTimeline`），
> 按时间顺序记录这个格子里发生过的所有消息，不管来源是底部统一输入框
> 发送、转发注入、还是用户直接在该格子对应网页里手动输入。转发时
> 优先使用这份应用内维护的时间线，`extractConversation`（DOM 读取）
> 只用于检测"自时间线最后一次更新以来，用户是否在网页里手动追加了
> 新内容"，作为补充检测手段，不再是获取上下文的主要方式。
>
> **产品要求（已与设计者确认）**：不管用户是通过底部统一输入框
> 提问，还是在某个格子的网页里直接手动提问，都属于该格子的上下文，
> 转发时都需要带上完整上下文。用户可能反复多次转发（A→B→C→A...），
> 每次转发都需要传递到当前为止的完整上下文，除非触发长度裁切。

**CellTimeline 数据结构**：

```typescript
interface TimelineEntry {
  role: 'user' | 'assistant';
  content: string;
  source: 'bottom-input' | 'forward-injection' | 'dom-detected';
  timestamp: number;
}

interface CellTimeline {
  cellId: string;
  entries: TimelineEntry[];
  lastDomSyncedEntryCount: number;  // 上次 DOM 核对时，DOM 里观察到的消息总条数
}

private cellTimelines: Map<string, CellTimeline> = new Map();
```

**写入时间线的时机**（应用主动触发的动作，直接追加，不依赖 DOM 确认）：

- 底部统一输入框发送成功后，向对应格子的时间线追加一条 `role: 'user', source: 'bottom-input'`
- 该格子生成回复并被 `isResponseComplete` 确认后，提取该回复追加一条
  `role: 'assistant', source: 'bottom-input'`（或 `forward-injection`，
  取决于是哪种方式触发的这轮回复）
- 转发注入目标格子时，向目标格子的时间线追加一条
  `role: 'user', source: 'forward-injection'`（内容是拼接后的转述
  prompt），目标格子生成回复后同理追加一条 assistant 记录

**获取某格子完整上下文的流程**（供转发时调用）：

```typescript
async function getCellFullContext(
  cellId: string,
): Promise<{ text: string; truncated: boolean }> {
  const timeline = cellTimelines.get(cellId) ?? createEmptyTimeline(cellId);

  // 1. 检测 DOM 里是否有时间线未记录的新增内容（用户手动在网页里追问）
  const domConversation = await extractConversationIfSupported(cellId);
  if (domConversation) {
    const domEntryCount = countEntries(domConversation);
    if (domEntryCount > timeline.lastDomSyncedEntryCount) {
      // 只追加增量部分，不是整段替换，避免重复
      const newEntries = parseNewEntries(
        domConversation,
        timeline.lastDomSyncedEntryCount,
      );
      timeline.entries.push(
        ...newEntries.map((e) => ({ ...e, source: "dom-detected" as const })),
      );
      timeline.lastDomSyncedEntryCount = domEntryCount;
    }
  }

  // 2. 按时间线拼接完整上下文文本
  const fullText = timeline.entries
    .map((e) => `${e.role === "user" ? "用户" : "AI"}：${e.content}`)
    .join("\n\n");

  // 3. 长度管理（裁切规则不变，见下方）
  return truncateConversation(fullText);
}
```

**站点尚未实现 `extractConversation` 时的处理**：`extractConversationIfSupported`
返回 `null`，跳过 DOM 增量检测这一步，**直接使用时间线里已有的记录**——
这是和上一版方案的关键区别：即使某个站点没有 DOM 完整提取能力，只要
这个格子的对话是通过 MultiMind Flow（底部输入或转发注入）发生的，应用

### 最终 prompt 组装：任务说明文案只包裹一次（重要，避免多跳转发重复）

`getCellFullContext` 返回的是纯粹的对话内容（不含任何任务说明文案）。
组装最终发给目标格子的 prompt 时，任务说明文案只在最外层包裹一次：

```typescript
// 任务说明文案跟随对话内容的语言，与界面语言（UI 国际化）无关
// 见下方「国际化」章节的说明
const FORWARD_PROMPT_TEXT = {
  zh: {
    intro: "下面是一段用户与另一个 AI 的完整对话上下文。",
    contextHeader: "# 对话上下文",
    evaluateHeader: "# 请你评价",
    evaluateInstruction:
      "请先理解上面的完整讨论脉络，再评价最后一条 AI 回答：有没有遗漏、错误、需要补充或反驳的地方？",
    truncateNotice:
      "注意：原始对话较长，已省略最早的部分，以下是保留的最近对话内容。\n\n",
  },
  en: {
    intro:
      "Below is the full conversation context between the user and another AI.",
    contextHeader: "# Conversation Context",
    evaluateHeader: "# Your Evaluation",
    evaluateInstruction:
      "Please understand the full discussion above before evaluating the last AI response: any omissions, errors, or points needing elaboration or rebuttal?",
    truncateNotice:
      "Note: the original conversation was long; earliest portions have been omitted. Below is the retained recent content.\n\n",
  },
};

function detectContentLanguage(text: string): "zh" | "en" {
  // 简单的字符占比判断即可，不需要引入完整的语言检测库，
  // 当前只需要区分中英文两种
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.15 ? "zh" : "en";
}

function buildForwardPrompt(fullContext: string, truncated: boolean): string {
  // 任务说明文案的语言，跟随这段对话内容本身使用的语言，
  // 不跟随当前界面语言设置
  const lang = detectContentLanguage(fullContext);
  const t = FORWARD_PROMPT_TEXT[lang];
  const truncateNotice = truncated ? t.truncateNotice : "";

  return [
    t.intro,
    "",
    truncateNotice + t.contextHeader,
    fullContext,
    "",
    t.evaluateHeader,
    t.evaluateInstruction,
  ].join("\n");
}
```

转发 prompt、语言判断、角色块解析和上下文裁切这类纯文本逻辑必须放在
`src/main/forwardPrompt.ts`，不要重新塞回 `windowManager.ts`。对应回归测试
放在 `scripts/test-forward-prompt.mjs`，通过 `npm run test:forward` 或
`npm test` 执行。新增或修改转发 prompt 文案、裁切策略、角色块格式时，必须
同步更新这条测试。

**关键点**：`fullContext`（即 `getCellFullContext` 的返回值）即使
经过了多跳转发积累（A→B→C 场景下，C 的时间线里包含了 A 的提问、
A的AI回答、转发给B时B的回答），这段拼接的内容里**绝不应该混入
之前转发时已经包裹过的"下面是一段用户与其它 AI 的完整对话上下文"
这类任务说明句**——这句话只在调用 `buildForwardPrompt` 这一次性的
最终组装时加一次，时间线（`TimelineEntry`）里存储的永远只是
`role: 'user' | 'assistant'` + 纯内容，不存储任务说明文案。如果
当前实现是把上一轮的完整 prompt（包含任务说明文案）整体作为下一轮
的某个 `TimelineEntry.content` 存了进去，这就是重复的根因，需要
改为：写入时间线的 assistant 回复内容，应该是目标格子生成的纯回复
文本，不是"任务说明文案 + 对话上下文 + 评价要求"这个完整 prompt。
自己的时间线记录依然完整，不会因为某个站点缺少 DOM 解析能力就整体
降级为"仅最新回答"。**只有当某一段对话完全是用户绕开 MultiMind Flow、
直接在网页里手动发生、且该站点又没有 DOM 提取能力时**，这一段才会
在时间线里缺失——这是唯一无法避免的边界情况，需要在最终拼接的上下文
前加一句不确定性提示（"以下是已知的讨论记录，如果你在此网站页面内
有过其他手动提问，可能未被完整记录"）。

**长度管理（裁切规则与上一版相同，不变）**：

```typescript
const MAX_CONVERSATION_CHARS = 7000;

function truncateConversation(fullText: string): {
  text: string;
  truncated: boolean;
} {
  if (fullText.length <= MAX_CONVERSATION_CHARS) {
    return { text: fullText, truncated: false };
  }
  const truncated = fullText.slice(fullText.length - MAX_CONVERSATION_CHARS);
  return { text: truncated, truncated: true };
}
```

- 从最早内容开始裁切，保留最近部分；裁切发生时转发 prompt 中明确提示
  "注意：原始对话较长，已省略最早的部分"；同时触发 `conversation-truncated`
  通知告知发起转发的用户

**`extractConversation` 站点适配器的角色调整**：不再是"获取上下文的
主要手段"，降级为"检测用户是否在网页里手动追问的补充手段"。已经为
豆包实现的 `extractConversation`（含虚拟列表排序、推荐问题过滤）
依然有效并复用，只是调用时机和用途发生了变化——之前是"每次转发都
完整重新提取"，现在是"只用于增量检测，对比条数判断有没有新增"。

---

## IPC 频道（`shared/types.ts` 完整定义为准，此处列出类别）

```typescript
export const IPC = {
  NAVIGATE: "navigate",
  NAVIGATE_BACK: "navigate-back",
  NAVIGATE_FORWARD: "navigate-forward",
  RELOAD: "reload",

  SET_LAYOUT: "set-layout",
  SET_CELL_URL: "set-cell-url",
  TOGGLE_CELL: "toggle-cell",
  CELL_FOCUSED: "cell-focused",

  SEND_TO_ALL: "send-to-all",

  // 第二阶段：用户手动转发交叉验证
  FORWARD_RESPONSE: "forward-response", // 渲染进程 → 主进程，用户点击转发后触发
  FORWARD_COMPLETED: "forward-completed", // 主进程 → 渲染进程，转发注入已完成

  CELL_URL_CHANGED: "cell-url-changed",
  CELL_TITLE_CHANGED: "cell-title-changed",
  CELL_FAVICON_CHANGED: "cell-favicon-changed",
  SHOW_CELL_NOTICE: "show-cell-notice",
} as const;
```

### 转发记录数据结构（第二阶段，供文档生成使用）

```typescript
interface ForwardRecord {
  id: string;
  sourceCellId: string;
  targetCellId: string;
  sourceContent: string;     // 源格子的完整对话上下文（或降级后的最新回答）
  sourceTruncated: boolean;  // 是否因超长被裁切
  targetReply: string;       // 可选补充记录：目标格子后续生成的回复；转发完成不依赖它
  timestamp: number;
}

// 每次会话内维护一个转发记录列表，不持久化到 electron-store
// （只在生成最终文档时使用，文档生成后这些记录本身不单独保存）
private forwardRecords: ForwardRecord[] = [];
```

`FORWARD_RESPONSE` 的 payload 是 `{ sourceCellId, targetCellId }`，
主进程收到后执行：整理源格子完整上下文 → 拼接转述 prompt → 注入目标格子
并触发发送 → 写入 `forwardRecords` → 通过 `FORWARD_COMPLETED` 通知渲染
进程更新 UI。**转发功能的完成边界是"成功注入并触发发送"，不承诺目标 AI
已经完成评价**；目标 AI 后续生成的交叉验证意见由用户自行阅读和判断，
应用可以异步补充捕获 `targetReply`，但 UI 不应把它作为"转发完成"的前置条件。

### 统一提示系统

```typescript
export type NoticeType =
  | "google-login-blocked"
  | "inject-failed"
  | "load-failed"
  | "load-timeout"
  | "conversation-truncated";

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  message: string;
}
```

文案定义在 `shared/notices.ts` 的 `NOTICE_MESSAGES`。规则：不使用"错误"
"失败"等引发焦虑的词；提示条可手动关闭，不自动消失；同一 `cellId` +
`type` 组合在当前会话中只提示一次。

风险网址检测（`shared/riskySites.ts`）：用户在格子配置面板输入自定义
URL 时实时匹配，命中则在输入框下方显示非阻断性警示。

---

## 浏览器标签页（单屏模式，作为通用浏览器使用时）

```typescript
interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

private tabs: BrowserTab[] = [];
private activeTabId: string | null = null;
```

`tabs` 数组是标签栏 UI 渲染的唯一数据源，不允许标签栏维护独立副本。
新建标签时同时创建 `BrowserTab` 记录并 push 进数组、更新 `activeTabId`。

新建标签默认 `url: ''`（不加载 `about:blank`），地址栏显示占位提示文字，
用户点击后无需先清空即可直接输入。

标签栏容器支持横向滚动（`overflow-x: auto`），保证标签数量超出可视宽度
时，新标签依然可以通过滚动被访问，不会被裁切到完全不可见。

---

## electron-store 数据结构

Key 必须命名空间化，便于后续插件系统隔离存储：

```typescript
interface StoreSchema {
  "browser.layout": LayoutMode;
  "browser.windowBounds": {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  "cells.<cellId>.url": string;
  "cells.<cellId>.mode": CellMode;
  "cells.<cellId>.active": boolean;
  // 后续插件系统使用 'plugins.<pluginId>.*' 命名空间，不与上述冲突
}
```

---

## 打包配置（electron-builder.yml）

```yaml
appId: com.multimind.app
productName: MultiMind Flow
directories:
  output: release

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  category: public.app-category.productivity
  identity: null

win:
  target:
    - target: nsis
      arch: [x64]
  signAndEditExecutable: true

nsis:
  oneClick: false
  perMachine: false
  selectPerMachineByDefault: false
  allowElevation: true
  allowToChangeInstallationDirectory: true
  include: build/installer.nsh
  deleteAppDataOnUninstall: false
  createDesktopShortcut: always
```

**Windows 安装与卸载规则**：

- `win.signAndEditExecutable` 必须保持为 `true`，否则主 EXE 和桌面快捷方式会
  显示 Electron 默认图标。未配置证书时资源编辑仍会执行，代码签名会自动跳过。
- 覆盖安装必须重新创建桌面快捷方式，确保历史版本的 Electron 默认图标引用
  和 Windows 图标缓存能够被新产品图标替换。
- 交互式安装必须保留“当前用户/所有用户”选择；选择所有用户时按需提权。
- 自定义安装目录必须由 NSIS 注册并从对应作用域的卸载项移除，禁止硬编码
  `Program Files` 或当前用户默认目录。
- 所有用户安装的卸载进程检查必须覆盖所有用户的应用实例，不能只检查发起
  卸载的当前用户；运行中的实例无法关闭时必须中止卸载，不能留下半卸载状态。
- `appId` 必须保持 `com.multimind.browser`，产品改名或升级不能创建新的安装
  身份。同一作用域覆盖安装只保留一个版本；检测到已有所有用户安装时，后续
  覆盖安装必须继续使用所有用户作用域，并清理当前用户作用域的重复副本。
- 历史卸载器缺失或返回错误时，新安装器只能在注册目录含可验证的 MultiMind
  程序文件后执行修复清理；禁止为了“强制覆盖”而递归删除未经验证的路径。
- 默认卸载只移除程序文件、快捷方式和安装注册项，不删除 `userData` 中的
  登录状态、设置、记忆库或用户授权目录内容。

**Windows 原生依赖交叉打包规则**：

- 从 macOS 构建 Windows 包时，禁止依赖 electron-builder 的默认 rebuild；
  默认流程可能把宿主机 Mach-O 版 `better-sqlite3.node` 放进 Windows 包，
  造成应用创建窗口后在 renderer 加载前白屏。
- `package:win` 必须先按 Electron 版本准备 Windows x64 PE 原生模块，构建时
  使用 `npmRebuild=false` 防止被宿主平台覆盖，打包后验证产物中的原生模块
  是 AMD64 PE，并验证 `app.asar` 包含主进程和 renderer 启动文件。
- 非 Windows 宿主完成或中断 Windows 打包后，必须在 `finally` 中恢复宿主
  平台原生模块，不能把本地开发环境留在错误架构。

**签名决策**：当前版本不做代码签名和 Notarization（无 Apple Developer
账号和 Windows 签名证书），这是有意的 MVP 阶段决策。用户安装时需要手动
绕过 Gatekeeper / SmartScreen 提示，安装说明文档需要写清楚绕过步骤。

**Universal Binary 验证**：每次打包后必须用 `lipo -info` 验证产物真的
包含 `x86_64` 和 `arm64` 两种架构，不能假设命令成功就代表正确。

---

## User-Agent 策略

UA 按打包平台在构建时静态确定，不在运行时做任何判断逻辑：

```typescript
// src/main/constants.ts
export const CHROME_USER_AGENT =
  process.env.BUILD_TARGET === "win"
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
```

```json
"package:win": "cross-env BUILD_TARGET=win npm run build && electron-builder --win --x64"
```

同一份已安装的应用在运行期间，UA 值永远固定不变，构建完成后不存在
任何动态性。

---

## 风控规避原则（持续性事项）

**已落地的措施**：

- 每个格子独立 `partition`
- 按平台静态固定的 Chrome UA（见上）
- 统一发送时格子间延迟加随机扰动（`150 + Math.random() * 100`）
- 注入脚本执行前增加 300-800ms 随机延迟

**合规边界（不可突破）**：

- 不绕过、不破解任何网站的验证码、双重验证、人机验证机制
- 不模拟或伪造完整的用户身份信息（设备指纹、生物特征等）
- 不做运行时动态切换或随机变化 UA
- 所有优化只是让自动化操作的时序更接近真实用户习惯，不是突破网站的
  安全验证关卡
- 尊重网站明确的反自动化政策声明，不主动针对性绕过

**已知限制，当前不处理**：更深层的指纹识别（鼠标移动轨迹、页面停留
时间分布等）不在当前处理范围。

---

## 插件系统接口预留（现阶段必须遵守，即使插件系统尚未开发）

- 禁止在业务代码中直接调用 `webContents.executeJavaScript()`，必须通过
  `windowManager.injectScript(cellId, script)` 统一封装
- 每个 view 的生命周期事件（导航、标题、favicon 变化）必须通过 IPC
  广播给渲染进程，不在主进程内直接处理业务逻辑
- `electron-store` 的 key 命名空间化（见上方数据结构）

---

## 国际化（i18n，新增需求，2026年6月）

### 范围说明：两套独立的语言决策，不要混淆

MultiMind Flow 目前只有中文界面，需要新增英文支持。这个需求拆成两套
**完全独立**的语言决策，开发时不要把两者混在一起处理：

1. **UI 界面文案**：跟随用户在设置中选择的界面语言（中文/英文），
   标准的国际化范畴，本章节主要内容
2. **发给 AI 的任务说明文案**（如 `buildForwardPrompt` 和
   `buildDocumentPrompt` 里的固定文案）：
   跟随**对话内容本身使用的语言**，与界面语言无关，已在上方
   「最终 prompt 组装」章节实现（`detectContentLanguage` +
   `FORWARD_PROMPT_TEXT` / `DOCUMENT_PROMPT_TEXT`）。用户即使把界面
   切成英文，只要这次对话是用中文进行的，转发和总结文案依然用中文，
   不能因为界面是英文就跟着切换，否则会让目标 AI 在阅读体验上出现
   语言混杂的割裂感

### 技术方案

使用 `i18next` + `react-i18next`（渲染进程）做 UI 文案国际化：

```
i18next            ^23.0.0
react-i18next      ^14.0.0
```

目录新增：

```
src/renderer/locales/
├── zh.json    # 中文文案（从现有硬编码字符串迁移）
└── en.json    # 英文翻译
```

### 迁移范围（需要逐一排查并替换为 i18n key 的硬编码中文字符串）

- `Toolbar.tsx`、`GridCell.tsx`、`BottomInput.tsx`、`CellConfigPanel.tsx`
  等组件里的所有界面文案（按钮文字、占位提示、标题等）
- `shared/notices.ts` 中 `NOTICE_MESSAGES` 的所有提示文案——这些是
  给用户看的统一提示系统文案，属于 UI 文案范畴，需要做成 i18n key，
  **不要和 `FORWARD_PROMPT_TEXT` / `DOCUMENT_PROMPT_TEXT`（发给 AI 的
  任务说明文案）混淆**，两者使用不同的语言判断逻辑，存放位置也保持
  分开
- `shared/riskySites.ts` 中的风险提示文案
- 主进程里通过 IPC 发送给渲染进程展示的任何文案，需要改为只传
  i18n key 和参数，由渲染进程负责按当前界面语言渲染最终文案（不要
  在主进程里就拼好中文/英文字符串再发过去，否则切换语言时刷新不了）

### 语言切换设置

新增一个语言设置项，存入 `electron-store`（命名空间化，遵循现有
规则）：

```typescript
interface StoreSchema {
  // ...现有字段...
  "app.language": "zh" | "en";
}
```

设置面板新增语言切换选项，默认值跟随系统语言（`app.getLocale()`
判断系统是否为中文环境，是则默认 `zh`，否则默认 `en`），用户可
手动覆盖。

### 不在这次范围内（明确排除，避免任务边界扩散）

- 不做除中英文外的其他语言支持
- 不做"AI 网站内容"的翻译——各格子加载的是 Claude/ChatGPT 等
  官网原始页面，页面本身的语言由对应网站决定，MultiMind Flow 不干预，
  这次国际化只覆盖 MultiMind Flow 自己的界面和提示系统
- 第一阶段、第二阶段已经验证通过的功能逻辑不需要重新设计，这次
  只是给现有文案套上 i18n 机制，不改动任何业务逻辑

---

## 禁止事项（任何情况下都不能违反）

- 禁止使用 `BrowserView`（已废弃）
- 禁止使用 `<webview>` 标签
- 禁止在渲染进程 `require` Node.js 模块或使用 `remote` 模块
- 禁止引入需要独立启动服务的依赖（SQLite 例外，它不需要独立进程）
- 禁止在没有用户确认的情况下读写 AI 网站的 Cookie 或 localStorage
- 禁止在写入适配器中读取 AI 回答的内容（写入和读取是两套独立接口）
- 禁止绕过验证码、双重验证等网站安全机制
- 禁止运行时动态切换 User-Agent
- 第三阶段 Agent 的文件操作禁止超出用户明确授权的目录范围，禁止静默写入
- 禁止把终端的 `TerminalState` / PTY 进程合并进 `cellStates` 这套数据
  结构，两者必须保持独立（见「内置终端模块」章节）
- 禁止应用退出时遗漏 `terminalManager.destroyAll()`，避免 PTY 子进程
  成为孤儿进程残留在用户系统
- 禁止让发给 AI 的任务说明文案（如 `buildForwardPrompt` /
  `buildDocumentPrompt` 里的固定文案）跟随界面语言切换——它必须跟随
  对话内容本身的语言，这是两套独立的语言决策，不能用同一个语言状态
  变量驱动
- 禁止在主进程里直接拼好中文/英文字符串再通过 IPC 发给渲染进程
  展示，UI 文案必须只传 i18n key，由渲染进程按当前界面语言渲染

---

## 第二阶段开发指引（当前开发优先级，内置终端模块见上方独立章节）

按以下顺序推进，每步验证通过后才进入下一步：

1. **读取适配器 / 站点接入状态**：Claude、ChatGPT、DeepSeek、豆包
   四个站点的 `extractLatestResponse` 和 `isResponseComplete` 均已
   实现并验证通过，详见 `adapter-reference.md`。Kimi、智谱清言、
   通义千问已经接入各自独立适配器；底部统一发送在 Kimi、智谱清言和
   `qianwen.com` 上已基本验证通过，`chat.qwen.ai` 仍需单独补测。
   国内三站的 readable 首版已经实现，但 `extractLatestResponse`、
   `isResponseComplete`、`extractConversation` 仍需要按站点做完整实站
   验证，不能因为写入成功就宣称读取链路可靠

2. **转发交互 UI**（✅ 已完成并验证：基础转发链路、格子时间线架构、
   多跳转发上下文累积、信息流分层、国际化均已验证通过）：

   > ⚠️ 设计修正：早期规划曾设想"系统自动把每个格子的回答转述给
   > 其他所有格子"，已验证这条技术路径可行（四格子 12 条有向交叉
   > 全部跑通），但产品决策上**放弃自动遍历**，改为用户手动驱动。
   > 原因：自动全量交叉会让最终文档的素材塞满低价值内容，且 prompt
   > 长度会膨胀到一万字以上，对网页版的输入长度也不友好。用户的
   > "转发"动作本身是一次价值判断，比系统不加选择的全量交叉更精炼。

   当前交互边界：
   - 转发功能是实验功能，默认不在格子标题栏显示；用户需要在设置中开启
     "转发功能"开关后，格子标题栏才显示转发入口
   - 设置页必须明确提示转发为实验功能，因为不同网站的对话读取和长上下文
     仍可能受 DOM 结构、虚拟列表、手动网页追问和裁切限制影响
   - 开关只控制格子右上角是否显示转发入口，不改变已有时间线、读取适配器
     或转发 IPC 能力

   已实现/需要保持：
   - 每个格子的标题栏在功能开启后提供"转发"入口（图标即可）
   - 点击后弹出目标格子选择器（列出当前布局中除源格子外的其他格子）
   - 确认目标后，获取源格子的**完整上下文**（用下方「格子时间线与
     上下文合并」章节里定义的 `getCellFullContext`，不是简单调用
     `extractConversation` 重新读取整个 DOM），按
     `MAX_CONVERSATION_CHARS` 规则做长度管理（超长裁切+提示），
     拼接转述 prompt → 注入目标格子并触发发送
   - 超长裁切必须同时进入两条信息流：prompt 内保留裁切提示，让目标 AI
     知道自己看到的是最近片段；界面侧通过 `SHOW_CELL_NOTICE` 触发
     `conversation-truncated` notice 告知发起转发的用户，不做静默裁切
   - 转发动作本身需要写入目标格子的 `CellTimeline`；目标 AI 后续生成的
     回复可以由异步捕获链路补充写入目标格子的 `CellTimeline`，供后续
     任意一次再转发时使用，但不作为本次转发操作完成的前置条件
   - 转发次数不限，用户可以反复多次转发（A→B→C→A...），每次都应该
     拿到**源格子自己**当前为止的完整上下文，不会因为链路变长而丢失
     早期信息（除非触发长度裁切）。每个格子的时间线彼此独立：统一发送
     后，用户又分别在各 AI 页面里单独追问时，这些追问只属于对应格子的
     上下文。应用主动触发的底部输入和转发注入必须可靠写入时间线；用户
     直接在 AI 网页内手动追问时，只有已实现 `extractConversation` 的站点
     才能通过 DOM 增量同步完整补齐，未实现完整对话提取的站点不能宣称
     完整捕获。多次转发和 DOM 增量合并必须继续做去重，避免同一段用户
     问题、AI 回答或转发上下文在时间线里反复累积

   **2b. 格子时间线与上下文合并**（已升级为正式架构，不是补丁）：
   - 这是上一版"直接调用 extractConversation 重新读取"方案的修正，
     详细设计见上方「格子时间线与上下文合并」章节，**实现前先评审
     方案，不要直接开始写代码**（见下方任务说明）
   - 已经为豆包实现的 `extractConversation`（含虚拟列表排序、推荐
     问题过滤）继续有效，但调用角色从"主要数据来源"变成"增量检测
     的补充手段"
   - 站点尚未实现 `extractConversation` 不再直接导致转发降级——只要
     这段对话是经过 MultiMind Flow（底部输入或转发注入）发生的，应用
     自己的时间线记录就是完整的
   - 完整对话提取适配器需要逐站实现并现场验证，才能可靠捕获用户直接在
     网页内手动追加的追问。每个 AI 站点必须维护自己的适配器文件，不使用
     通用 AI DOM 适配器兜底；即使多个站点实现相似，也以站点边界清晰、
     便于单站修复为优先。Claude、ChatGPT、Kimi、智谱清言、通义千问
     已经接入各自的 readable 首版（消息容器定位、角色判定、推荐内容过滤、
     去重排序），但仍需用已登录账号做实站验证；`chat.qwen.ai` 需要和
     `qianwen.com` 分开补测，不能假设两者前端完全一致

3. **文档生成**（✅ 当前简易流程已实现）：用户指定一个 AI 汇总，应用
   只负责把总结指令注入该总结者格子，不自动抽取结果、不弹预览、不落盘。

   **当前产品边界**：
   - 总结者 AI 被认为已经通过当前网页会话拥有完整上下文（用户提问、
     自身回答、收到的转发上下文、交叉验证回复等）
   - MultiMind Flow 不再把"各格子完整时间线 + forwardRecords"重新拼成
     一份超长材料发送给总结者；这样可以避免重复上下文、长度膨胀和
     自动捕获完成状态的不稳定性
   - 用户在底部工具区点击"生成总结文档"，选择当前布局中可作为总结者
     的 AI 格子；选择后立即发送总结 prompt 并关闭选择窗口
   - AI 在自己页面里输出 Markdown 文档；prompt 要求完整文档放入一个
     ```markdown 代码块中，用户自行复制或下载保存为 `.md` 文件
   - 本阶段不做自动读取总结结果、不做固定超时等待、不做本地落盘保存、
     不写 SQLite

   **Prompt 结构**：开篇说明总结者基于当前对话上下文整理结构化文档；
   要求只基于当前对话，不编造信息，不确定内容放入"待核查事项"；
   要求输出完整 Markdown 文档，并把全文放在一个 ```markdown 代码块中，
   方便用户直接复制保存为 `.md` 文件；输出结构固定为：标题、摘要、
   主要共识、关键分歧与修正、最终结论、待核查事项、可执行建议七段式。

   **语言规则**：复用 `detectContentLanguage` 判断总结者当前已知上下文
   使用的语言，总结文档的任务说明文案跟随对话内容语言，不跟随界面语言
   （和转发功能的语言规则保持一致，不要重新设计一套）。当前只维护
   `zh/en` 两套 prompt，非中文内容默认走英文框架。

   **后续扩展边界**：如果未来重新接入"自动抽取结果 → 预览 → 本地保存"
   流程，必须先重新评审捕获策略。不能用固定超时（如 2 分钟、10 分钟）
   判断总结完成；需要明确任务状态、可取消/手动读取兜底、以及保存目录/
   文件命名规则后再实现。

4. **长期记忆存储**：采用 Source / Inbox / Memory 三层架构，不把授权目录
   直接等同于长期记忆库。

   **架构原则**：
   - Source Layer：用户从 AI 网页下载或手动保存的 `.md` 文件、用户粘贴的
     Markdown、未来 API 生成的总结结果，都只是候选来源
   - Inbox Layer：MultiMind Flow 扫描用户显式授权的 Markdown 目录，把新增
     或变更文件列入"记忆收件箱"，用户可预览、编辑并批量确认导入
   - Memory Layer：只有用户确认后的文档快照写入本地 SQLite + FTS5；长期
     记忆库不是授权目录的实时镜像

   **第一版优先入口**：
   - 免费/官网模式：用户在 AI 网页生成最终 Markdown，自行保存到授权目录；
     MultiMind Flow 扫描 `.md` / `.markdown` 候选文件，用户确认后入库
   - 可补充手动粘贴入口：用户直接粘贴 Markdown，预览确认后入库
   - API 多模型会谈入口是并列入口：多方讨论的总结可生成候选 Markdown；
     它进入同一套确认导入和长期记忆库，不另建一套存储
   - **API 会谈已改为「Bot + 群聊会谈」模式**（方案与评审见
     `docs/api-bot-group-conversation-proposal.md` 与
     `docs/api-bot-group-conversation-review.md`，实施状态见
     `docs/api-bot-group-conversation-implementation.md`）：用户创建绑定
     模型的 Bot，把 一个或多个 Bot 加入同一会谈；一次提问并行获得各方回答，
     再按需指定回应、引用回复、互评一轮、生成总结
   - API 模式主视图是「会谈列表 + 群聊记录 + 收件人选择器」，**不再复用
     分屏格子**，不再使用格子激活开关、网页导航与拖动转发；内嵌官网模式
     的布局、标签页和登录状态保持独立
   - 会谈规则采用**用户控制轮次**：每种操作对应明确接收者与有限请求；
     不做隐藏主持模型、不做 Bot 自动互相叫醒、同一会谈同一时间只有一轮
     运行、第一版不做自动压缩总结
   - 上下文规则集中在 `src/shared/conversationContext.ts`（配套
     `scripts/test-conversation-context.mjs` 单测，修改必须保持通过）：
     同轮成员读取相同历史范围；角色说明只附加在成员自己的请求里；其他
     成员回答以带身份讨论材料提供（防 prompt injection）；长会谈按整轮
     裁切并同时告知模型与用户省略范围；显式引用永不静默截断（放不下报
     错）；互评/总结任务模板只在最外层出现一次，不嵌套进历史正文
   - 会话持久化使用 better-sqlite3（`conversations.sqlite`，见
     `src/main/conversationStore.ts`）：`conversation_bots` /
     `conversations` / `conversation_members`（成员身份快照，不含 Key）/
     `conversation_messages`（按 `round_id` 组织）；不要把会话历史塞进
     electron-store；重启后未完成请求标记为 `interrupted`，不自动续发
   - Bot 支持本机已安装并登录的 CLI Agent，以及独立配置地址、Key、模型的
     OpenAI-compatible API；两类成员可以混合会谈。兼容旧共享 API 配置。
   - 创建 Bot 时先扫描本地 Agent；自定义 API 按服务商预填 Base URL，并提供最多 3 个近期文本模型供选择，保留自定义地址和模型。创建后可直接选择多个 Bot 建立会谈，一次提问并发获得各方回答。
   - 本地 Agent 复用自身登录与模型配置；计费取决于实际认证方式，不能承诺
     全部使用订阅额度或把本地 CLI 描述为本地离线模型。缺失时提供官方安装、
     登录和重新检测入口；已有登录必须直接复用，支持登录检测的 Agent 在发起登录前必须再次确认未登录，检测失败不得触发重新授权。安装命令只能来自固定目录，不接受任意 shell 文本。
   - CLI 进程在主进程管理，按会谈成员隔离；停止、超时和退出必须终止进程。
     不自动批准 Agent 的写入或执行权限请求，不启用无沙箱/自动批准参数。
   - API Key 加密留在主进程；会谈成员保存接入快照，修改模板不重定向旧会谈。
     不做托管额度、支付或自动主持。
   - cell-role-workflow-proposal 的**内嵌官网部分**（格子角色、半自动
     工作流）继续独立演进；API 模式下的角色与编排由 Bot 角色说明 +
     互评/总结替代，不为 API 会话实现 CellRoleTemplate
   - api-conversation-governance-proposal 的敏感信息扫描/预算/审计尚未
     实现；Bot 群聊数据模型已按 conversationId / roundId 组织，后续接入
     governance 时把审计事件绑定到会话与轮次即可，不需改表结构
   - API Key 只保存在本机。主进程如可用 Electron `safeStorage`，应优先
     加密后写入本地配置；渲染进程不要回显完整 API Key
   - 自动读取总结者网页结果必须后置，只有在重新评审完成状态判断、抽取
     准确性、可取消流程和确认交互后才能实现

   **授权目录规则**：
   - 必须由用户显式选择目录，禁止默认扫描 Downloads、Documents、Desktop
     或用户磁盘
   - 可以建议默认用户数据目录，例如 `~/Documents/MultiMind Flow/Memory Inbox`
     或 `%USERPROFILE%\Documents\MultiMind Flow\Memory Inbox`
   - 禁止把用户 Markdown 文件放在 MultiMind Flow 安装目录、macOS `.app`
     包内部、Windows `Program Files` 或其它程序目录中，避免升级、重装、
     卸载或写权限问题导致数据丢失
   - SQLite 数据库放在 Electron `app.getPath("userData")` 对应的应用数据目录；
     授权目录只作为候选文件来源

   **确认与同步语义**：
   - "确认"可以是轻量批量确认，不要求每份文档都重编辑；但不能完全跳过
     用户确认就把候选文件提升为高权重长期记忆
   - 源文件删除或移动时，已入库记忆不自动删除，只标记源文件缺失
   - 源文件修改时，提示用户选择是否创建新版本；不要静默覆盖已确认记忆
   - 用 content hash 去重，文件名不同但内容相同不重复导入
   - 中间转发记录、格子时间线、未确认网页内容、失败总结和草稿不得直接
     写入长期记忆；未来如做 Raw Archive，也必须和 Memory Layer 明确区分

   **记忆状态语义**：
   - 确认导入：候选 Markdown 经用户确认后成为活跃长期记忆，可搜索，未来可
     参与 AI 上下文召回
   - 停用记忆：保留本地 SQLite 记录和版本信息，但从搜索、FTS 和后续 AI
     上下文召回中排除；不会删除授权目录中的本地 Markdown 文件
   - 恢复记忆：扫描授权目录时，如果候选 Markdown 命中已停用的同源或同内容
     记录，收件箱显示为"已停用"，用户确认后把原记录重新设为活跃记忆并
     重建 FTS，不创建重复记录
   - 删除记录：真正删除 SQLite 记录及版本历史；当前尚未实现，未来必须使用
     比停用更强的确认
   - 禁止把停用记忆命名为删除，也不要用“归档”作为用户可见文案；“停用”
     才是当前功能的准确语义

   **记忆类型**：
   - 每条入库记忆必须有 `memory_type`，当前取值为 `profile`、`project`、
     `decision_rule`、`event`、`reference`
   - 导入 UI 支持"自动判断"和手动指定；自动判断只能做保守分类，用户可在
     导入前修正
   - `profile` 表示稳定用户档案、偏好、限制、长期目标；`decision_rule`
     表示可复用规则、准则、判断标准；`project` 表示项目/产品/架构背景；
     `event` 表示会议、复盘、经历等情景事件；`reference` 表示资料和摘要
   - 记忆类型是 Agent 召回和上下文注入的元数据，不替代 tags
   - `memory_type` 只描述内容类型，不能同时承担适用范围、生命周期或可信度
     语义

   **适用范围与生命周期元数据**：
   - 每条入库记忆必须有 `memory_scope`，当前取值为 `global`、`project`
   - `global` 表示可跨任务复用的用户背景、准则或资料；`project` 表示主要
     适用于某个项目、产品、代码库或任务族的背景
   - `memory_scope` 和 `memory_type` 是两条独立维度：例如一条 `decision_rule`
     既可能是全局准则，也可能只是某个项目内的准则
   - 后续如加入有效期、显式事实/AI 推断/行为模式、置信度等字段，必须继续
     作为独立元数据扩展，不要塞进 `memory_type` 或 tags

   **表结构方向**：至少包含 id、title、memory_type、memory_scope、
   original_question、participant_sites、content_markdown、tags、source_type、
   source_path、source_hash、source_mtime、source_size、created_at、updated_at、
   imported_at、version，并实现 FTS5 全文检索。已有本地数据库升级时必须通过
   迁移补齐新字段，不能要求用户重新导入记忆。

   **Agent 召回上下文**：
   - 当前已有 `MemoryStore.recallForAgentTask(query)` 作为第一版本地召回服务
   - 召回只使用活跃记忆，停用记忆必须硬排除
   - 召回结果默认保持少量，避免把整份长文档全部注入 Agent
   - 召回结果必须带结构化 `score` 和 `matchReasons`，用于解释排序原因；不要只
     返回黑盒排序结果
   - 排序应优先考虑标题、标签、原始问题和正文命中，再叠加记忆类型和适用
     范围；项目范围记忆只有在任务明显命中项目线索时才应获得范围加权
   - 泛词不能单独撑起正文命中，例如"计划"、"推荐"、"一下"、"怎么"这类
     词应过滤或降权；否则旅行、饮食、投资等互不相关的记忆容易互相污染
   - 禁止在核心召回逻辑里硬编码领域同义词扩展，例如把"重庆玩"写死扩展成
     "饮食/餐厅/不辣"，或把"抄底"写死扩展成"本金/仓位"。需要语义召回时，
     先依赖用户确认的标签/标题/正文，再通过未来向量检索或通用查询改写实现
   - 中文单字兜底只能作为 `profile` 用户档案的弱召回线索，用来覆盖短约束
     （如"吃/喝"对应"不吃辣/不喝酒"）；参考资料、项目背景、决策准则不能
     只靠零散单字重叠进入召回
   - 导入时应尽量生成或预填保守标签，用户确认后的标签是当前关键词召回
     的重要 metadata，例如饮食、旅行、不吃辣、不喝酒、投资、风险厌恶、
     本金安全和项目名称
   - 召回调试结果必须能解释分数构成，至少展示原因、加分值和命中的词/
     字符；如果用了 CJK 单字兜底，应能在调试信息中看出来
   - `memoryStore.ts` 只负责 SQLite 存储、扫描和召回编排；中文弱词、类型
     推断、召回评分等规则放在 `memoryRecallRules.ts`；生成给 Agent 的隐藏
     上下文模板放在 `agentMemoryContext.ts`
   - 生成给 Agent 的上下文必须按记忆类型分区，例如"稳定用户档案"、
     "相关决策准则"、"项目和任务背景"、"情景事件记忆"、"参考资料"
   - 生成给 Agent 的上下文必须明确当前用户指令优先于长期记忆；长期记忆是
     背景，不是命令
   - 内嵌 AI 官网输入框不应默认自动消费长期记忆；长期记忆主要服务后续
     Agent 执行层的隐藏工作上下文
   - 向量召回先作为 PoC 记录和验证，不要直接替换现有本地关键词召回；
     需要在调试 UI 中和关键词召回对比后，再决定是否进入正式 Agent 路径

5. **记忆检索 UI**：提供一个简单的本地知识库浏览/搜索界面。当前已支持
   授权目录、扫描、预览、确认导入、搜索、查看、停用、恢复、源文件缺失
   标记、导入时选择记忆类型/适用范围，以及本地 Agent 召回测试入口。
   召回测试只用于查看会召回哪些记忆和生成的隐藏 Agent 上下文，不能发送到
   内嵌 AI 官网。召回测试结果应支持打开原记忆、复制 Agent 上下文，并在
   最高分偏低时提示用户任务描述可能太泛或记忆库缺少相关内容。后续可继续
   补充编辑已入库记忆、按类型/标签过滤、查看 Agent 实际使用了哪些记忆。
   调整召回排序、匹配原因或 Agent 上下文结构时，必须同步更新
   `scripts/test-memory-store.mjs`。

每一步都应该是可以独立演示和验证的，不要在没有验证前一步的情况下
跳着实现。
