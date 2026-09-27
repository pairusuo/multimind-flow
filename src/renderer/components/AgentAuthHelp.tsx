import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL_AGENTS } from '../../shared/botCatalog';
import type { BotConnection } from '../../shared/types';

export default function AgentAuthHelp({ source, connection }: { source?: string; connection?: BotConnection }) {
  const { t } = useTranslation();
  // Prefer the failed request's source over a Bot configuration edited afterwards.
  const agent = source ? LOCAL_AGENTS.find(item => item.name === source) : connection?.kind === 'cli' ? LOCAL_AGENTS.find(item => item.id === connection.agent) : undefined;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  if (!agent) return <p>{t('botChat.runtime.authHelp.unknown')}</p>;
  const configure = 'setupKind' in agent && agent.setupKind === 'configure';
  const interactive = agent.loginArgs.length === 0;
  const command = [agent.command, ...agent.loginArgs].join(' ');
  async function open() {
    if (!agent) return;
    setBusy(true); setNotice('');
    try {
      const executable = connection?.kind === 'cli' && connection.agent === agent.id ? connection.executable : undefined;
      const result = await window.electronAPI.setupLocalAgent(agent.id, 'login', executable);
      setNotice(t(`botChat.runtime.authHelp.${result.status === 'authenticated' ? 'already' : 'opened'}`));
    } catch { setNotice(t('botChat.runtime.authHelp.openFailed')); }
    finally { setBusy(false); }
  }
  return <div className="bot-auth-help">
    <p>{t(`botChat.runtime.authHelp.${configure ? 'configure' : interactive ? 'interactive' : 'login'}`, { name: agent.name })}</p>
    <code>{command}</code>
    <div className="bot-auth-help-actions">
      <button type="button" className="bot-chat-secondary-button" disabled={busy} onClick={() => void open()}>{t(configure ? 'botChat.runtime.configure' : 'botChat.runtime.login')}</button>
      <button type="button" className="bot-chat-secondary-button" onClick={() => void navigator.clipboard.writeText(command).then(() => setNotice(t('botChat.runtime.authHelp.copied'))).catch(() => setNotice(t('botChat.runtime.authHelp.copyFailed')))}>{t('botChat.runtime.authHelp.copy')}</button>
    </div>
    <p>{t('botChat.runtime.authHelp.retry')}</p>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
