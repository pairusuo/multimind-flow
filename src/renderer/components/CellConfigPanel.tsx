import AppSelect from './AppSelect';
import AppUpdatePanel from './AppUpdatePanel';
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findPresetSiteByUrl, inferModeFromUrl, PRESET_SITES } from '../../shared/presetSites';
import { getRiskySiteReasonKey } from '../../shared/riskySites';
import { AppLanguage, CellMode, ConversationEntryMode, LAYOUT_CELLS, LayoutMode, ThemeMode } from '../../shared/types';
import { LayoutIcon, WorkspaceIcon } from './WorkspaceIcon';

interface CellConfigPanelProps {
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  language: AppLanguage;
  conversationEntryMode: ConversationEntryMode;
  forwardControlsEnabled: boolean;
  layoutMode: LayoutMode;
  themeMode: ThemeMode;
  onClose: () => void;
  onLayoutChange: (mode: LayoutMode) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onConversationEntryModeChange: (mode: ConversationEntryMode) => void;
  onForwardControlsEnabledChange: (enabled: boolean) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onOpenMemory: () => void;
  onSave: (
    nextUrls: Record<string, string>,
    nextModes: Record<string, CellMode>,
    nextSearchTemplates: Record<string, string>,
  ) => void;
}

export default function CellConfigPanel({
  cellUrls,
  cellModes,
  searchUrlTemplates,
  language,
  conversationEntryMode,
  forwardControlsEnabled,
  layoutMode,
  themeMode,
  onClose,
  onLayoutChange,
  onLanguageChange,
  onConversationEntryModeChange,
  onForwardControlsEnabledChange,
  onThemeModeChange,
  onOpenMemory,
  onSave,
}: CellConfigPanelProps) {
  const { t } = useTranslation();
  const visibleCells = LAYOUT_CELLS[layoutMode];
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>(() => ({ ...cellUrls }));
  const [draftModes, setDraftModes] = useState<Record<string, CellMode>>(() => ({ ...cellModes }));
  const [draftSearchTemplates, setDraftSearchTemplates] = useState<Record<string, string>>(() => ({
    ...searchUrlTemplates,
  }));
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    void window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  function updateDraftUrl(cellId: string, nextUrl: string) {
    const inferredMode = inferModeFromUrl(nextUrl);
    const matchedPreset = findPresetSiteByUrl(nextUrl);

    setDraftUrls((current) => ({
      ...current,
      [cellId]: nextUrl,
    }));

    if (inferredMode === 'unknown') {
      const previousUrl = draftUrls[cellId] ?? '';
      const previousWasUnknown = previousUrl.trim() !== '' && inferModeFromUrl(previousUrl) === 'unknown';
      setDraftModes((current) => ({
        ...current,
        [cellId]: previousWasUnknown ? current[cellId] ?? 'chat' : 'chat',
      }));
      if (!previousWasUnknown) {
        setDraftSearchTemplates((current) => ({
          ...current,
          [cellId]: '',
        }));
      }
      return;
    }

    setDraftModes((current) => ({
      ...current,
      [cellId]: inferredMode,
    }));
    setDraftSearchTemplates((current) => ({
      ...current,
      [cellId]: matchedPreset?.searchUrlTemplate ?? '',
    }));
  }

  function shouldShowSearchModeToggle(cellId: string): boolean {
    const url = draftUrls[cellId]?.trim() ?? '';
    return url !== '' && inferModeFromUrl(url) === 'unknown';
  }

  function getSelectedPresetId(cellId: string): string {
    return findPresetSiteByUrl(draftUrls[cellId] ?? '')?.id ?? 'custom';
  }


  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftUrls, draftModes, draftSearchTemplates);
  }

  return (
    <div className="modal-backdrop">
      <form className="cell-config-panel" data-language={language} aria-label={t('cellConfig.aria.panel')} onSubmit={handleSubmit}>
        <header className="panel-header">
          <div className="settings-heading">
            <span className="settings-heading-icon"><WorkspaceIcon name="settings" /></span>
            <div><h1>{t('cellConfig.title')}</h1><p>{t('settings.description')}</p></div>
          </div>
          <button type="button" aria-label={t('cellConfig.actions.close')} onClick={onClose}>
            <WorkspaceIcon name="close" />
          </button>
        </header>
        <section className="settings-section" aria-label={t('settings.title')}>
          <h2 className="settings-group-title"><LayoutIcon mode={layoutMode} />{t('settings.groups.workspace')}</h2>
          <span className="settings-section-label">{t('settings.layout.label')}</span>
          <div className="settings-segmented-control settings-layout-control" role="radiogroup" aria-label={t('settings.layout.label')}>
            {LAYOUT_OPTIONS.map((option) => (
              <label key={option.mode} className={layoutMode === option.mode ? 'active' : ''} title={t(option.titleKey)}>
                <input
                  type="radio"
                  name="workspace-layout"
                  value={option.mode}
                  checked={layoutMode === option.mode}
                  onChange={() => onLayoutChange(option.mode)}
                />
                <LayoutIcon mode={option.mode} />
                <span className="sr-only">{t(option.titleKey)}</span>
              </label>
            ))}
          </div>
          <h2 className="settings-group-title"><WorkspaceIcon name="appearance" />{t('settings.groups.appearance')}</h2>
          <span className="settings-section-label">{t('settings.theme.label')}</span>
          <div className="settings-segmented-control settings-theme-control" role="radiogroup" aria-label={t('settings.theme.label')}>
            {(['system', 'light', 'dark'] as const).map((option) => (
              <label key={option} className={themeMode === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="theme-mode"
                  value={option}
                  checked={themeMode === option}
                  onChange={() => onThemeModeChange(option)}
                />
                <WorkspaceIcon name={option === 'light' ? 'sun' : option === 'dark' ? 'moon' : 'system'} />
                <span>{t(`settings.theme.options.${option}`)}</span>
              </label>
            ))}
          </div>
          <span className="settings-section-label">{t('settings.language.label')}</span>
          <div className="settings-segmented-control settings-language-control" role="radiogroup" aria-label={t('settings.language.label')}>
            {(['zh', 'en'] as const).map((option) => (
              <label key={option} className={language === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="app-language"
                  value={option}
                  checked={language === option}
                  onChange={() => onLanguageChange(option)}
                />
                <span>{t(`settings.language.options.${option}`)}</span>
              </label>
            ))}
          </div>
          <h2 className="settings-group-title"><WorkspaceIcon name="chat" />{t('settings.groups.discussion')}</h2>
          <span className="settings-section-label">{t('settings.conversationEntry.label')}</span>
          <div className="settings-segmented-control settings-entry-control" role="radiogroup" aria-label={t('settings.conversationEntry.label')}>
            {(['embedded', 'api'] as const).map((option) => (
              <label key={option} className={conversationEntryMode === option ? 'active' : ''}>
                <input
                  type="radio"
                  name="conversation-entry-mode"
                  value={option}
                  checked={conversationEntryMode === option}
                  onChange={() => onConversationEntryModeChange(option)}
                />
                <span>{t(`settings.conversationEntry.options.${option}`)}</span>
              </label>
            ))}
          </div>
          <span className="settings-section-label">{t('settings.memory.label')}</span>
          <button type="button" className="settings-memory-button" onClick={onOpenMemory}>
            <WorkspaceIcon name="memory" />
            <span>{t('settings.memory.open')}</span>
          </button>
          <span className="settings-section-label">{t('settings.forward.toggle')}</span>
          <div className="settings-forward-control">
            <label className="settings-forward-toggle" aria-label={t('settings.forward.toggle')}>
              <input
                type="checkbox"
                role="switch"
                checked={forwardControlsEnabled}
                onChange={(event) => onForwardControlsEnabledChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>
            <span className="settings-forward-hint">{t('settings.forward.hint')}</span>
          </div>
        </section>
        {conversationEntryMode !== 'api' && (
          <div className="cell-config-list">
            <h2 className="settings-group-title"><WorkspaceIcon name="globe" />{t('settings.groups.sites')}</h2>
            {visibleCells.map((cellId, index) => (
              <CellConfigRow
                key={cellId}
                cellId={cellId}
                index={index}
                draftUrl={draftUrls[cellId] ?? ''}
                draftMode={draftModes[cellId] ?? 'chat'}
                draftSearchTemplate={draftSearchTemplates[cellId] ?? ''}
                selectedPresetId={getSelectedPresetId(cellId)}
                showSearchModeToggle={shouldShowSearchModeToggle(cellId)}
                onDraftUrlChange={updateDraftUrl}
                onDraftModeChange={(nextMode) => {
                  setDraftModes((current) => ({
                    ...current,
                    [cellId]: nextMode,
                  }));
                  if (nextMode === 'search' && !draftSearchTemplates[cellId]) {
                    setDraftSearchTemplates((current) => ({
                      ...current,
                      [cellId]: 'https://www.google.com/search?q={query}',
                    }));
                  }
                }}
                onSearchTemplateChange={(nextTemplate) =>
                  setDraftSearchTemplates((current) => ({
                    ...current,
                    [cellId]: nextTemplate,
                  }))
                }
              />
            ))}
          </div>
        )}
        <AppUpdatePanel />
        <footer className="panel-actions">
          <span className="app-version">
            {appVersion ? t('settings.version.value', { version: appVersion }) : t('settings.version.loading')}
          </span>
          <button type="button" onClick={onClose}>
            {t('cellConfig.actions.cancel')}
          </button>
          <button type="submit">{t('cellConfig.actions.confirm')}</button>
        </footer>
      </form>
    </div>
  );
}

const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; titleKey: string }> = [
  { mode: 'single', titleKey: 'settings.layout.options.single' },
  { mode: 'horizontal', titleKey: 'settings.layout.options.horizontal' },
  { mode: 'vertical', titleKey: 'settings.layout.options.vertical' },
  { mode: 'triple', titleKey: 'settings.layout.options.triple' },
  { mode: 'quad', titleKey: 'settings.layout.options.quad' },
];

interface CellConfigRowProps {
  cellId: string;
  index: number;
  draftUrl: string;
  draftMode: CellMode;
  draftSearchTemplate: string;
  selectedPresetId: string;
  showSearchModeToggle: boolean;
  onDraftUrlChange: (cellId: string, nextUrl: string) => void;
  onDraftModeChange: (nextMode: CellMode) => void;
  onSearchTemplateChange: (nextTemplate: string) => void;
}

function CellConfigRow({
  cellId,
  index,
  draftUrl,
  draftMode,
  draftSearchTemplate,
  selectedPresetId,
  showSearchModeToggle,
  onDraftUrlChange,
  onDraftModeChange,
  onSearchTemplateChange,
}: CellConfigRowProps) {
  const { t } = useTranslation();
  const riskReasonKey = getRiskySiteReasonKey(draftUrl);

  return (
    <section className="cell-config-row">
      <span>{t('cellConfig.cell.label', { index: index + 1 })}</span>
      <AppSelect className="preset-select" hideLabel label={t('cellConfig.cell.label', { index: index + 1 })}
        value={selectedPresetId}
        options={[...['chat', 'search'].flatMap(mode => PRESET_SITES.filter(site => site.mode === mode).map(site => ({ value: site.id, label: site.name, group: t(`cellConfig.groups.${mode}`) }))), { value: 'custom', label: t('cellConfig.customUrl') }]}
        onChange={(value) => { const preset = PRESET_SITES.find(site => site.id === value); onDraftUrlChange(cellId, preset ? preset.url : ''); }} />
      <input
        value={draftUrl}
        onChange={(event) => onDraftUrlChange(cellId, event.target.value)}
        placeholder="https://example.com"
        spellCheck={false}
      />
      {showSearchModeToggle && (
        <label className="search-mode-toggle">
          <input
            type="checkbox"
            checked={draftMode === 'search'}
            onChange={(event) => onDraftModeChange(event.target.checked ? 'search' : 'chat')}
          />
          {t('cellConfig.searchModeToggle')}
        </label>
      )}
      {showSearchModeToggle && draftMode === 'search' && (
        <input
          className="search-template-input"
          value={draftSearchTemplate}
          onChange={(event) => onSearchTemplateChange(event.target.value)}
          placeholder="https://example.com/search?q={query}"
          spellCheck={false}
        />
      )}
      {riskReasonKey && <p className="risk-warning">{t(riskReasonKey)}</p>}
    </section>
  );
}
