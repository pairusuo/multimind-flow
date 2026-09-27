import { DEFAULT_BOT_OUTPUT_TOKENS } from '../shared/botCatalog';
import { safeStorage } from 'electron';
import {
  ApiConversationConfig,
  ApiConversationDeltaPayload,
  ApiConversationModelResult,
  ApiConversationResult,
  CELL_IDS,
  RunApiConversationPayload,
  SaveApiConversationConfigPayload,
} from '../shared/types';
import { BrowserStore } from './windowManager';

const CONFIG_KEY = 'apiConversation.config';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODELS: string[] = [];
const REQUEST_TIMEOUT_MS = 60000;
const CONVERSATION_REQUEST_TIMEOUT_MS = 300000;
const MODEL_LIST_TIMEOUT_MS = 15000;
const MAINSTREAM_MODEL_PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'bytedance-seed',
  'x-ai',
  'qwen',
  'moonshotai',
  'z-ai',
];
const MAINSTREAM_MODEL_PROVIDERS = new Set(MAINSTREAM_MODEL_PROVIDER_ORDER);
const MODEL_PROVIDER_LIMITS: Record<string, number> = {
  openai: 3,
  anthropic: 3,
  google: 3,
  deepseek: 3,
  'bytedance-seed': 2,
  'x-ai': 2,
  qwen: 2,
  moonshotai: 2,
  'z-ai': 2,
};
const PROVIDER_PREFERRED_MODEL_PATTERNS: Record<string, RegExp[]> = {
  openai: [/^openai\/gpt-chat-latest$/i, /^openai\/gpt-5\./i],
  anthropic: [/^anthropic\/claude-sonnet/i, /^anthropic\/claude-opus/i],
  google: [/^google\/gemini-.*(?:pro|flash)(?!.*image)/i],
  deepseek: [/^deepseek\/deepseek-(?:chat|reasoner|r1|v3)/i],
  'bytedance-seed': [/^bytedance-seed\/seed-\d+(?:\.\d+)?$/i, /^bytedance-seed\/seed-\d+(?:\.\d+)?-flash$/i],
  'x-ai': [/^x-ai\/grok/i],
  qwen: [/^qwen\/qwen/i],
  moonshotai: [/^moonshotai\/kimi/i],
  'z-ai': [/^z-ai\/glm/i],
};
const EXCLUDED_MODEL_PATTERNS = [
  /(?:^|[-/:])image(?:[-/:]|$)/i,
  /(?:^|[-/:])audio(?:[-/:]|$)/i,
  /(?:^|[-/:])tts(?:[-/:]|$)/i,
  /(?:^|[-/:])embedding(?:s)?(?:[-/:]|$)/i,
  /(?:^|[-/:])moderation(?:[-/:]|$)/i,
  /(?:^|[-/:])safety(?:[-/:]|$)/i,
  /(?:^|[-/:])guard(?:[-/:]|$)/i,
  /(?:^|[-/:])coder?(?:[-/:]|$)/i,
  /(?:^|[-/:])code(?:[-/:]|$)/i,
];
interface StoredApiConversationConfig {
  baseUrl?: string;
  models?: string[];
  /** 平台返回的完整模型列表（仅按 type/object 过滤非聊天模型，不做品牌筛选） */
  allModels?: string[];
  cellModels?: Record<string, string>;
  apiKey?: string;
  apiKeyEncrypted?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

type ApiConversationDeltaHandler = (payload: ApiConversationDeltaPayload) => void;

export class ApiConversationService {
  constructor(private readonly store: BrowserStore) {}

  getConfig(): ApiConversationConfig {
    const stored = this.getStoredConfig();
    const models = filterModelCatalog(normalizeModels(stored.models));
    const allModels = normalizeModels(stored.allModels?.length ? stored.allModels : stored.models);
    return {
      baseUrl: stored.baseUrl || DEFAULT_BASE_URL,
      models,
      allModels,
      cellModels: normalizeCellModels(stored.cellModels, allModels),
      apiKeyConfigured: Boolean(stored.apiKey),
    };
  }

