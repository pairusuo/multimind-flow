import type { CellMode } from './types';

export interface PresetSite {
  id: string;
  name: string;
  url: string;
  aliases?: string[];
  newConversationUrl?: string;
  region: 'international' | 'china';
  mode: CellMode;
  searchUrlTemplate?: string;
}

export const PRESET_SITES: PresetSite[] = [
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', newConversationUrl: 'https://claude.ai/new', region: 'international', mode: 'chat' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', region: 'international', mode: 'chat' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com', region: 'international', mode: 'chat' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://perplexity.ai', region: 'international', mode: 'chat' },
  { id: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com', region: 'international', mode: 'chat' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', region: 'china', mode: 'chat' },
  { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com', aliases: ['https://kimi.moonshot.cn'], region: 'china', mode: 'chat' },
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com', region: 'china', mode: 'chat' },
  { id: 'tongyi', name: '通义千问', url: 'https://www.qianwen.com/', aliases: ['https://chat.qwen.ai', 'https://tongyi.aliyun.com'], region: 'china', mode: 'chat' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com', region: 'china', mode: 'chat' },
  { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn', region: 'china', mode: 'chat' },
  {
    id: 'google',
    name: 'Google',
    url: 'https://www.google.com',
    region: 'international',
    mode: 'search',
    searchUrlTemplate: 'https://www.google.com/search?q={query}',
  },
  {
    id: 'bing',
    name: 'Bing',
    url: 'https://www.bing.com',
    region: 'international',
    mode: 'search',
    searchUrlTemplate: 'https://www.bing.com/search?q={query}',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com',
    region: 'international',
    mode: 'search',
    searchUrlTemplate: 'https://duckduckgo.com/?q={query}',
  },
  {
    id: 'baidu',
    name: '百度',
    url: 'https://www.baidu.com',
    region: 'china',
    mode: 'search',
    searchUrlTemplate: 'https://www.baidu.com/s?wd={query}',
  },
  {
    id: 'sogou',
    name: '搜狗',
    url: 'https://www.sogou.com',
    region: 'china',
    mode: 'search',
    searchUrlTemplate: 'https://www.sogou.com/web?query={query}',
  },
];

export function inferModeFromUrl(rawUrl: string): CellMode | 'unknown' {
  return findPresetSiteByUrl(rawUrl)?.mode ?? 'unknown';
}

/** Repair URLs persisted by older builds that treated iframe navigation as tab navigation. */
export function repairPersistedSiteUrl(rawUrl: string): string {
  const url = parseUrl(rawUrl);
  const doubao = PRESET_SITES.find((site) => site.id === 'doubao');
  if (url && doubao && hostsMatch(url.hostname, new URL(doubao.url).hostname)
      && /^\/drive-iframe(?:\/|$)/.test(url.pathname)) {
    return doubao.url;
  }
  return rawUrl;
}

export function findPresetSiteByUrl(rawUrl: string): PresetSite | null {
  const url = parseUrl(rawUrl);
  if (!url) {
    return null;
  }

  return PRESET_SITES.find((site) => {
    const urls = [site.url, ...(site.aliases ?? [])];
    return urls.some((candidate) => {
      const siteUrl = parseUrl(candidate);
      return siteUrl ? hostsMatch(url.hostname, siteUrl.hostname) : false;
    });
  }) ?? null;
}

function parseUrl(rawUrl: string): URL | null {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    return new URL(trimmedUrl);
  } catch {
    try {
      return new URL(`https://${trimmedUrl}`);
    } catch {
      return null;
    }
  }
}

function hostsMatch(inputHost: string, presetHost: string): boolean {
  const input = normalizeHost(inputHost);
  const preset = normalizeHost(presetHost);
  return input === preset || input.endsWith(`.${preset}`);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}
