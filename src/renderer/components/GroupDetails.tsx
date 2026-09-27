import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation, UpdateConversationPayload } from '../../shared/types';
import AppSelect from './AppSelect';
import BotAvatar, { readBotAvatar } from './BotAvatar';
import GroupAvatar from './GroupAvatar';

export default function GroupDetails({ conversation, running, onClose, onManage, onSaved }: {
  conversation: Conversation; running: boolean; onClose: () => void; onManage: () => void; onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(conversation.title);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(conversation.title), [conversation.title, conversation.id]);
  async function save(patch: Omit<UpdateConversationPayload, 'id'>) {
    setSaving(true); setError('');
    try { await window.electronAPI.updateConversation({ id: conversation.id, ...patch }); await onSaved(); }
    catch { setError(t('botChat.group.saveError')); }
    finally { setSaving(false); }
  }
  return <aside className="bot-group-details" aria-label={t('botChat.group.details')}>
    <header><h3>{t('botChat.group.details')}</h3><button className="bot-chat-icon-button" onClick={onClose} aria-label={t('botChat.group.close')}>×</button></header>
    <div className="bot-group-member-grid">
      {conversation.members.map(member => <div key={member.botId} className="bot-group-member"><BotAvatar {...member} /><span title={member.name}>{member.name}</span></div>)}
    </div>
    <button className="bot-chat-secondary-button" disabled={running || saving} onClick={onManage}>{t('botChat.actions.manageMembers')}</button>
    <section>
      <label htmlFor="group-name">{t('botChat.group.name')}</label>
      <div className="bot-group-name-editor"><input id="group-name" value={title} maxLength={100} disabled={running || saving} onChange={event => setTitle(event.target.value)} />
        <button className="bot-chat-secondary-button" disabled={running || saving || title.trim() === conversation.title || !title.trim()} onClick={() => void save({ title: title.trim() })}>{t('botChat.group.save')}</button></div>
      <label>{t('botChat.group.avatar')}</label>
      <div className="bot-group-avatar-editor"><GroupAvatar conversation={conversation} /><button className="bot-chat-secondary-button" disabled={running || saving} onClick={() => file.current?.click()}>{t('botChat.group.changeAvatar')}</button>
        {conversation.avatar && <button className="bot-chat-icon-button" disabled={running || saving} onClick={() => void save({ avatar: '' })}>{t('botChat.group.resetAvatar')}</button>}
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async event => {
        const image = event.target.files?.[0]; event.target.value = ''; if (!image) return;
        try { const avatar = await readBotAvatar(image); await save({ avatar }); } catch { setError(t('botChat.group.avatarError')); }
      }} />
    </section>
    <section className="bot-coordination-settings">
      <AppSelect label={t('botChat.coordination.label')} value={conversation.coordinatorId ?? ''} disabled={running || saving}
        options={[{ value: '', label: t('botChat.coordination.off') }, ...conversation.members.map(member => ({ value: member.botId, label: member.name }))]}
        onChange={value => void save({ coordinatorId: value || null })} />
      <p className="bot-chat-modal-hint">{t('botChat.coordination.hint')}</p>
    </section>
    {error && <p className="bot-chat-error" role="alert">{error}</p>}
  </aside>;
}
