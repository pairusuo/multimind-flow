export const BOT_GUIDE_LINKS = {
  codex: 'https://developers.openai.com/codex/auth',
  claude: 'https://code.claude.com/docs/en/authentication',
  gemini: 'https://geminicli.com/docs/get-started/authentication/',
  qwenCode: 'https://qwenlm.github.io/qwen-code-docs/zh/users/configuration/auth/',
  qoderInternational: 'https://qoder.com',
  glm: 'https://open.bigmodel.cn',
  doubao: 'https://console.volcengine.com/ark',
  openai: 'https://platform.openai.com',
  openrouter: 'https://openrouter.ai',
  deepseek: 'https://platform.deepseek.com',
  qwen: 'https://bailian.console.aliyun.com',
  kimi: 'https://platform.kimi.com',
  kimiCode: 'https://kimi.com/code',
  qoder: 'https://qoder.cn',
  dsh: 'https://github.com/deepseek-ai/deepseek-harness',
} as const;
export type BotGuideLink = keyof typeof BOT_GUIDE_LINKS;
export function botGuideUrl(key: string): string {
  if (!Object.prototype.hasOwnProperty.call(BOT_GUIDE_LINKS, key)) throw new Error('Unknown guide link');
  return BOT_GUIDE_LINKS[key as BotGuideLink];
}

export const LOCAL_AGENTS = [
  { id: 'dsh', loginArgs: ['web'], setupKind: 'configure', name: 'DeepSeek Harness', region: 'cn', command: 'dsh', install: 'npm install -g @deepseek-ai/dsh', docs: 'https://github.com/deepseek-ai/deepseek-harness', npmEntry: '@deepseek-ai/dsh/lib/bin.js', protocol: 'acp', acpArgs: ['--profile', 'acp'] },
  { id: 'codex', loginArgs: ['login'], name: 'Codex CLI', region: 'us', command: 'codex', install: 'npm install -g @openai/codex', docs: 'https://developers.openai.com/codex/cli/', npmEntry: '@openai/codex/bin/codex.js', protocol: 'codex' },
  { id: 'claude', loginArgs: ['auth', 'login'], name: 'Claude Code', region: 'us', command: 'claude', install: 'npm install -g @anthropic-ai/claude-code', docs: 'https://code.claude.com/docs/en/setup', npmEntry: '@anthropic-ai/claude-code/cli.js', protocol: 'claude' },
  { id: 'gemini', loginArgs: [], name: 'Gemini CLI', region: 'us', command: 'gemini', install: 'npm install -g @google/gemini-cli', docs: 'https://geminicli.com/docs/get-started/installation/', npmEntry: '@google/gemini-cli/dist/index.js', protocol: 'acp', acpArgs: ['--acp'] },
  { id: 'qwen', loginArgs: [], name: 'Qwen Code', region: 'cn', command: 'qwen', install: 'npm install -g @qwen-code/qwen-code@latest', docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/', npmEntry: '@qwen-code/qwen-code/cli.js', protocol: 'acp', acpArgs: ['--acp'] },
  { id: 'kimi', loginArgs: ['login'], name: 'Kimi Code CLI', region: 'cn', command: 'kimi', install: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash', installWindows: 'powershell -NoProfile -Command "irm https://code.kimi.com/kimi-code/install.ps1 | iex"', docs: 'https://www.kimi.com/code/docs/kimi-code-cli/guides/getting-started', npmEntry: '', protocol: 'acp', acpArgs: ['acp'] },
  { id: 'qodercn', loginArgs: ['login'], name: 'Qoder CN CLI', region: 'cn', command: 'qodercn', install: 'curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash', installWindows: 'powershell -NoProfile -Command "irm https://static.qoder.com.cn/qoder-cli-cn/install.ps1 | iex"', docs: 'https://docs.qoder.cn/cli/authentication', npmEntry: '@qodercn-ai/qoderclicn/bundle/qodercn-npm-dispatcher.cjs', protocol: 'acp', acpArgs: ['--acp'] },
] as const;

export type LocalAgentId = typeof LOCAL_AGENTS[number]['id'];
export function localAgent(id: string) {
  const preset = LOCAL_AGENTS.find((agent) => agent.id === id);
  if (!preset) throw new Error('Unknown local agent.');
  return preset;
}

export interface ApiBotPreset {
  id: string;
  name: string;
  baseUrl: string;
  models: readonly string[];
  modelsSource: string;
}

// Public text-chat catalog reviewed on this date; never pad a provider with retired aliases.
export const API_BOT_MODELS_REVIEWED_AT = '2026-09-27';
export const API_BOT_PRESETS: readonly ApiBotPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'], modelsSource: 'https://api-docs.deepseek.com/api/list-models/' },
  { id: 'qwen', name: 'Qwen / 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'], modelsSource: 'https://help.aliyun.com/zh/model-studio/models' },
  { id: 'kimi', name: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'], modelsSource: 'https://platform.kimi.com/docs/get-api-key' },
  { id: 'glm', name: 'GLM / 智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx'], modelsSource: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash' },
  { id: 'doubao', name: 'Doubao / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915'], modelsSource: 'https://docs.volcengine.com/docs/ark/model-list?lang=zh' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'], modelsSource: 'https://developers.openai.com/api/docs/models' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['perceptron/perceptron-mk1.5', 'fireworks/ember-1', 'z-ai/glm-5.3-prime'], modelsSource: 'https://openrouter.ai/api/v1/models' },
];

export function apiBotPresetForUrl(baseUrl: string): ApiBotPreset | undefined {
  return API_BOT_PRESETS.find((preset) => preset.baseUrl === baseUrl.trim().replace(/\/+$/, ''));
}

export const DEFAULT_BOT_OUTPUT_TOKENS = 4096;
export function botConnectionLabel(connection: import('./types').BotConnection | undefined): string {
  if (connection?.kind === 'cli') return localAgent(connection.agent).name;
  if (connection?.kind === 'api') {
    const preset = apiBotPresetForUrl(connection.baseUrl);
    if (preset) return `${preset.name} API`;
    try { return `${new URL(connection.baseUrl).host} API`; } catch { return 'API'; }
  }
  return 'API';
}
