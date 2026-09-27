# Bot 接入指南：账号、API Key 与费用

## 先选使用方式

| 你的情况 | 在创建 Bot 时选择 | 需要准备 |
| --- | --- | --- |
| 本机已经使用某个 Agent | 本地 Agent | 已安装的 Agent 及其登录或配置 |
| 希望充值后按用量调用模型 | 自定义 API | 对应模型平台的 API Key、服务地址和模型 |
| 还没有安装 Agent | 本地 Agent → 一键安装 | 在终端完成安装，然后点击“重新检测” |

本地 Agent 和自定义 API 创建的 Bot 可以加入同一会谈。选择一个 Bot 可以单独聊天，选择多个 Bot 可以让它们回答同一个问题。

安装 Agent 不等于获得免费模型额度。本地 Agent 会使用它已有的账号或模型服务配置；API Bot 的用量由填写的 API Key 所属服务商计费。试用额度、余额和会员权益请在对应服务商账户查看。

## 本地 Agent 一览

| 列表中的名称 | 是什么 | 首次使用 |
| --- | --- | --- |
| Codex CLI | OpenAI 的终端 Agent | 安装后使用 ChatGPT 账号登录，或配置 OpenAI API Key。[官方接入说明](https://developers.openai.com/codex/auth) |
| Claude Code | Anthropic 的终端 Agent | 安装后使用有权限的 Claude 账号登录，或配置模型服务。[官方接入说明](https://code.claude.com/docs/en/authentication) |
| Gemini CLI | Google 的开源终端 Agent | 安装后使用 Google 账号登录，或配置 Gemini API Key / Vertex AI。[官方接入说明](https://geminicli.com/docs/get-started/authentication/) |
| Qwen Code | Qwen 团队的开源终端 Agent | 安装后配置百炼套餐或其他模型服务的 API Key。[官方接入说明](https://qwenlm.github.io/qwen-code-docs/zh/users/configuration/auth/) |
| Kimi Code CLI | Kimi 的终端 Agent | 安装后登录 Kimi Code 账号，或使用已有模型服务配置。[官方接入说明](https://www.kimi.com/code/docs/kimi-code-cli/guides/getting-started) |
| Qoder CN CLI | Qoder 中国大陆版的终端 Agent | 使用 Qoder CN 账号，安装后在终端登录。[官方接入说明](https://docs.qoder.cn/cli/authentication) |
| DeepSeek Harness | DeepSeek 官方 Agent，开发者预览版 | 安装后打开设置配置 DeepSeek API Key。[官方项目](https://github.com/deepseek-ai/deepseek-harness) |

已有配置会复用。额度和费用由实际使用的账号或模型服务决定。

### Qwen Code 与 Qoder 有什么区别？

- **Qwen Code** 是 Qwen 团队的开源终端 Agent，命令为 `qwen`。可以接入百炼或其他模型服务，使用相应服务的 Key 与额度。
- **Qoder 国际版** 的官网是 [qoder.com](https://qoder.com)，中国大陆版是 [qoder.cn](https://qoder.cn)。当前应用列表接入的是 **Qoder CN CLI**。
- Qwen Code 与 Qoder 是不同产品。想直接使用千问 API，可以选择“自定义 API → Qwen / 通义千问”，无需安装它们。

Qwen Code 官方已于 2026 年 4 月 15 日停止原 Qwen OAuth 免费额度；新用户请使用当前支持的百炼套餐或 API Key 配置方式。[官方认证说明](https://qwenlm.github.io/qwen-code-docs/zh/users/configuration/auth/)

## 自定义 API 服务一览

| 列表中的服务 | 到哪里开通 | 准备什么 |
| --- | --- | --- |
| DeepSeek | [DeepSeek 开放平台](https://platform.deepseek.com) | 充值并创建 API Key |
| Qwen / 通义千问 | [阿里云百炼](https://bailian.console.aliyun.com) | 开通模型服务并创建对应地域的 API Key |
| Kimi / Moonshot | [Kimi 开放平台](https://platform.kimi.com) | 充值并创建 API Key |
| GLM / 智谱 | [智谱开放平台](https://open.bigmodel.cn) | 开通模型服务并创建 API Key |
| Doubao / 豆包 | [火山方舟](https://console.volcengine.com/ark) | 开通模型服务并创建 API Key |
| OpenAI | [OpenAI 开放平台](https://platform.openai.com) | 配置 API 计费并创建 API Key |
| OpenRouter | [OpenRouter](https://openrouter.ai) | 充值并创建 API Key，选择平台支持的模型 |

服务地址、Key 和模型须匹配。额度与计费方式以对应平台账户为准。

## 千问：通过阿里云百炼使用 API

**千问也有和 DeepSeek 一样的 API 调用模式，通过「阿里云百炼」提供。** 使用这条路线不需要安装 Qwen Code，也不需要订阅 Qoder。

1. 登录阿里云百炼，按平台提示开通模型服务，确认账户可正常计费。
2. 在百炼控制台选择地域，创建 API Key。
3. 在应用中选择“创建 Bot → 自定义 API → Qwen / 通义千问”。
4. 填写百炼 API Key，并确认服务地址与 Key 所属地域一致。
5. 选择该地域、账号有权限使用的模型，填写名称并创建 Bot。
6. 新建会谈，选择刚创建的 Bot 开始聊天。

应用预填的千问地址是北京地域的 OpenAI 兼容地址：
`https://dashscope.aliyuncs.com/compatible-mode/v1`。如果 Key 来自其他地域，请使用该地域官方提供的地址和模型。

**Qoder 的个人访问令牌不能填在这里。** 百炼按量付费 API、Coding Plan 等套餐的凭证与地址也不能随意混用。

官方入口：[百炼控制台](https://bailian.console.aliyun.com/) · [创建 API Key 与地域配置](https://help.aliyun.com/zh/model-studio/get-api-key) · [首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)

## DeepSeek：开放平台充值后使用 API

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 API Key，并确认余额可用。
2. 在应用中选择“创建 Bot → 自定义 API → DeepSeek”。
3. 保留对应官方服务地址，填写 API Key，选择模型并创建 Bot。

API 调用的费用从该开放平台账户结算。日常在 DeepSeek 网页聊天的登录状态不能替代 API Key。

官方说明：[DeepSeek API 接入](https://api-docs.deepseek.com/)

## DeepSeek Harness：官方本地 Agent

DeepSeek Harness（命令为 `dsh`）是 DeepSeek 官方 Agent，目前处于开发者预览阶段。

1. 在“创建 Bot → 本地 Agent”选择 DeepSeek Harness，点击“一键安装”；需要可用的 Node.js 环境，版本要求以官方说明为准。
2. 终端完成安装后，点击“重新检测”。
3. 首次使用点击“打开设置”，在 Harness 打开的页面进入 Settings → Models，配置 DeepSeek API Key。已有本机配置可直接复用。
4. 回到应用创建 Bot，模型留空使用 Harness 默认模型；指定模型须在 Harness 中可用。
5. 新建会谈并选择这个 Bot。

通过 DeepSeek API Key 使用时，消耗该 Key 所属账户的 API 额度。安装 Harness 不会额外赠送 API 余额。

官方入口：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [配置指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md)

## Kimi：API 与 Code 会员是两条路线

| | Kimi API | Kimi Code CLI |
| --- | --- | --- |
| 在应用里选择 | 自定义 API → Kimi / Moonshot | 本地 Agent → Kimi Code CLI |
| 凭证来源 | Kimi 开放平台 API Key | 本地 CLI 已有登录或配置 |
| 常见计费方式 | 开放平台按用量计费 | 使用 Kimi Code 登录时，消耗会员 Code 额度 |

想按用量付费：在 [Kimi 开放平台](https://platform.kimi.com/) 开通服务并创建 API Key，再在应用中创建 API Bot。开户、充值和管理 Key 使用 `platform.kimi.com`，API 请求使用 `https://api.moonshot.cn/v1`。这两个域名用途不同，属于同一中国站服务。国际站账户与 Key 请使用其对应的服务地址。[官方调用示例](https://platform.kimi.com/docs/get-api-key)

想使用 Kimi Code：先完成安装，再点击“重新检测”，选择 Kimi Code CLI，使用“打开终端登录”完成登录。已经在本机登录过，可以复用。若 CLI 配置了其他模型服务，则以该配置对应的账户计费。

Kimi Code 会员服务与开放平台的 Key、服务地址不同，请不要混用。

官方说明：[Kimi Code 开始使用与平台区别](https://www.kimi.com/code/docs/kimi-code-cli/guides/getting-started)

## Qoder CN：使用 Qoder 账号服务

Qoder CN CLI 使用 Qoder CN 账号的额度，与百炼的千问 API 账户分开。

- 已在本机完成网页登录：应用复用已有登录，无需另外创建个人访问令牌。
- 个人访问令牌：是 Qoder CN 提供的另一种认证方式，不能作为百炼 API Key。
- 未订阅也不代表一定能免费使用：是否有试用、赠送或剩余额度，以 Qoder CN 账户显示为准。

官方说明：[登录与认证](https://docs.qoder.cn/cli/authentication) · [账号与订阅](https://docs.qoder.cn/product-overview/account-and-subscription)

## 安装完成后怎么继续

点击“一键安装”会打开系统终端执行安装。应用显示“安装终端已打开”，不表示安装成功或仍在进行。

1. 在终端确认安装成功。
2. 回到创建 Bot 页面，点击“重新检测”。
3. 对应 Agent 出现在“本机已安装”后，选中它；需要登录时点击“打开终端登录”。
4. 填写 Bot 名称，按需选择模型、填写角色与行为，然后创建。

“重新运行安装”会再次执行安装，不是打开 Agent 聊天。检测结果会保存在本机，后续由你手动重新检测。

## 常见问题

**Key 被拒绝，是不是要重新登录本地 Agent？**

自定义 API 请检查 Key 是否来自所选平台、是否有效，以及地域和套餐是否与服务地址匹配。本地 Agent 的登录无法替代 API Key。

**一个 API Key 可以给多个 Bot 使用吗？**

可以在多个 Bot 中配置同一个有权限的 Key。它们共用该 Key 对应账户的余额和服务限制；创建多个 Bot 不会增加额度。

**一次让多个 Bot 回答，费用怎么算？**

每个 Bot 都会向自己的服务发起请求，分别消耗对应账户额度。互评和生成总结同样会产生新的调用。

**模型列表没有我想用的模型？**

选择“手动填写模型”，输入该服务商官方提供且你的账号可用的模型 ID。模型名称、地址和 Key 需要属于同一服务。

本指南不固定列出价格或赠送额度，避免活动、套餐调整后产生误导；充值和订阅前请确认服务商当前规则。

## 指定回答者与总指挥

在会谈输入框中输入 `@`，从列表选择一位或多位 Bot。只有被指定的 Bot 回答，它们可以读取当前会谈历史。使用 `@全体` 让所有成员回答。发送前可在输入框下方确认接收者。

会谈顶部的“总指挥”默认关闭。选择一位已有 Bot 后，没有明确接收者的消息会先交给它安排任务，再由成员并行或依次执行，最后由总指挥给出答复。简单问题可以由总指挥直接回答。每次最多安排 6 位成员，每人执行一次；不会无限自动讨论。

明确 @ 成员或手动选择接收者时，会直接交给指定成员，不经过总指挥。总指挥设置保存在当前会谈中，移除担任总指挥的成员后自动关闭。

安排任务和最终汇总会额外调用总指挥使用的模型，费用或额度按该 Bot 的账号配置计算。点击“停止本轮”可停止后续执行；已经收到的回答会保留。安排失败时，可以重新发送，或直接 @ 指定成员。
