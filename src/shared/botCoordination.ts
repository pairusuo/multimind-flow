import type { ConversationMember } from './types';

export function mentionLabel(member: ConversationMember, members: ConversationMember[]): string {
  return (['全体', 'everyone'].includes(member.name) || members.filter(item => item.name === member.name).length > 1) ? `${member.name}[${member.botId}]` : member.name;
}
const boundary = (char: string | undefined) => !char || /[\s,，。.!！?？:：;；、()（）]/u.test(char);
export function mentionRecipients(content: string, members: ConversationMember[]): string[] | null {
  const text = content.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`|^\s*>.*$|!?\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/gm, ' ');
  const selected = new Set<string>();
  let everyone = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '@' || !boundary(text[index - 1])) continue;
    const rest = text.slice(index + 1);
    const all = ['全体', 'everyone'].find(name => rest.startsWith(name) && boundary(rest[name.length]));
    if (all) { everyone = true; index += all.length; continue; }
    const member = [...members].sort((a, b) => mentionLabel(b, members).length - mentionLabel(a, members).length)
      .find(item => { const name = mentionLabel(item, members); return rest.startsWith(name) && boundary(rest[name.length]); });
    if (!member) throw new Error('MENTION_NOT_FOUND');
    selected.add(member.botId); index += mentionLabel(member, members).length;
  }
  return everyone ? members.map(member => member.botId) : selected.size ? [...selected] : null;
}

export const MAX_COORDINATION_WORKERS = 6;
export interface CoordinationPlan { mode: 'direct' | 'parallel' | 'sequential'; tasks: { botId: string; instruction: string }[] }
export function parseCoordinationPlan(text: string, members: ConversationMember[], leadId: string): CoordinationPlan {
  if (text.length > 16000) throw new Error('Coordination plan is too long');
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
  if (!value || !['direct', 'parallel', 'sequential'].includes(value.mode) || !Array.isArray(value.tasks)
      || value.tasks.length > MAX_COORDINATION_WORKERS || (value.mode === 'direct') !== (value.tasks.length === 0)) throw new Error('Invalid coordination plan');
  const ids = new Set<string>();
  for (const task of value.tasks) {
    if (!task || typeof task.botId !== 'string' || ids.has(task.botId)
        || !members.some(member => member.botId === task.botId) || typeof task.instruction !== 'string'
        || !task.instruction.trim() || task.instruction.length > 4000) throw new Error('Invalid coordination task');
    ids.add(task.botId);
  }
  return value as CoordinationPlan;
}
