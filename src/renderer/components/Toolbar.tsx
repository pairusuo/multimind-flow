import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRiskySiteReasonKey } from '../../shared/riskySites';
import { CellTab, ConversationEntryMode, LayoutMode } from '../../shared/types';
import { WorkspaceIcon } from './WorkspaceIcon';

interface ToolbarProps {
  conversationEntryMode: ConversationEntryMode;
  currentUrl: string;
  focusedCellId: string;
  tabs: CellTab[];
  activeTabId: string;
  layoutMode: LayoutMode;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onOpenConfig: () => void;
  onNavigate: (url: string) => void;
}

export default function Toolbar({
  conversationEntryMode,
  currentUrl,
  focusedCellId,
  tabs,
  activeTabId,
  layoutMode,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onOpenConfig,
  onNavigate,
}: ToolbarProps) {
  const { t } = useTranslation();
  const [draftUrl, setDraftUrl] = useState(currentUrl);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const addressRiskReasonKey = layoutMode === 'single' ? getRiskySiteReasonKey(draftUrl) : null;
  const addressRiskReason = addressRiskReasonKey ? t(addressRiskReasonKey) : null;
  const isApiMode = conversationEntryMode === 'api';
  const showTabs = layoutMode === 'single' && !isApiMode;

  useEffect(() => {
    setDraftUrl(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    tabRefs.current[activeTabId]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeTabId, tabs.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = draftUrl.trim();
    if (!nextUrl) {
      return;
    }

    onNavigate(nextUrl);
  }

  return (
    <header className={`toolbar${showTabs ? ' toolbar-single' : ''}${isApiMode ? ' toolbar-api-mode' : ''}`}>
      <div className="toolbar-brand" title="MultiMind Flow" aria-label="MultiMind Flow">
        <MultiMindLogo />
      </div>
      {showTabs && (
        <div className="tab-controls" aria-label={t('toolbar.tabs.controls')}>
          <div className="browser-tabs" role="tablist" aria-label={t('toolbar.tabs.openTabs')}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              const fallbackTitle = t('toolbar.tabs.newTab');
              return (
                <div
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[tab.id] = element;
                  }}
                  role="tab"
                  className={`browser-tab${active ? ' active' : ''}`}
                  aria-selected={active}
                  title={tab.title || tab.url || fallbackTitle}
                >
                  <button type="button" className="browser-tab-title" onClick={() => onSwitchTab(tab.id)}>
                    {tab.favicon ? <img className="browser-tab-favicon" src={tab.favicon} alt="" /> : null}
                    <span>{tab.title || tab.url || fallbackTitle}</span>
                  </button>
                  <button
                    type="button"
                    className="browser-tab-close"
                    aria-label={t('toolbar.tabs.closeTab')}
                    disabled={!activeTabId}
                    onClick={() => onCloseTab(tab.id)}
                  >
                    <WorkspaceIcon name="close" />
                  </button>
                </div>
              );
            })}
          </div>
        <button type="button" title={t('toolbar.tabs.newTab')} aria-label={t('toolbar.tabs.newTab')} onClick={onNewTab}>
          <WorkspaceIcon name="plus" />
        </button>
        </div>
      )}
      {isApiMode ? (
        <div className="toolbar-mode-title">{t('toolbar.apiMode.title')}</div>
      ) : (
        <>
          <nav className="navigation-controls" aria-label={t('toolbar.navigation.label')}>
            <button type="button" aria-label={t('toolbar.navigation.back')} onClick={() => window.electronAPI.navigateBack(focusedCellId)}>
              <WorkspaceIcon name="back" />
            </button>
            <button type="button" aria-label={t('toolbar.navigation.forward')} onClick={() => window.electronAPI.navigateForward(focusedCellId)}>
              <WorkspaceIcon name="forward" />
            </button>
            <button type="button" aria-label={t('toolbar.navigation.reload')} onClick={() => window.electronAPI.reload(focusedCellId)}>
              <WorkspaceIcon name="reload" />
            </button>
          </nav>
          <form className={`address-form${addressRiskReason ? ' has-risk' : ''}`} onSubmit={handleSubmit}>
            <WorkspaceIcon name="globe" className="address-icon" />
            <label className="sr-only" htmlFor="address-input">
              {t('toolbar.address.label')}
            </label>
            <input
              id="address-input"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              placeholder={t('toolbar.address.placeholder')}
              autoComplete="off"
              spellCheck={false}
            />
            {addressRiskReason && (
              <p className="address-risk-warning" title={addressRiskReason}>
                {t('toolbar.address.geminiRestricted')}
              </p>
            )}
          </form>
        </>
      )}
      <div className="toolbar-actions" role="group" aria-label={t('toolbar.actions.label')}>
        <button type="button" className="toolbar-icon-button toolbar-settings-button" title={t('toolbar.actions.editCells')} aria-label={t('toolbar.actions.editCells')} onClick={onOpenConfig}>
          <WorkspaceIcon name="settings" />
        </button>
      </div>
    </header>
  );
}

function MultiMindLogo() {
  return (
    <svg className="multimind-logo" viewBox="0 0 40 40" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="multimind-logo-fill" x1="7" y1="5" x2="33" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="30" height="30" rx="8" fill="url(#multimind-logo-fill)" />
      <path
        d="M10.2 29V11.4c0-1.5 1.8-2.2 2.8-1.2L20 17l7-6.8c1-1 2.8-.3 2.8 1.2V29"
        fill="none"
        stroke="#fff"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.7 27V22.5L20 25.4l4.3-2.9V27"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />
    </svg>
  );
}
