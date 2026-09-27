import BotAvatar from './BotAvatar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { botConnectionLabel } from '../../shared/botCatalog';
import type { Bot } from '../../shared/types';

export default function BotManagerPage({ bots, platform, onClose, onChanged, onNewConversation, onCreate, onEdit, onChat }: {
  bots: Bot[]; platform: string; onClose: () => void;
  onChanged: () => void | Promise<unknown>; onNewConversation: () => void;
  onChat: (bot: Bot) => Promise<void>; onCreate: () => void; onEdit: (bot: Bot) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chatting, setChatting] = useState(false);
  async function chat(bot: Bot) {
    if (chatting) return;
    setChatting(true); setError(null);
    try { await onChat(bot); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChatting(false); }
  }
  async function remove(bot: Bot) {
    if (!window.confirm(t('botChat.bots.confirmDelete'))) return;
    setDeleting(true); setError(null);
    try { await window.electronAPI.deleteBot(bot.id); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setDeleting(false); }
  }
  return <div className="bot-content-page">
    <div className="bot-chat-modal bot-chat-modal-wide bot-manager bot-manager-list" role="region" aria-label={t('botChat.bots.title')}>
      <h3>{t('botChat.bots.title')}</h3>
      <div><button className="bot-chat-primary-button" disabled={deleting || chatting} onClick={onCreate}>{t('botChat.bots.createTitle')}</button></div>
      {bots.length === 0 ? <p className="bot-chat-empty-hint">{t('botChat.bots.empty')}</p> : <div className="bot-chat-bot-list">{bots.map((bot) => <div className="bot-chat-bot-item" key={bot.id}>
        <div className="bot-identity"><BotAvatar {...bot} /><div><strong>{bot.name}</strong><span className="bot-chat-bot-item-model">{botConnectionLabel(bot.connection)} · {bot.model || t('botChat.runtime.defaultModel')}</span></div></div>
        <div className="bot-chat-bot-item-actions"><button className="bot-chat-secondary-button" disabled={deleting || chatting} onClick={() => void chat(bot)}>{t('botChat.actions.chatAlone')}</button><button className="bot-chat-secondary-button" disabled={deleting || chatting} onClick={() => onEdit(bot)}>{t('botChat.actions.edit')}</button><button className="bot-chat-secondary-button" disabled={deleting || chatting} onClick={() => void remove(bot)}>{t('botChat.actions.delete')}</button></div>
      </div>)}</div>}
      {error && <div className="bot-chat-error" role="alert">{error}</div>}
      <div className="bot-chat-modal-actions">
        {bots.length > 0 && <button className="bot-chat-primary-button" disabled={deleting || chatting} onClick={onNewConversation}>{t('botChat.actions.newConversation')}</button>}
        <button className="bot-chat-secondary-button" onClick={onClose}>{t('botChat.actions.done')}</button>
      </div>
    </div>
  </div>;
}
