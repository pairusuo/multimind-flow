import AppSelect from './AppSelect';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  MemoryDocument,
  MemoryDocumentType,
  MemoryDocumentSummary,
  MemoryImportSource,
  MemoryInboxDocument,
  MemoryInboxItem,
  MemoryRecallContext,
  MemoryScope,
} from '../../shared/types';

interface MemoryPanelProps {
  onClose: () => void;
}

type MemoryView = 'inbox' | 'library';
type DraftMemoryType = MemoryDocumentType | 'auto';

const MEMORY_TYPE_OPTIONS: DraftMemoryType[] = ['auto', 'profile', 'project', 'decision_rule', 'event', 'reference'];
const MEMORY_SCOPE_OPTIONS: MemoryScope[] = ['global', 'project'];
const LOW_RECALL_SCORE_THRESHOLD = 60;

export default function MemoryPanel({ onClose }: MemoryPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<MemoryView>('inbox');
  const [sources, setSources] = useState<MemoryImportSource[]>([]);
  const [inboxItems, setInboxItems] = useState<MemoryInboxItem[]>([]);
  const [selectedInboxDocument, setSelectedInboxDocument] = useState<MemoryInboxDocument | null>(null);
  const [selectedMemoryDocument, setSelectedMemoryDocument] = useState<MemoryDocument | null>(null);
  const [searchResults, setSearchResults] = useState<MemoryDocumentSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [recallQuery, setRecallQuery] = useState('');
  const [recallResult, setRecallResult] = useState<MemoryRecallContext | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftMemoryType, setDraftMemoryType] = useState<DraftMemoryType>('auto');
  const [draftMemoryScope, setDraftMemoryScope] = useState<MemoryScope>('global');
  const [draftOriginalQuestion, setDraftOriginalQuestion] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftParticipants, setDraftParticipants] = useState('');
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRemoveSource, setPendingRemoveSource] = useState<MemoryImportSource | null>(null);
  const [pendingDisableDocument, setPendingDisableDocument] = useState<MemoryDocument | null>(null);
  const [hideEmptyInboxMessage, setHideEmptyInboxMessage] = useState(false);

  const visibleInboxItems = useMemo(
    () => inboxItems.filter((item) => item.status === 'new' || item.status === 'modified' || item.status === 'disabled'),
    [inboxItems],
  );

  useEffect(() => {
    void refreshSources();
    void refreshInbox();
    void refreshSearch('');
  }, []);

  async function refreshSources() {
    const nextSources = await window.electronAPI.listMemorySources();
    setSources(nextSources);
  }

  async function refreshInbox(showScanStatus = false) {
    setBusy(true);
    setError(null);
    try {
      const nextItems = await window.electronAPI.scanMemoryInbox();
      setInboxItems(nextItems);
      await refreshSearch(searchQuery);
      if (selectedMemoryDocument) {
        const refreshedDocument = await window.electronAPI.getMemoryDocument({ id: selectedMemoryDocument.id });
        setSelectedMemoryDocument(refreshedDocument);
      }
      if (showScanStatus) {
        const pendingCount = nextItems.filter((item) => item.status === 'new' || item.status === 'modified' || item.status === 'disabled').length;
        setHideEmptyInboxMessage(pendingCount === 0);
        setScanStatus(pendingCount > 0
          ? t('memory.status.scanCompletedWithItems', { count: pendingCount })
          : t('memory.status.scanCompletedEmpty'));
      } else {
        setHideEmptyInboxMessage(false);
        setScanStatus(null);
      }
    } catch {
      setError(t('memory.errors.scanFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSearch(query: string) {
    const results = await window.electronAPI.searchMemoryDocuments({ query });
    setSearchResults(results);
  }

  async function chooseDirectory() {
    setBusy(true);
    setError(null);
    try {
      const source = await window.electronAPI.chooseMemoryDirectory();
      if (source) {
        setStatus(t('memory.status.directoryAdded'));
        await refreshSources();
        await refreshInbox(true);
      }
    } catch {
      setError(t('memory.errors.directoryFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveSource() {
    if (!pendingRemoveSource) {
      return;
    }

    const source = pendingRemoveSource;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.removeMemorySource({ id: source.id });
      setStatus(t('memory.status.directoryRemoved'));
      const nextSources = sources.filter((candidate) => candidate.id !== source.id);
      setSources(nextSources);
      setInboxItems((current) => current.filter((item) => item.sourceId !== source.id && item.sourcePath !== source.path));
      if (selectedInboxDocument?.item.sourceId === source.id || selectedInboxDocument?.item.sourcePath === source.path) {
        clearSelectedInboxDocument();
      }
      if (!nextSources.length) {
        setInboxItems([]);
        return;
      }
      await refreshInbox();
    } catch {
      setError(t('memory.errors.removeDirectoryFailed'));
    } finally {
      setPendingRemoveSource(null);
      setBusy(false);
    }
  }

  async function selectInboxItem(item: MemoryInboxItem) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const document = await window.electronAPI.getMemoryInboxDocument(item.filePath);
      setSelectedInboxDocument(document);
      setSelectedMemoryDocument(null);
      setRecallResult(null);
      setDraftTitle(document.suggestedTitle);
      setDraftMemoryType('auto');
      setDraftMemoryScope('global');
      setDraftOriginalQuestion('');
      setDraftTags(document.suggestedTags.join(', '));
      setDraftParticipants('');
      setDraftMarkdown(document.contentMarkdown);
    } catch {
      setError(t('memory.errors.previewFailed'));
    } finally {
      setBusy(false);
    }
  }

  function clearSelectedInboxDocument() {
    setSelectedInboxDocument(null);
    setDraftTitle('');
    setDraftMemoryType('auto');
    setDraftMemoryScope('global');
    setDraftOriginalQuestion('');
    setDraftTags('');
    setDraftParticipants('');
    setDraftMarkdown('');
  }

  async function importSelectedDocument() {
    if (!selectedInboxDocument) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const imported = await window.electronAPI.importMemoryDocument({
        sourceId: selectedInboxDocument.item.sourceId,
        sourcePath: selectedInboxDocument.item.sourcePath,
        filePath: selectedInboxDocument.item.filePath,
        title: draftTitle,
        ...(draftMemoryType === 'auto' ? {} : { memoryType: draftMemoryType }),
        memoryScope: draftMemoryScope,
        originalQuestion: draftOriginalQuestion,
        tags: splitList(draftTags),
        participantSites: splitList(draftParticipants),
        contentMarkdown: draftMarkdown,
      });
      setSelectedMemoryDocument(imported);
      setSelectedInboxDocument(null);
      setStatus(t(selectedInboxDocument.item.status === 'disabled' ? 'memory.status.restored' : 'memory.status.imported'));
      await refreshInbox();
      await refreshSearch(searchQuery);
      setView('library');
    } catch {
      setError(t('memory.errors.importFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function submitSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await refreshSearch(searchQuery);
    } catch {
      setError(t('memory.errors.searchFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecall(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const query = recallQuery.trim();
    if (!query) {
      setRecallResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.recallMemoryForAgentTask({ query });
      setRecallResult(result);
      setSelectedInboxDocument(null);
      setSelectedMemoryDocument(null);
    } catch {
      setError(t('memory.errors.recallFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function selectMemoryDocument(summary: MemoryDocumentSummary) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const document = await window.electronAPI.getMemoryDocument({ id: summary.id });
      setSelectedMemoryDocument(document);
      setSelectedInboxDocument(null);
      setRecallResult(null);
    } catch {
      setError(t('memory.errors.openFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openRecalledMemoryDocument(id: string) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const document = await window.electronAPI.getMemoryDocument({ id });
      setSelectedMemoryDocument(document);
      setSelectedInboxDocument(null);
      setRecallResult(null);
    } catch {
      setError(t('memory.errors.openFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function copyAgentContext() {
    if (!recallResult?.agentContext) {
      return;
    }

    try {
      await navigator.clipboard.writeText(recallResult.agentContext);
      setStatus(t('memory.status.contextCopied'));
      setError(null);
    } catch {
      setError(t('memory.errors.copyFailed'));
    }
  }

  async function disableSelectedMemoryDocument() {
    if (!pendingDisableDocument) {
      return;
    }

    const document = pendingDisableDocument;
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.disableMemoryDocument({ id: document.id });
      if (selectedMemoryDocument?.id === document.id) {
        setSelectedMemoryDocument(null);
      }
      setStatus(t('memory.status.disabled'));
      await refreshSearch(searchQuery);
      await refreshInbox();
    } catch {
      setError(t('memory.errors.disableFailed'));
    } finally {
      setPendingDisableDocument(null);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="memory-panel" aria-label={t('memory.title')}>
        <header className="panel-header">
          <div>
            <h1>{t('memory.title')}</h1>
            <p>{t('memory.subtitle')}</p>
          </div>
          <button type="button" className="memory-close-button" aria-label={t('memory.actions.close')} onClick={onClose}>
            <WorkspaceIcon name="close" />
          </button>
        </header>

        <div className="memory-layout">
          <aside className="memory-sidebar">
            <div className="memory-tabs" role="tablist" aria-label={t('memory.tabs.label')}>
              <button type="button" className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')}>
                {t('memory.tabs.inbox')}
              </button>
              <button type="button" className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
                {t('memory.tabs.library')}
              </button>
            </div>

            {view === 'inbox' ? (
              <div className="memory-list-panel">
                <div className="memory-actions-row">
                  <button type="button" onClick={() => void chooseDirectory()} disabled={busy}>
                    {t('memory.actions.addDirectory')}
                  </button>
                  <button type="button" onClick={() => void refreshInbox(true)} disabled={busy}>
                    {t('memory.actions.scan')}
                  </button>
                </div>
                {scanStatus && <p className="memory-scan-status">{scanStatus}</p>}
                <div className="memory-source-list">
                  {sources.map((source) => (
                    <div key={source.id} className="memory-source-item">
                      <span title={source.path}>{source.path}</span>
                      <button
                        type="button"
                        title={t('memory.actions.removeDirectory')}
                        aria-label={t('memory.actions.removeDirectory')}
                        disabled={busy}
                        onClick={() => setPendingRemoveSource(source)}
                      >
                        <WorkspaceIcon name="close" />
                      </button>
                    </div>
                  ))}
                  {!sources.length && <p>{t('memory.empty.noSources')}</p>}
                </div>
                <div className="memory-item-list">
                  {visibleInboxItems.map((item) => (
                    <button
                      key={`${item.filePath}:${item.hash}`}
                      type="button"
                      className={selectedInboxDocument?.item.filePath === item.filePath ? 'active' : ''}
                      onClick={() => void selectInboxItem(item)}
                    >
                      <strong>{item.title}</strong>
                      <span>{t(`memory.statuses.${item.status}`)}</span>
                      <small>{item.fileName}</small>
                    </button>
                  ))}
                  {!visibleInboxItems.length && !hideEmptyInboxMessage && <p>{t('memory.empty.noInboxItems')}</p>}
                </div>
              </div>
            ) : (
              <div className="memory-list-panel">
                <form className="memory-search-form" onSubmit={(event) => void submitSearch(event)}>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('memory.search.placeholder')}
                  />
                  <button type="submit" disabled={busy}>{t('memory.actions.search')}</button>
                </form>
                <form className="memory-recall-form" onSubmit={(event) => void submitRecall(event)}>
                  <label>
                    <span>{t('memory.recall.title')}</span>
                    <textarea
                      value={recallQuery}
                      onChange={(event) => setRecallQuery(event.target.value)}
                      placeholder={t('memory.recall.placeholder')}
                    />
                  </label>
                  <button type="submit" disabled={busy || !recallQuery.trim()}>
                    {t('memory.actions.testRecall')}
                  </button>
                </form>
                <div className="memory-item-list">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className={selectedMemoryDocument?.id === result.id ? 'active' : ''}
                      onClick={() => void selectMemoryDocument(result)}
                    >
                      <strong>{result.title}</strong>
                      <span>
                        {t(`memory.types.${result.memoryType}`)}
                        {` · ${t(`memory.scopes.${result.memoryScope}`)}`}
                        {result.tags.length ? ` · ${result.tags.join(', ')}` : ` · ${t('memory.search.untagged')}`}
                        {result.sourcePath && !result.sourceExists ? ` · ${t('memory.source.missing')}` : ''}
                      </span>
                      <small>{new Date(result.updatedAt).toLocaleString()}</small>
                    </button>
                  ))}
                  {!searchResults.length && <p>{t('memory.empty.noMemoryDocuments')}</p>}
                </div>
              </div>
            )}
          </aside>

          <main className="memory-detail">
            {status && <p className="memory-status">{status}</p>}
            {error && <p className="memory-error">{error}</p>}
            {selectedInboxDocument ? (
              <div className="memory-editor">
                <div className="memory-form-grid">
                  <label>
                    <span>{t('memory.fields.title')}</span>
                    <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
                  </label>
                  <AppSelect label={t('memory.fields.memoryType')} value={draftMemoryType}
                    options={MEMORY_TYPE_OPTIONS.map(memoryType => ({ value: memoryType, label: t(`memory.types.${memoryType}`) }))}
                    onChange={(value) => setDraftMemoryType(value as DraftMemoryType)} />
                  <label className="memory-choice-field">
                    <span>{t('memory.fields.memoryScope')}</span>
                    <div className="memory-choice-grid" role="radiogroup" aria-label={t('memory.fields.memoryScope')}>
                      {MEMORY_SCOPE_OPTIONS.map((memoryScope) => (
                        <button
                          key={memoryScope}
                          type="button"
                          role="radio"
                          aria-checked={draftMemoryScope === memoryScope}
                          className={draftMemoryScope === memoryScope ? 'active' : ''}
                          onClick={() => setDraftMemoryScope(memoryScope)}
                        >
                          {t(`memory.scopes.${memoryScope}`)}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label>
                    <span>{t('memory.fields.originalQuestion')}</span>
                    <input value={draftOriginalQuestion} onChange={(event) => setDraftOriginalQuestion(event.target.value)} />
                  </label>
                  <label>
                    <span>{t('memory.fields.tags')}</span>
                    <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} />
                  </label>
                  <label>
                    <span>{t('memory.fields.participants')}</span>
                    <input value={draftParticipants} onChange={(event) => setDraftParticipants(event.target.value)} />
                  </label>
                </div>
                <textarea value={draftMarkdown} onChange={(event) => setDraftMarkdown(event.target.value)} />
                <div className="memory-detail-actions">
                  <button type="button" onClick={() => void importSelectedDocument()} disabled={busy || !draftTitle.trim() || !draftMarkdown.trim()}>
                    {t(selectedInboxDocument.item.status === 'disabled' ? 'memory.actions.restore' : 'memory.actions.import')}
                  </button>
                </div>
              </div>
            ) : recallResult ? (
              <article className="memory-recall-view">
                <header>
                  <div>
                    <h2>{t('memory.recall.resultTitle')}</h2>
                    <p>{t('memory.recall.resultSubtitle', { count: recallResult.items.length })}</p>
                  </div>
                  {recallResult.agentContext && (
                    <button type="button" onClick={() => void copyAgentContext()}>
                      {t('memory.actions.copyContext')}
                    </button>
                  )}
                </header>
                {recallResult.items.length ? (
                  <>
                    {Math.max(...recallResult.items.map((item) => item.score)) < LOW_RECALL_SCORE_THRESHOLD && (
                      <p className="memory-recall-warning">{t('memory.recall.lowQuality')}</p>
                    )}
                    <div className="memory-recall-items">
                      {recallResult.items.map((item) => (
                        <section key={item.id}>
                          <button
                            type="button"
                            className="memory-recall-open"
                            onClick={() => void openRecalledMemoryDocument(item.id)}
                            disabled={busy}
                          >
                            {item.title}
                          </button>
                          <p>
                            {t(`memory.types.${item.memoryType}`)}
                            {` · ${t(`memory.scopes.${item.memoryScope}`)}`}
                            {` · ${t('memory.recall.score', { score: item.score })}`}
                            {item.tags.length ? ` · ${item.tags.join(', ')}` : ''}
                          </p>
                          <div className="memory-recall-reasons">
                            {item.matchReasons.map((reason) => (
                              <span key={reason}>{t(`memory.recall.reasons.${reason}`)}</span>
                            ))}
                          </div>
                          {item.scoreDetails.length > 0 && (
                            <div className="memory-recall-score-details">
                              <h3>{t('memory.recall.scoreDetails')}</h3>
                              <ul>
                                {item.scoreDetails.map((detail, index) => (
                                  <li key={`${detail.reason}-${index}`}>
                                    <span>{t(`memory.recall.reasons.${detail.reason}`)}</span>
                                    <strong>{`+${detail.score}`}</strong>
                                    {detail.matches?.length ? (
                                      <em>{detail.matches.join(', ')}</em>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <blockquote>{item.excerpt}</blockquote>
                        </section>
                      ))}
                    </div>
                    <section>
                      <h3>{t('memory.recall.contextTitle')}</h3>
                      <pre>{recallResult.agentContext}</pre>
                    </section>
                  </>
                ) : (
                  <div className="memory-empty-detail">
                    <h2>{t('memory.recall.emptyTitle')}</h2>
                    <p>{t('memory.recall.emptyBody')}</p>
                  </div>
                )}
              </article>
            ) : selectedMemoryDocument ? (
              <article className="memory-document-view">
                <header>
                  <div>
                    <h2>{selectedMemoryDocument.title}</h2>
                    <p>
                      {t(`memory.types.${selectedMemoryDocument.memoryType}`)}
                      {` · ${t(`memory.scopes.${selectedMemoryDocument.memoryScope}`)}`}
                      {selectedMemoryDocument.tags.length > 0 ? ` · ${selectedMemoryDocument.tags.join(', ')}` : ''}
                    </p>
                    {selectedMemoryDocument.sourcePath && !selectedMemoryDocument.sourceExists && (
                      <p className="memory-source-status missing">{t('memory.source.missing')}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => setPendingDisableDocument(selectedMemoryDocument)} disabled={busy}>
                    {t('memory.actions.disable')}
                  </button>
                </header>
                {selectedMemoryDocument.originalQuestion && (
                  <section>
                    <h3>{t('memory.fields.originalQuestion')}</h3>
                    <p>{selectedMemoryDocument.originalQuestion}</p>
                  </section>
                )}
                <pre>{selectedMemoryDocument.contentMarkdown}</pre>
              </article>
            ) : (
              <div className="memory-empty-detail">
                <h2>{t('memory.empty.detailTitle')}</h2>
                <p>{view === 'inbox' ? t('memory.empty.detailInbox') : t('memory.empty.detailLibrary')}</p>
              </div>
            )}
          </main>
        </div>
        {pendingRemoveSource && (
          <div className="memory-confirm-backdrop" role="presentation">
            <section className="memory-confirm-dialog" role="dialog" aria-modal="true" aria-label={t('memory.confirm.removeDirectoryTitle')}>
              <MultiMindMark />
              <h2>{t('memory.confirm.removeDirectoryTitle')}</h2>
              <p className="memory-confirm-path">{pendingRemoveSource.path}</p>
              <p>{t('memory.confirm.removeDirectoryBody')}</p>
              <div className="memory-confirm-actions">
                <button type="button" onClick={() => setPendingRemoveSource(null)} disabled={busy}>
                  {t('memory.actions.cancel')}
                </button>
                <button type="button" onClick={() => void confirmRemoveSource()} disabled={busy}>
                  {t('memory.actions.removeDirectory')}
                </button>
              </div>
            </section>
          </div>
        )}
        {pendingDisableDocument && (
          <div className="memory-confirm-backdrop" role="presentation">
            <section className="memory-confirm-dialog" role="dialog" aria-modal="true" aria-label={t('memory.confirm.disableDocumentTitle')}>
              <MultiMindMark />
              <h2>{t('memory.confirm.disableDocumentTitle')}</h2>
              <p className="memory-confirm-path">{pendingDisableDocument.title}</p>
              <p>{t('memory.confirm.disableDocumentBody')}</p>
              <div className="memory-confirm-actions">
                <button type="button" onClick={() => setPendingDisableDocument(null)} disabled={busy}>
                  {t('memory.actions.cancel')}
                </button>
                <button type="button" onClick={() => void disableSelectedMemoryDocument()} disabled={busy}>
                  {t('memory.actions.disable')}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function MultiMindMark() {
  return (
    <svg className="memory-confirm-logo" viewBox="0 0 40 40" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="memory-confirm-logo-fill" x1="7" y1="5" x2="33" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.55" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="30" height="30" rx="8" fill="url(#memory-confirm-logo-fill)" />
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

function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
