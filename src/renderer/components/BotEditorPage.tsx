import AppSelect from './AppSelect';
import BotAvatar, { readBotAvatar } from './BotAvatar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOT_GUIDE_LINKS, type BotGuideLink, API_BOT_PRESETS, DEFAULT_BOT_OUTPUT_TOKENS, apiBotPresetForUrl, LOCAL_AGENTS, localAgent, type LocalAgentId } from '../../shared/botCatalog';
import { discoverLocalAgents, localAgentSnapshot } from '../services/localAgentDiscovery';
import type { Bot, BotConnection, LocalAgentStatus, TestBotApiResult } from '../../shared/types';

export default function BotEditorPage({ bot, onClose, onSaved }: {
  bot?: Bot; onClose: () => void; onSaved: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<'cli' | 'api'>('cli');
  const [agent, setAgent] = useState<LocalAgentId>('codex');
  const [avatar, setAvatar] = useState(bot?.avatar ?? '');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [rolePrompt, setRolePrompt] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState(DEFAULT_BOT_OUTPUT_TOKENS);
  const [customModel, setCustomModel] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(API_BOT_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestBotApiResult['status'] | null>(null);
  const testVersion = useRef(0);
  useEffect(() => { ++testVersion.current; setTestResult(null); setTesting(false); return () => { ++testVersion.current; }; }, [baseUrl, apiKey, model, kind, bot?.id]);
  async function testConnection() {
    const version = ++testVersion.current;
    setTesting(true); setTestResult(null);
    try {
      const result = await window.electronAPI.testBotApi({ baseUrl, apiKey: apiKey || undefined, model, botId: bot?.id });
      if (version === testVersion.current) setTestResult(result.status);
    } catch (cause) {
      if (version === testVersion.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setTestResult(/No handler registered|conversation-test-bot-api/i.test(message) ? 'restart' : 'failed');
      }
    }
    finally { if (version === testVersion.current) setTesting(false); }
  }

  const savedLocalConnection = bot?.connection?.kind === 'cli' && bot.connection.agent === agent ? bot.connection : undefined;
  const executable = savedLocalConnection?.executable;
  const [status, setStatus] = useState<Partial<Record<LocalAgentId, LocalAgentStatus>>>(localAgentSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [failedAgents, setFailedAgents] = useState<LocalAgentId[]>([]);
  const [settingUp, setSettingUp] = useState(false);
  const [setupNotice, setSetupNotice] = useState('');
  const [installationOpened, setInstallationOpened] = useState<LocalAgentId[]>([]);
  const detectionVersion = useRef(0);
  const initialSelection = useRef(true);
  const editing = bot;
  useEffect(() => { if (bot) { initialSelection.current = false; edit(bot); } }, [bot]);
  const preset = localAgent(agent);
  const apiPreset = apiBotPresetForUrl(baseUrl);
  const apiModels = apiPreset?.models ?? [];
  function guideText(item: string) {
    const text = t(`botChat.connectionGuide.${item}`, { baseUrl: API_BOT_PRESETS.find((preset) => preset.id === item)?.baseUrl ?? '' });
    const url = BOT_GUIDE_LINKS[item as BotGuideLink];
    const label = url?.replace('https://', '');
    if (!label || !text.includes(label)) return text;
    const [before, after] = text.split(label);
    return <>{before}<a href={url} onClick={(event) => {
      event.preventDefault();
      void window.electronAPI.openBotGuide(item as BotGuideLink).catch(() => setError(t('botChat.runtime.linkError')));
    }}>{label}</a>{after}</>;
  }

  async function detect(force = false) {
    const version = ++detectionVersion.current;
    setError(null);
    try {
      const result = await discoverLocalAgents(agent, executable, force, () => {
        if (version === detectionVersion.current) setDetecting(true);
      });
      if (version !== detectionVersion.current) return;
      setStatus(result.statuses);
      setFailedAgents(result.failedAgents ?? []);
      if (result.failed) setError(t(result.restartRequired ? 'botChat.runtime.restartDetection' : result.cacheReadFailed ? 'botChat.runtime.cacheReadError' : 'botChat.runtime.detectError'));
      setInstallationOpened((previous) => previous.filter((id) => !result.statuses[id]?.installed || result.statuses[id]?.usable === false));
      if (initialSelection.current && !editingId) {
        const combined = result.statuses;
        const available = LOCAL_AGENTS.find((item) => combined[item.id]?.installed && combined[item.id]?.usable !== false);
        if (available) setAgent(available.id);
        initialSelection.current = false;
      }
    } catch { setError(t('botChat.runtime.detectError')); }
    finally { if (version === detectionVersion.current) setDetecting(false); }
  }
  useEffect(() => {
    void detect();
    return () => { ++detectionVersion.current; };
  }, [agent, executable]);

  function edit(bot: Bot) {
    const connection: BotConnection = bot.connection?.kind === 'api' || bot.connection?.kind === 'cli'
      ? bot.connection : { kind: 'api', baseUrl: API_BOT_PRESETS[0].baseUrl };
    setAvatar(bot.avatar ?? ''); setEditingId(bot.id); setKind(connection.kind); setName(bot.name); setModel(bot.model); setRolePrompt(bot.rolePrompt); setApiKey(''); setError(null);
    if (connection.kind === 'cli') setAgent(connection.agent);
    if (connection.kind === 'api') {
      setBaseUrl(connection.baseUrl);
      setMaxOutputTokens(connection.maxOutputTokens ?? DEFAULT_BOT_OUTPUT_TOKENS);
      setCustomModel(!apiBotPresetForUrl(connection.baseUrl)?.models.includes(bot.model));
    }
  }
  async function submit() {
    setBusy(true); setError(null);
    try {
      const connection: BotConnection = kind === 'cli' ? { kind, agent, executable: executable || undefined, cwd: savedLocalConnection?.cwd } : { kind, baseUrl, maxOutputTokens };
      const payload = { avatar, name: name.trim() || (kind === 'cli' ? preset.name : model), model, rolePrompt, connection, apiKey: apiKey || undefined };
      if (editingId) await window.electronAPI.updateBot({ ...payload, id: editingId });
      else await window.electronAPI.createBot(payload);
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function setup(action: 'install' | 'login' | 'docs', target: LocalAgentId = agent) {
    if (settingUp) return;
    setSettingUp(true); setError(null); setSetupNotice('');
    try {
      const result = await window.electronAPI.setupLocalAgent(target, action, target === agent ? executable || undefined : undefined);
      if (result.status === 'authenticated') {
        setStatus((previous) => ({ ...previous, [target]: result.agentStatus }));
        setSetupNotice(t('botChat.runtime.loginReused'));
      } else {
        if (action === 'install') setInstallationOpened((previous) => [...new Set([...previous, target])]);
        if (action === 'login') setSetupNotice(t('botChat.runtime.setupOpened'));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSettingUp(false); }
  }

  const installCommand = navigator.platform.toLowerCase().includes('win') && 'installWindows' in preset ? preset.installWindows : preset.install;
  const savedKey = editing?.connection?.kind === 'api' && editing.connection.baseUrl === baseUrl.replace(/\/+$/, '') && editing.connection.credentialId;
  return <div className="bot-content-page">
    <div className="bot-chat-modal bot-chat-modal-wide bot-manager bot-editor" role="region" aria-label={t(editingId ? 'botChat.bots.editTitle' : 'botChat.bots.createTitle')}>
      <h3>{t(editingId ? 'botChat.bots.editTitle' : 'botChat.bots.createTitle')}</h3>
      <p className="bot-chat-modal-hint">{t('botChat.runtime.intro')}</p>
      <details className="bot-agent-help">
        <summary>{t('botChat.connectionGuide.title')}</summary>
        <p className="bot-chat-modal-hint">{guideText('choice')}</p>
        <h4>{t('botChat.runtime.local')}</h4>
        {(['codex', 'claude', 'gemini', 'qwenCode', 'kimiCode', 'qoder', 'dsh', 'qoderInternational'] as const).map((item) => <p className="bot-chat-modal-hint" key={item}>{guideText(item)}</p>)}
        <h4>{t('botChat.runtime.api')}</h4>
        {API_BOT_PRESETS.map((item) => <p className="bot-chat-modal-hint" key={item.id}>{guideText(item.id)}</p>)}
        <p className="bot-chat-modal-hint">{guideText('billing')}</p>
      </details>
      <div className="bot-chat-bot-form">
        <div className="bot-runtime-tabs" role="group" aria-label={t('botChat.runtime.connection')}>
          <button className={kind === 'cli' ? 'bot-chat-primary-button' : 'bot-chat-secondary-button'} onClick={() => { setKind('cli'); setModel(''); }}>{t('botChat.runtime.local')}</button>
          <button className={kind === 'api' ? 'bot-chat-primary-button' : 'bot-chat-secondary-button'} onClick={() => { setKind('api'); setModel(apiModels[0] ?? ''); setCustomModel(false); }}>{t('botChat.runtime.api')}</button>
          {kind === 'cli' && <button className="bot-chat-secondary-button" disabled={detecting} onClick={() => void detect(true)}>{t(detecting ? 'botChat.runtime.checking' : 'botChat.runtime.refresh')}</button>}
        </div>
        {kind === 'cli' ? <>
          {(['available', 'unavailable'] as const).map((group) => <section key={group} className="bot-agent-section" data-agent-group={group}>
            <h4>{t(`botChat.runtime.${group}`)}</h4>
            {group === 'available' && !LOCAL_AGENTS.some((item) => status[item.id]?.installed) && <p className="bot-chat-modal-hint">{t(detecting ? 'botChat.runtime.checking' : Object.keys(status).length === 0 ? 'botChat.runtime.notChecked' : 'botChat.runtime.noneInstalled')}</p>}
            <div className="bot-agent-grid">{LOCAL_AGENTS.filter((item) => group === 'available' ? status[item.id]?.installed : !status[item.id]?.installed).map((item) => <div key={item.id} className={`bot-agent-card${agent === item.id ? ' selected' : ''}`}>
              <button className="bot-agent-select" aria-pressed={agent === item.id} onClick={() => { initialSelection.current = false; setAgent(item.id); setModel(''); setSetupNotice(''); }}>
                <strong>{item.name}</strong>
                <span>{failedAgents.includes(item.id) ? t('botChat.runtime.checkFailed') : !status[item.id] ? t(detecting ? 'botChat.runtime.checking' : 'botChat.runtime.notChecked') : !status[item.id]?.installed ? t('botChat.runtime.missing') : status[item.id]?.usable === false ? t('botChat.runtime.broken') : t('botChat.runtime.installed')}</span>
              </button>
              {status[item.id] && !status[item.id]?.installed && <>
                <button className={installationOpened.includes(item.id) ? 'bot-chat-secondary-button' : 'bot-chat-primary-button'} disabled={settingUp} onClick={() => void setup('install', item.id)}>{t(installationOpened.includes(item.id) ? 'botChat.runtime.rerunInstall' : 'botChat.runtime.install')}</button>
                {installationOpened.includes(item.id) && <p className="bot-chat-modal-hint" role="status">{t('botChat.runtime.installTerminalOpened')}</p>}
              </>}
            </div>)}</div>
          </section>)}
          <div className="bot-agent-setup">
            <strong>{preset.name}</strong>
            <div className="bot-agent-actions">
              {status[agent]?.installed && !status[agent]?.authenticated && <button className="bot-chat-secondary-button" disabled={detecting || settingUp} onClick={() => void setup('login')}>{t('setupKind' in preset ? 'botChat.runtime.configure' : 'botChat.runtime.login')}</button>}
              {status[agent]?.usable === false && <button className="bot-chat-secondary-button" onClick={() => void setup('install')}>{t('botChat.runtime.repair')}</button>}
            </div>
            <details key={agent} className="bot-agent-help">
              <summary>{t('botChat.runtime.installHelp')}</summary>
              <p className="bot-chat-modal-hint">{t('botChat.runtime.installHint')}</p>
              <code>{installCommand}</code>
              <div className="bot-agent-actions">
                <button className="bot-chat-secondary-button" onClick={() => void setup('docs')}>{t('botChat.runtime.docs')}</button>
                <button className="bot-chat-secondary-button" onClick={() => void navigator.clipboard.writeText(installCommand).catch(() => setError(t('botChat.runtime.copyFailed')))}>{t('botChat.runtime.copyInstall')}</button>
              </div>
            </details>
            {setupNotice && <p role="status">{setupNotice}</p>}
            {status[agent]?.usable && <p role="status">{t('setupKind' in preset ? 'botChat.runtime.configuredLocally' : status[agent]?.authenticated ? `botChat.runtime.auth.${status[agent]?.authMethod}` : status[agent]?.authChecked ? 'botChat.runtime.auth.required' : 'botChat.runtime.auth.unconfirmed')}</p>}
          </div>
        </> : <>
          <AppSelect className="bot-provider-select" label={t('botChat.runtime.provider')} value={apiPreset?.id ?? 'custom'}
            options={[{ value: 'custom', label: t('botChat.runtime.custom') }, ...API_BOT_PRESETS.map(item => ({ value: item.id, label: item.name }))]}
            onChange={(value) => { const item = API_BOT_PRESETS.find(item => item.id === value); setBaseUrl(item?.baseUrl ?? ''); setModel(item?.models[0] ?? ''); setCustomModel(false); setApiKey(''); }} />
          <label>{t('settings.apiConversation.baseUrl')}<input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setApiKey(''); setModel(''); setCustomModel(false); }} /></label>
          <label>{t('settings.apiConversation.apiKey')}<input type="password" autoComplete="off" value={apiKey} placeholder={t(savedKey ? 'settings.apiConversation.apiKeyConfigured' : 'settings.apiConversation.apiKeyPlaceholder')} onChange={(event) => setApiKey(event.target.value)} /></label>
          <p className="bot-chat-modal-hint">{t('botChat.runtime.apiHint')}</p>
        </>}
        <div className="bot-avatar-editor">
          <BotAvatar avatar={avatar} name={name || preset.name} model={model} connection={kind === 'cli' ? { kind, agent } : kind === 'api' ? { kind, baseUrl } : { kind }} />
          <input ref={avatarInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            setAvatarLoading(true);
            try { setAvatar(await readBotAvatar(file)); setError(null); }
            catch { setError(t('botChat.bots.avatarError')); }
            finally { setAvatarLoading(false); }
          }} />
          <button type="button" className="bot-chat-secondary-button" disabled={avatarLoading} onClick={() => avatarInput.current?.click()}>{t('botChat.bots.chooseAvatar')}</button>
          {avatar && <button type="button" className="bot-chat-secondary-button" onClick={() => setAvatar('')}>{t('botChat.bots.resetAvatar')}</button>}
        </div>
        <label>{t('botChat.bots.name')}<input value={name} placeholder={kind === 'cli' ? preset.name : model} onChange={(event) => setName(event.target.value)} /></label>
        {kind === 'api' && apiModels.length > 0 ? <>
          <AppSelect className="bot-model-select" label={t('botChat.bots.model')} value={customModel ? '__custom__' : model} placeholder={t('botChat.bots.modelPlaceholder')}
            options={[...apiModels.map((item) => ({ value: item, label: item })), { value: '__custom__', label: t('botChat.runtime.customModel') }]}
            onChange={(value) => { const custom = value === '__custom__'; setCustomModel(custom); setModel(custom ? '' : value); }} />
          {customModel && <label>{t('botChat.runtime.customModel')}<input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('botChat.bots.modelPlaceholder')} /></label>}
        </> : <label>{t('botChat.bots.model')}{kind === 'cli' && ` (${t('botChat.runtime.optional')})`}<input value={model} placeholder={t(kind === 'cli' ? 'botChat.runtime.defaultModel' : 'botChat.bots.modelPlaceholder')} onChange={(event) => setModel(event.target.value)} /></label>}

        {kind === 'api' && <label>{t('botChat.runtime.outputLimit')}<input type="number" min={1} max={32768} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(Number(event.target.value))} /></label>}
        <label>{t('botChat.bots.rolePrompt')}<textarea placeholder={t('botChat.bots.rolePromptPlaceholder')} rows={3} value={rolePrompt} onChange={(event) => setRolePrompt(event.target.value)} /></label>
      </div>
      {kind === 'api' && <div className="bot-api-test">
        <p className="bot-chat-modal-hint">{t('botChat.apiTest.hint')}</p>
        {testResult && <p role="status" className={testResult === 'success' ? '' : 'bot-chat-error'}>{t(`botChat.apiTest.${testResult}`)}</p>}
      </div>}
      {error && <div className="bot-chat-error" role="alert">{error}</div>}
      <div className="bot-chat-modal-actions">
        <button className="bot-chat-secondary-button" disabled={busy} onClick={onClose}>{t('botChat.actions.cancel')}</button>
        {kind === 'api' && <button className="bot-chat-secondary-button" disabled={busy || testing || !baseUrl.trim() || !model.trim() || (!apiKey.trim() && !savedKey)} onClick={() => void testConnection()}>{t(testing ? 'botChat.apiTest.testing' : 'botChat.apiTest.button')}</button>}
        <button className="bot-chat-primary-button" disabled={testing || busy || avatarLoading || (kind === 'cli' && (!status[agent]?.installed || status[agent]?.usable === false)) || (kind !== 'cli' && !model.trim()) || (kind === 'api' && (!baseUrl.trim() || (!apiKey.trim() && !savedKey) || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32768))} onClick={() => void submit()}>{t(editingId ? 'botChat.actions.save' : 'botChat.actions.create')}</button>
      </div>
    </div>
  </div>;
}