  /** 供会话服务获取服务入口凭据；Key 不出主进程、不进日志。 */
  getCredentials(): { baseUrl: string; apiKey: string } {
    const stored = this.getStoredConfig();
    return {
      baseUrl: normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL),
      apiKey: decryptApiKey(stored),
    };
  }

  async saveConfig(payload: SaveApiConversationConfigPayload): Promise<ApiConversationConfig> {
    const current = this.getStoredConfig();
    const baseUrl = normalizeBaseUrl(payload.baseUrl);
    const previousBaseUrl = normalizeBaseUrl(current.baseUrl || DEFAULT_BASE_URL);
    const previousApiKey = decryptApiKey(current);
    const addressChanged = baseUrl !== previousBaseUrl;
    const nextApiKey = payload.apiKey?.trim() || (addressChanged ? '' : previousApiKey);
    const explicitModels = payload.models ? normalizeModels(payload.models) : null;
    const shouldRefreshModels = Boolean(nextApiKey) || baseUrl !== previousBaseUrl || !current.models?.length;
    const discoveredModels = shouldRefreshModels ? await fetchModelIds(baseUrl, nextApiKey) : [];
    const models = discoveredModels.length
      ? filterModelCatalog(discoveredModels)
      : filterModelCatalog(explicitModels ?? (addressChanged ? [] : normalizeModels(current.models)));
    const allModels = discoveredModels.length
      ? discoveredModels
      : normalizeModels(explicitModels ?? (addressChanged ? [] : current.allModels ?? current.models ?? []));
    const next: StoredApiConversationConfig = {
      ...current,
      baseUrl,
      apiKey: addressChanged ? '' : current.apiKey,
      apiKeyEncrypted: addressChanged ? false : current.apiKeyEncrypted,
      models,
      allModels,
      cellModels: normalizeCellModels(payload.cellModels ?? current.cellModels, allModels, Boolean(discoveredModels.length)),
    };

    if (payload.apiKey?.trim()) {
      const encrypted = encryptApiKey(payload.apiKey.trim());
      next.apiKey = encrypted.value;
      next.apiKeyEncrypted = encrypted.encrypted;
    }

    this.store.set(CONFIG_KEY, next);
    return this.getConfig();
  }

  async refreshModels(): Promise<ApiConversationConfig> {
    const current = this.getStoredConfig();
    const baseUrl = normalizeBaseUrl(current.baseUrl || DEFAULT_BASE_URL);
    const apiKey = decryptApiKey(current);
    const discoveredModels = await fetchModelIds(baseUrl, apiKey);
    if (!discoveredModels.length) {
      return this.getConfig();
    }

    this.store.set(CONFIG_KEY, {
      ...current,
      baseUrl,
      models: filterModelCatalog(discoveredModels),
      allModels: discoveredModels,
      cellModels: normalizeCellModels(current.cellModels, discoveredModels, true),
    });
    return this.getConfig();
  }

  async runConversation(payload: RunApiConversationPayload, onDelta?: ApiConversationDeltaHandler): Promise<ApiConversationResult> {
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error('Prompt is required.');
    }

    const stored = this.getStoredConfig();
    const apiKey = decryptApiKey(stored);
    if (!apiKey) {
      throw new Error('API key is not configured.');
    }

    const baseUrl = normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL);
    // 评审 9.2：推荐模型不是白名单；请求使用的模型 ID 不再按品牌筛选。
    const models = normalizeModels(payload.models?.length ? payload.models : stored.models);
    if (!models.length) {
      throw new Error('At least one model is required.');
    }

    const results = await Promise.all(models.map((model) => callModel(baseUrl, apiKey, model, prompt, payload.requestId, onDelta)));
    return {
      prompt,
      results,
      createdAt: Date.now(),
    };
  }

  private getStoredConfig(): StoredApiConversationConfig {
    const value = this.store.get(CONFIG_KEY, {});
    if (!value || typeof value !== 'object') {
      return {};
    }
    return value as StoredApiConversationConfig;
  }
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  error?: string;
  elapsedMs: number;
}

