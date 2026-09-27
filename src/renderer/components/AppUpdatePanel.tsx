import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppUpdateAction, AppUpdateState } from '../../shared/types';

export default function AppUpdatePanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<AppUpdateState>({ status: 'idle', canInstall: false, autoCheck: false });
  const [savingPreference, setSavingPreference] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    const refresh = () => window.electronAPI.appUpdate('state').then(next => { if (!disposed) setState(next); }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const act = async (action: AppUpdateAction) => {
    const preference = action === 'enable-auto-check' || action === 'disable-auto-check';
    if (preference) setSavingPreference(true);
    setError(undefined);
    if (action === 'check') setState(current => ({ ...current, status: 'checking' }));
    try {
      const next = await window.electronAPI.appUpdate(action);
      setState(next);
      if (next.error) setError(next.error);
    } catch { setError('network'); } finally { setSavingPreference(false); }
  };
  return <section className="app-update-panel" aria-label={t('updates.title')}>
    <strong>{t('updates.title')}</strong>
    <label className="app-update-preference"><input type="checkbox" checked={state.autoCheck} disabled={savingPreference} onChange={event => void act(event.target.checked ? 'enable-auto-check' : 'disable-auto-check')} />{t('updates.autoCheck')}</label>
    {state.status !== 'idle' && <span role="status">{t(`updates.${state.status}`, { version: state.version, progress: state.progress ?? 0 })}</span>}
    {error && <span role="alert">{t(`updates.errors.${error}`)}</span>}
    <div className="bot-chat-form-actions">
      {!['checking', 'downloading', 'ready'].includes(state.status) && <button type="button" onClick={() => void act('check')}>{t('updates.check')}</button>}
      {state.status === 'available' && <button type="button" onClick={() => void act(state.canInstall ? 'download' : 'releases')}>{t(state.canInstall ? 'updates.download' : 'updates.releases')}</button>}
      {state.status === 'ready' && <button type="button" onClick={() => void act('install')}>{t('updates.install')}</button>}
    </div>
  </section>;
}
