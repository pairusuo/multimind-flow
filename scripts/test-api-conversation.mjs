import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fromRoot = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const { __apiConversationTestHooks } = require('../dist/main/apiConversationService.js');
const {
  getApiModelDisplayName,
  getApiModelProvider,
  getApiModelProviderLabel,
  getApiModelProviderMeta,
} = require('../dist/shared/apiModelMetadata.js');

const {
  filterModelCatalog,
  normalizeBaseUrl,
  normalizeCellModels,
  normalizeModels,
} = __apiConversationTestHooks;

assert.equal(
  normalizeBaseUrl('openrouter.ai/api/v1/chat/completions'),
  'https://openrouter.ai/api/v1',
  'OpenRouter chat completions URL should be normalized to the API base URL',
);
assert.equal(
  normalizeBaseUrl('https://openrouter.ai/api/v1/models'),
  'https://openrouter.ai/api/v1',
  'OpenRouter models URL should be normalized to the API base URL',
);
assert.equal(
  normalizeBaseUrl(''),
  'https://openrouter.ai/api/v1',
  'Empty API URL should use the OpenRouter base URL',
);

assert.deepEqual(
  normalizeModels([' openrouter/auto ', 'openrouter/auto', '', 'anthropic/claude-sonnet-5']),
  ['openrouter/auto', 'anthropic/claude-sonnet-5'],
  'Model IDs should be trimmed, deduplicated, and empty values removed',
);

assert.equal(getApiModelProvider('gpt-5.1'), 'openai', 'Bare GPT model names should resolve to OpenAI');
assert.equal(getApiModelProvider('gemini-2.5-flash'), 'google', 'Bare Gemini model names should resolve to Google');
assert.equal(getApiModelProvider('anthropic/claude-sonnet-5'), 'anthropic', 'Provider-prefixed model names should keep their provider');
assert.equal(getApiModelProvider('bytedance-seed/seed-1.6'), 'bytedance-seed', 'Seed model names should resolve to Doubao');
assert.equal(getApiModelProviderLabel('google'), 'Gemini', 'Provider labels should use the model brand in the title and dropdown');
assert.equal(getApiModelProviderLabel('anthropic'), 'Claude', 'Claude models should show the model brand instead of the company name');
assert.equal(getApiModelProviderMeta('gemini-2.5-flash').badgeText, 'G', 'Gemini cells should use the Google model badge');
assert.equal(getApiModelDisplayName('google/gemini-2.5-flash'), 'gemini-2.5-flash', 'Dropdown labels should hide provider prefixes');

for (const logoFile of [
  'claude.svg',
  'deepseek.svg',
  'doubao.svg',
  'gemini.svg',
  'grok.svg',
  'kimi.svg',
  'openai.svg',
  'qwen.svg',
  'z-ai.svg',
]) {
  assert.ok(
    statSync(fromRoot(`src/renderer/assets/model-logos/${logoFile}`)).size > 100,
    `${logoFile} should be available as a bundled local model logo`,
  );
}

const rawCatalog = [
  'thinkingmachines/inkling',
  'openrouter/auto',
  'openrouter/auto-beta',
  'openrouter/fusion',
  'openai/gpt-chat-latest',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-4o-2024-08-06',
  'openai/gpt-4o-search-preview',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.8-fast',
  'google/gemini-3.1-pro',
  'google/gemini-3.1-flash',
  'google/gemini-3-pro-image',
  'bytedance-seed/seed-2.0-lite',
  'bytedance-seed/seed-2.0-mini',
  'bytedance-seed/seed-1.6-flash',
  'bytedance-seed/seed-1.6',
  'bytedance/ui-tars-1.5-7b',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3.2',
  'x-ai/grok-4.5',
  'x-ai/grok-latest',
  'qwen/qwen3.7-plus',
  'qwen/qwen3.7-code',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.2',
  'meta-llama/llama-4.1',
  'mistralai/mistral-large-latest',
];

const filtered = filterModelCatalog(rawCatalog);

for (const expected of [
  'openai/gpt-chat-latest',
  'openai/gpt-5.6-terra-pro',
  'anthropic/claude-sonnet-5',
  'google/gemini-3.1-pro',
  'bytedance-seed/seed-1.6',
  'deepseek/deepseek-v3.2',
  'x-ai/grok-4.5',
  'qwen/qwen3.7-plus',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.2',
]) {
  assert.ok(filtered.includes(expected), `${expected} should remain in the mainstream model list`);
}

for (const excluded of [
  'thinkingmachines/inkling',
  'openrouter/auto',
  'openrouter/auto-beta',
  'openrouter/fusion',
  'meta-llama/llama-4.1',
  'mistralai/mistral-large-latest',
  'bytedance/ui-tars-1.5-7b',
  'openai/gpt-4o-2024-08-06',
  'google/gemini-3-pro-image',
  'qwen/qwen3.7-code',
]) {
  assert.ok(!filtered.includes(excluded), `${excluded} should be filtered out`);
}

assert.deepEqual(
  filtered.filter((model) => model.startsWith('bytedance-seed/')),
  ['bytedance-seed/seed-1.6', 'bytedance-seed/seed-1.6-flash'],
  'Doubao should keep only mainstream Seed chat models',
);
assert.ok(
  filtered.filter((model) => model.startsWith('anthropic/')).length <= 3,
  'Anthropic model list should be capped for a usable dropdown',
);

assert.deepEqual(
  normalizeCellModels(
    {
      'cell-0': 'deepseek-v4-flash',
      'cell-1': 'anthropic/claude-sonnet-5',
    },
    filtered,
    true,
  ),
  {
    'cell-0': filtered[0],
    'cell-1': 'anthropic/claude-sonnet-5',
    'cell-2': filtered[2],
    'cell-3': filtered[3],
  },
  'Saved invalid models should be replaced when a refreshed provider catalog is available',
);

console.log('API conversation tests passed.');

const { callChatCompletion } = require('../dist/main/apiConversationService.js');
const { botErrorKind } = require('../dist/shared/botErrors.js');
const previousFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  for (const baseUrl of ['https://openrouter.ai/api/v1', 'https://api.openai.com/v1', 'https://api.deepseek.com']) {
    await callChatCompletion({ baseUrl, apiKey: 'fixture', model: 'fixture', messages: [] });
    const body = requests.at(-1);
    assert.equal(body.max_completion_tokens ?? body.max_tokens, 4096);
    assert.equal('temperature' in body, false, 'Use model defaults, including models that reject sampling controls');
  }
  await callChatCompletion({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'fixture', model: 'fixture', messages: [], maxOutputTokens: 512 });
  assert.equal(requests.at(-1).max_completion_tokens, 512);
} finally { globalThis.fetch = previousFetch; }
assert.equal(botErrorKind('This request requires more credits, or fewer max_tokens. You can only afford 800'), 'credits');
assert.equal(botErrorKind('Incorrect API key provided'), 'api-auth');
assert.equal(botErrorKind('Local Agent timed out'), null);
