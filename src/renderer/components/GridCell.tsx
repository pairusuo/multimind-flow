import AppSelect from './AppSelect';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiModelDisplayName, getApiModelProvider, getApiModelProviderLabel, getApiModelProviderMeta } from '../../shared/apiModelMetadata';
import type { ApiConversationCellState, CellMode, CellNoticePayload, ConversationEntryMode, LayoutMode } from '../../shared/types';
import claudeLogo from '../assets/model-logos/claude.svg';
import deepseekLogo from '../assets/model-logos/deepseek.svg';
import doubaoLogo from '../assets/model-logos/doubao.svg';
import geminiLogo from '../assets/model-logos/gemini.svg';
import grokLogo from '../assets/model-logos/grok.svg';
import kimiLogo from '../assets/model-logos/kimi.svg';
import openaiLogo from '../assets/model-logos/openai.svg';
import qwenLogo from '../assets/model-logos/qwen.svg';
import zaiLogo from '../assets/model-logos/z-ai.svg';
import CellNotice from './CellNotice';
import { WorkspaceIcon, type WorkspaceIconName } from './WorkspaceIcon';

const repeatableNoticeTypes = new Set<CellNoticePayload['type']>(['conversation-truncated', 'source-response-pending']);
const API_MODEL_LOGOS: Record<string, string> = {
  anthropic: claudeLogo,
  'bytedance-seed': doubaoLogo,
  deepseek: deepseekLogo,
  google: geminiLogo,
  moonshotai: kimiLogo,
  openai: openaiLogo,
  qwen: qwenLogo,
  'x-ai': grokLogo,
  'z-ai': zaiLogo,
};

interface CellMenuAction {
  id: string;
  title: string;
  ariaLabel: string;
  icon: WorkspaceIconName;
  active?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  onClick: () => void;
}

interface GridCellProps {
  cellId: string;
  className: string;
  focused: boolean;
  conversationEntryMode: ConversationEntryMode;
  apiState: ApiConversationCellState | undefined;
  apiModels: string[];
  layoutMode: LayoutMode;
  maximized: boolean;
  showForwardControl: boolean;
  targetCells: Array<{ cellId: string; label: string }>;
  meta: {
    url: string;
    mode: CellMode;
    favicon: string | null;
    active: boolean;
  };
  onFocus: (cellId: string, url: string) => void;
  onToggleMaximized: (cellId: string) => void;
  onNewTab: (cellId: string, url?: string) => void;
  onToggle: (cellId: string, active: boolean) => void;
  onApiModelChange: (cellId: string, model: string) => void;
  onApiForward: (sourceCellId: string, targetCellId: string) => Promise<void>;
  onClearApiCell: (cellId: string) => void;
}

