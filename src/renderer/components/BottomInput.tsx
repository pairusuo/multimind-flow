import { KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConversationEntryMode, LAYOUT_CELLS, LayoutMode } from '../../shared/types';
import { WorkspaceIcon } from './WorkspaceIcon';

interface BottomInputProps {
  activeCells: Record<string, boolean>;
  availableCells: Record<string, boolean>;
  conversationEntryMode: ConversationEntryMode;
  layoutMode: LayoutMode;
  onGenerateDocument: () => void;
  onSend: (text: string) => Promise<void>;
  onStartNewDiscussion: () => void;
  onToggleCell: (cellId: string, active: boolean) => void;
}

export default function BottomInput({
  activeCells,
  availableCells,
  conversationEntryMode,
  layoutMode,
  onGenerateDocument,
  onSend,
  onStartNewDiscussion,
  onToggleCell,
}: BottomInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [lastSentText, setLastSentText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const visibleCells = LAYOUT_CELLS[layoutMode];
  const newDiscussionLabel = conversationEntryMode === 'api'
    ? t('bottomInput.apiNewDiscussion')
    : t('bottomInput.newDiscussion');
  const generateDocumentLabel = conversationEntryMode === 'api'
    ? t('bottomInput.apiGenerateDocument')
    : t('bottomInput.generateDocument');

  if (layoutMode === 'single' && conversationEntryMode === 'embedded') {
    return null;
  }

  async function send() {
    const nextText = text.trim();
    if (!nextText || isSending) {
      return;
    }

    setIsSending(true);
    try {
      await onSend(nextText);
      setLastSentText(nextText);
      setText('');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }

    if (event.key === 'ArrowUp' && !text && lastSentText) {
      event.preventDefault();
      setText(lastSentText);
    }
  }

  return (
    <aside className={`bottom-input-shell${conversationEntryMode === 'api' ? ' bottom-input-api-mode' : ''}`} aria-label={t('bottomInput.label')}>
      <div className="sync-cell-toggles" aria-label={t('bottomInput.syncCells')}>
        {visibleCells.map((cellId, index) => {
          const available = Boolean(availableCells[cellId]);
          const active = Boolean(activeCells[cellId] && available);
          return (
            <button
              key={cellId}
              type="button"
              className={active ? 'active' : ''}
              disabled={!available || isSending}
              title={available
                ? t('bottomInput.cellToggle.title', { index: index + 1 })
                : t(conversationEntryMode === 'api' ? 'bottomInput.cellToggle.noModel' : 'bottomInput.cellToggle.noUrl', { index: index + 1 })}
              aria-label={t('bottomInput.cellToggle.aria', { index: index + 1 })}
              aria-pressed={active}
              onClick={() => onToggleCell(cellId, !active)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="new-discussion-button"
        title={newDiscussionLabel}
        aria-label={newDiscussionLabel}
        disabled={isSending}
        onClick={onStartNewDiscussion}
      >
        <WorkspaceIcon name="new-chat" />
      </button>
      <button
        type="button"
        className="generate-document-button"
        title={generateDocumentLabel}
        aria-label={generateDocumentLabel}
        disabled={isSending}
        onClick={onGenerateDocument}
      >
        <WorkspaceIcon name="document" />
      </button>
      <textarea
        value={text}
        disabled={isSending}
        placeholder={t('bottomInput.placeholder')}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="send-all-button"
        disabled={isSending || !text.trim()}
        onClick={() => void send()}
      >
        <span>{isSending ? t('bottomInput.sending') : t('bottomInput.send')}</span>
        <WorkspaceIcon name="send" />
      </button>
    </aside>
  );
}
