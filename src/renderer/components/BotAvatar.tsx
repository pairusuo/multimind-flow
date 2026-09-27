import qodercn from '../assets/model-logos/qodercn.png';
import type { BotConnection } from '../../shared/types';
import { apiBotPresetForUrl } from '../../shared/botCatalog';
import openai from '../assets/model-logos/openai.svg';
import claude from '../assets/model-logos/claude.svg';
import gemini from '../assets/model-logos/gemini.svg';
import deepseek from '../assets/model-logos/deepseek.svg';
import qwen from '../assets/model-logos/qwen.svg';
import kimi from '../assets/model-logos/kimi.svg';
import glm from '../assets/model-logos/z-ai.svg';
import doubao from '../assets/model-logos/doubao.svg';
import grok from '../assets/model-logos/grok.svg';

const logos: Record<string, string> = { dsh: deepseek, qodercn, codex: openai, openai, claude, gemini, deepseek, qwen, kimi, glm, doubao, grok };
export default function BotAvatar({ avatar, connection, model = '', name }: {
  avatar?: string; connection?: BotConnection; model?: string; name: string;
}) {
  const provider = connection?.kind === 'cli' ? connection.agent : connection?.kind === 'api' ? apiBotPresetForUrl(connection.baseUrl)?.id : undefined;
  const modelBrand = /claude|anthropic/i.test(model) ? 'claude' : /gpt|openai|^o[134]/i.test(model) ? 'openai'
    : /gemini|google/i.test(model) ? 'gemini' : /deepseek/i.test(model) ? 'deepseek' : /qwen/i.test(model) ? 'qwen'
    : /kimi|moonshot/i.test(model) ? 'kimi' : /glm|z-ai/i.test(model) ? 'glm' : /doubao/i.test(model) ? 'doubao' : /grok/i.test(model) ? 'grok' : '';
  const source = avatar || logos[provider ?? ''] || logos[modelBrand];
  return source ? <img className={`bot-avatar${avatar ? "" : " bot-avatar-logo"}`} src={source} alt="" /> : <span className="bot-avatar bot-avatar-fallback" aria-hidden="true">{name.trim().slice(0, 1) || 'B'}</span>;
}

export async function readBotAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Invalid avatar');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to read avatar');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
    return canvas.toDataURL('image/png');
  } finally { bitmap.close(); }
}