export default function GridCell({
  cellId,
  className,
  focused,
  conversationEntryMode,
  apiState,
  apiModels,
  layoutMode,
  maximized,
  showForwardControl,
  targetCells,
  meta,
  onFocus,
  onToggleMaximized,
  onNewTab,
  onToggle,
  onApiModelChange,
  onApiForward,
  onClearApiCell,
}: GridCellProps) {
  const { t } = useTranslation();
  const isApiMode = conversationEntryMode === 'api';
  const host = isApiMode ? apiState?.model || t('gridCell.api.emptyModel') : safeHost(meta.url, t('gridCell.empty'));
  const apiModelMeta = getApiModelProviderMeta(apiState?.model ?? '');
  const apiModelLogo = API_MODEL_LOGOS[apiModelMeta.id];
  const [notice, setNotice] = useState<CellNoticePayload | null>(null);
  const shownNoticeTypes = useRef(new Set<CellNoticePayload['type']>());
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [forwardingTargetId, setForwardingTargetId] = useState<string | null>(null);
  const [forwardStatus, setForwardStatus] = useState<string | null>(null);
  const showCellMenu = layoutMode !== 'single';
  const hasApiContent = Boolean(apiState?.content);
  const forwardAction: CellMenuAction | null = showForwardControl && targetCells.length > 0
    ? {
        id: 'forward',
        title: t('gridCell.actions.forwardTo'),
        ariaLabel: t('gridCell.actions.forwardTo'),
        icon: 'share',
        expanded: targetPickerOpen,
        disabled: isApiMode && !hasApiContent,
        onClick: () => setTargetPickerOpen((open) => !open),
      }
    : null;
  const maximizeAction: CellMenuAction = {
    id: 'maximize',
    title: maximized ? t('gridCell.actions.restoreCell') : t('gridCell.actions.maximizeCell'),
    ariaLabel: maximized ? t('gridCell.actions.restoreCell') : t('gridCell.actions.maximizeCell'),
    icon: maximized ? 'collapse' : 'expand',
    pressed: maximized,
    onClick: () => onToggleMaximized(cellId),
  };
  const modeActions: CellMenuAction[] = isApiMode
    ? [{
        id: 'api-new-discussion',
        title: t('gridCell.api.newDiscussion'),
        ariaLabel: t('gridCell.api.newDiscussion'),
        icon: 'plus',
        onClick: () => onClearApiCell(cellId),
      }]
    : [
        {
          id: 'reload',
          title: t('gridCell.actions.reload'),
          ariaLabel: t('gridCell.actions.reloadCell'),
          icon: 'reload',
          onClick: () => {
            clearPageNotice();
            window.electronAPI.reload(cellId);
          },
        },
        {
          id: 'new-tab',
          title: t('gridCell.actions.newTab'),
          ariaLabel: t('gridCell.actions.newTab'),
          icon: 'plus',
          onClick: () => onNewTab(cellId),
        },
      ];
  const syncAction: CellMenuAction = {
    id: 'sync',
    title: t('gridCell.actions.toggleSync'),
    ariaLabel: t('gridCell.actions.toggleSync'),
    icon: 'check',
    active: meta.active,
    pressed: meta.active,
    onClick: () => onToggle(cellId, !meta.active),
  };
  const cellMenuActions: CellMenuAction[] = [
    ...(forwardAction ? [forwardAction] : []),
    maximizeAction,
    ...modeActions,
    syncAction,
  ];

  useEffect(() => {
    const removeNoticeListener = window.electronAPI.onCellNotice((payload) => {
      if (payload.cellId !== cellId) {
        return;
      }

      if (!repeatableNoticeTypes.has(payload.type) && shownNoticeTypes.current.has(payload.type)) {
        return;
      }

      if (!repeatableNoticeTypes.has(payload.type)) {
        shownNoticeTypes.current.add(payload.type);
      }
      setNotice(payload);
    });
    const removeClearListener = window.electronAPI.onCellNoticeCleared((payload) => {
      if (payload.cellId === cellId) {
        clearPageNotice();
      }
    });

    return () => {
      removeNoticeListener();
      removeClearListener();
    };
  }, [cellId]);

  function clearPageNotice() {
    shownNoticeTypes.current.clear();
    setNotice(null);
  }

  async function forwardTo(targetCellId: string) {
    setTargetPickerOpen(false);
    setForwardingTargetId(targetCellId);
    const targetLabel = getTargetLabel(targetCells, targetCellId);
    setForwardStatus(t('gridCell.forward.status.forwarding', { target: targetLabel }));

    try {
      if (isApiMode) {
        await onApiForward(cellId, targetCellId);
        setForwardStatus(t('gridCell.forward.status.completed', { target: targetLabel }));
      } else {
        const record = await window.electronAPI.forwardResponse({ sourceCellId: cellId, targetCellId });
        setForwardStatus(record.sourceTruncated
          ? t('gridCell.forward.status.completedTruncated', { target: targetLabel })
          : t('gridCell.forward.status.completed', { target: targetLabel }));
      }
    } catch (error) {
      console.error('Forward response failed:', error);
      setForwardStatus(t('gridCell.forward.status.failed', { target: targetLabel }));
    } finally {
      setForwardingTargetId(null);
    }
  }

  return (
    <article
      className={`grid-cell ${className}${isApiMode ? ' api-grid-cell' : ''}${focused ? ' focused' : ''}${maximized ? ' maximized' : ''}`}
      aria-label={t(isApiMode ? 'gridCell.aria.apiCell' : 'gridCell.aria.browserCell', { host })}
      onClick={() => onFocus(cellId, meta.url)}
    >
      <div className="cell-header">
        {forwardStatus ? (
          <div className="forward-picker-inline forward-status-inline" role="status" onClick={(event) => event.stopPropagation()}>
            <span>{forwardStatus}</span>
            <button
              type="button"
              className="forward-picker-cancel"
              aria-label={t('gridCell.forward.dismissStatus')}
              onClick={() => setForwardStatus(null)}
            >
              <WorkspaceIcon name="close" />
            </button>
          </div>
        ) : targetPickerOpen ? (
          <div className="forward-picker-inline" onClick={(event) => event.stopPropagation()}>
            <span className="forward-picker-label">{t('gridCell.forward.label')}</span>
            <div className="forward-picker-targets">
              {targetCells.map((target) => (
                <button
                  key={target.cellId}
                  type="button"
                  disabled={forwardingTargetId !== null}
                  onClick={() => void forwardTo(target.cellId)}
                >
                  {target.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="forward-picker-cancel"
              aria-label={t('gridCell.forward.cancel')}
              onClick={() => setTargetPickerOpen(false)}
            >
              <WorkspaceIcon name="close" />
            </button>
          </div>
        ) : (
          <>
            <div className="cell-overlay" aria-live="polite">
              {isApiMode ? (
                <span
                  className={`api-model-logo api-model-logo-${apiModelMeta.id}`}
                  title={apiModelMeta.label}
                  aria-hidden="true"
                >
                  {apiModelLogo ? (
                    <img
                      src={apiModelLogo}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                  <span className="api-model-logo-fallback">{apiModelMeta.badgeText}</span>
                </span>
              ) : meta.favicon ? <img src={meta.favicon} alt="" /> : <WorkspaceIcon name="globe" className="cell-site-icon" />}
              {!isApiMode && meta.mode === 'search' && <span className="cell-mode-badge" title={t('gridCell.mode.search')}><WorkspaceIcon name="search" /></span>}
              {isApiMode ? (
                <AppSelect className="api-model-select" hideLabel label={t('gridCell.api.modelSelect')}
                  value={apiState?.model ?? ''} placeholder={t('gridCell.api.emptyModel')}
                  options={getGroupedApiModelOptions(apiState?.model ?? '', apiModels).flatMap(group => group.models.map(model => ({ value: model, label: getApiModelDisplayName(model), group: group.label })))}
                  onChange={(value) => onApiModelChange(cellId, value)} />
              ) : (
                <span>{host}</span>
              )}
            </div>
            {(isApiMode || showCellMenu) && (
              <CellMenu label={t('gridCell.aria.controls', { host })} actions={cellMenuActions} />
            )}
          </>
        )}
      </div>
      {isApiMode && <ApiCellBody state={apiState} />}
      {notice && <CellNotice notice={notice} onClose={() => setNotice(null)} />}
    </article>
  );
}

function CellMenu({ label, actions }: { label: string; actions: CellMenuAction[] }) {
  return (
    <div className="cell-menu" aria-label={label}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={action.active ? 'active' : ''}
          title={action.title}
          aria-label={action.ariaLabel}
          aria-pressed={action.pressed}
          aria-expanded={action.expanded}
          disabled={action.disabled}
          onClick={(event) => {
            event.stopPropagation();
            action.onClick();
          }}
        >
          <WorkspaceIcon name={action.icon} />
        </button>
      ))}
    </div>
  );
}

function ApiCellBody({ state }: { state: ApiConversationCellState | undefined }) {
  const { t } = useTranslation();

  if (!state?.model) {
    return (
      <div className="api-cell-body api-cell-empty">
        <p>{t('gridCell.api.noModel')}</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="api-cell-body">
        <p className="api-cell-error">{state.error || t('gridCell.api.failed')}</p>
      </div>
    );
  }

  if (!state.content) {
    return (
      <div className="api-cell-body api-cell-empty">
        <p>{state.status === 'running' ? t('gridCell.api.running') : t('gridCell.api.placeholder')}</p>
      </div>
    );
  }

  return (
    <div className="api-cell-body">
      <div className="api-cell-meta">
        {state.status === 'running'
          ? t('gridCell.api.streaming')
          : typeof state.elapsedMs === 'number'
            ? t('gridCell.api.elapsed', { seconds: (state.elapsedMs / 1000).toFixed(1) })
            : null}
      </div>
      <pre>{state.content}</pre>
    </div>
  );
}

function getTargetLabel(targetCells: Array<{ cellId: string; label: string }>, cellId: string): string {
  return targetCells.find((target) => target.cellId === cellId)?.label ?? cellId.replace('cell-', 'Cell ');
}

function getGroupedApiModelOptions(selectedModel: string, models: string[]): Array<{ provider: string; label: string; models: string[] }> {
  const allModels = selectedModel && !models.includes(selectedModel) ? [selectedModel, ...models] : models;
  const groups = new Map<string, string[]>();

  allModels.forEach((model) => {
    const provider = getModelProvider(model);
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  });

  return [...groups.entries()].map(([provider, providerModels]) => ({
    provider,
    label: getApiModelProviderLabel(provider),
    models: providerModels,
  }));
}

function getModelProvider(model: string): string {
  return getApiModelProvider(model);
}

function safeHost(url: string, emptyLabel: string): string {
  try {
    return url ? new URL(url).host : emptyLabel;
  } catch {
    return url || emptyLabel;
  }
}