/**
 * 可复用的流式 chat/completions 调用。
 * - 支持多轮 messages 数组（群聊上下文）
 * - 支持外部 AbortSignal（按成员停止）与独立超时
 */
export async function callChatCompletion(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatCompletionMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onDelta?: (delta: string, content: string) => void;
}): Promise<ChatCompletionResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onExternalAbort, { once: true });
  let content = '';

  try {
    const response = await fetch(`${params.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(['api.openai.com', 'openrouter.ai'].includes(new URL(params.baseUrl).hostname) ? { max_completion_tokens: params.maxOutputTokens ?? DEFAULT_BOT_OUTPUT_TOKENS } : { max_tokens: params.maxOutputTokens ?? DEFAULT_BOT_OUTPUT_TOKENS }),
        stream: true,
      }),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !response.body) {
      const json = await response.json().catch(() => ({})) as ChatCompletionResponse;
      content = (json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '').trim();
      const error = json.error?.message || (!response.ok ? `HTTP ${response.status}` : '');
      return { content, ...(error ? { error } : {}), elapsedMs: Date.now() - startedAt };
    }

    if (!response.ok) {
      const error = `HTTP ${response.status}`;
      return { content: '', error, elapsedMs: Date.now() - startedAt };
    }

    content = await readStreamingContent(response.body, (delta) => {
      content += delta;
      params.onDelta?.(delta, content);
    });
    return { content: content.trim(), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content, error: message, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function callModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  requestId?: string,
  onDelta?: ApiConversationDeltaHandler,
): Promise<ApiConversationModelResult> {
  const result = await callChatCompletion({
    baseUrl,
    apiKey,
    model,
    messages: [{ role: 'user', content: prompt }],
    onDelta: (delta, content) => {
      emitApiDelta(onDelta, {
        requestId,
        model,
        delta,
        content,
        done: false,
      });
    },
  });

  emitApiDelta(onDelta, {
    requestId,
    model,
    content: result.content,
    done: true,
    ...(result.error ? { error: result.error } : {}),
    elapsedMs: result.elapsedMs,
  });
  return {
    model,
    content: result.content,
    ...(result.error ? { error: result.error } : {}),
    elapsedMs: result.elapsedMs,
  };
}

async function fetchModelIds(baseUrl: string, apiKey?: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const json = await response.json().catch(() => ({})) as {
      data?: Array<{
        id?: unknown;
        name?: unknown;
        type?: unknown;
        object?: unknown;
      }>;
    };

    const chatModels = (json.data ?? [])
      .filter((item) => isUsableChatModel(item))
      .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
      .filter(Boolean);
    // 平台返回的完整列表不做品牌筛选；推荐列表（filterModelCatalog）由保存时另行计算。
    return normalizeModels(chatModels);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isUsableChatModel(model: { type?: unknown; object?: unknown }): boolean {
  const type = typeof model.type === 'string' ? model.type.toLowerCase() : '';
  const object = typeof model.object === 'string' ? model.object.toLowerCase() : '';
  return !type || type === 'chat' || type === 'language' || type === 'text' || object === 'model';
}

function filterModelCatalog(models: string[]): string[] {
  const mainstream = models
    .filter((model) => MAINSTREAM_MODEL_PROVIDERS.has(model.split('/')[0]?.toLowerCase() ?? ''))
    .filter((model) => !isDatedSnapshotModel(model))
    .filter((model) => !EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(model)));
  const selected: string[] = [];

  for (const provider of MAINSTREAM_MODEL_PROVIDER_ORDER) {
    const providerModels = mainstream.filter((model) => getModelProvider(model) === provider);
    selected.push(...selectProviderModels(provider, providerModels));
  }

  return normalizeModels(selected);
}

function selectProviderModels(provider: string, providerModels: string[]): string[] {
  const limit = MODEL_PROVIDER_LIMITS[provider] ?? 2;
  const patterns = PROVIDER_PREFERRED_MODEL_PATTERNS[provider] ?? [];
  const preferred = normalizeModels(
    patterns.flatMap((pattern) => providerModels.filter((model) => pattern.test(model))),
  );
  const candidates = preferred.length ? preferred : providerModels;
  return candidates.sort(compareModelIds).slice(0, limit);
}

function getModelProvider(model: string): string {
  return model.split('/')[0]?.toLowerCase() ?? '';
}

function isDatedSnapshotModel(model: string): boolean {
  return /-\d{4}-\d{2}-\d{2}(?:$|[-/:])/.test(model);
}

function compareModelIds(a: string, b: string): number {
  return modelScore(b) - modelScore(a) || a.localeCompare(b);
}

function modelScore(model: string): number {
  const id = model.toLowerCase();
  let score = 0;
  if (id.includes('latest')) score += 80;
  if (id.includes('auto')) score += 75;
  if (id.includes('sonnet')) score += 70;
  if (id.includes('opus')) score += 68;
  if (id.includes('gpt-')) score += 66;
  if (id.includes('gemini')) score += 64;
  if (id.includes('deepseek')) score += 62;
  if (id.includes('seed')) score += 61;
  if (id.includes('grok')) score += 60;
  if (id.includes('kimi')) score += 58;
  if (id.includes('qwen')) score += 56;
  if (id.includes('free')) score -= 20;
  if (id.includes('mini') || id.includes('lite')) score -= 12;
  return score;
}

async function readStreamingContent(body: ReadableStream<Uint8Array>, onChunk: (delta: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const delta = parseSseDelta(event);
      if (delta === null) {
        continue;
      }
      content += delta;
      onChunk(delta);
    }
  }

  buffer += decoder.decode();
  const delta = parseSseDelta(buffer);
  if (delta) {
    content += delta;
    onChunk(delta);
  }

  return content;
}

function parseSseDelta(event: string): string | null {
  const dataLines = event
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (!dataLines.length) {
    return null;
  }

  let delta = '';
  for (const data of dataLines) {
    if (data === '[DONE]') {
      continue;
    }
    try {
      const json = JSON.parse(data) as ChatCompletionResponse & {
        choices?: Array<{
          delta?: {
            content?: string;
          };
          message?: {
            content?: string;
          };
          text?: string;
        }>;
      };
      delta += json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    } catch {
      continue;
    }
  }

  return delta || null;
}

function emitApiDelta(onDelta: ApiConversationDeltaHandler | undefined, payload: ApiConversationDeltaPayload): void {
  onDelta?.(payload);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const withoutTrailingSlash = withProtocol.replace(/\/+$/, '');
  return withoutTrailingSlash
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
}

function normalizeModels(models: string[] | undefined): string[] {
  const normalized = (models ?? DEFAULT_MODELS)
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeCellModels(
  cellModels: Record<string, string> | undefined,
  fallbackModels: string[] | undefined,
  requireListedModel = false,
): Record<string, string> {
  const fallback = normalizeModels(fallbackModels);
  return CELL_IDS.reduce<Record<string, string>>((next, cellId, index) => {
    const currentModel = cellModels?.[cellId]?.trim() ?? '';
    next[cellId] = currentModel && (!requireListedModel || fallback.includes(currentModel))
      ? currentModel
      : fallback[index] || '';
    return next;
  }, {});
}

function encryptApiKey(apiKey: string): { value: string; encrypted: boolean } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { value: apiKey, encrypted: false };
  }
  return {
    value: safeStorage.encryptString(apiKey).toString('base64'),
    encrypted: true,
  };
}

function decryptApiKey(config: StoredApiConversationConfig): string {
  if (!config.apiKey) {
    return '';
  }
  if (!config.apiKeyEncrypted) {
    return config.apiKey;
  }
  try {
    return safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'));
  } catch {
    return '';
  }
}

export const __apiConversationTestHooks = {
  filterModelCatalog,
  normalizeBaseUrl,
  normalizeCellModels,
  normalizeModels,
};
