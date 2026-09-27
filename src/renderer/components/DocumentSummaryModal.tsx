import { useTranslation } from 'react-i18next';
import { DocumentCandidate } from '../../shared/types';
import { findPresetSiteByUrl } from '../../shared/presetSites';
import { WorkspaceIcon } from './WorkspaceIcon';

interface DocumentSummaryModalProps {
  candidates: DocumentCandidate[];
  isGenerating: boolean;
  error: string | null;
  onClose: () => void;
  onGenerate: (cellId: string) => void;
}

export default function DocumentSummaryModal({
  candidates,
  isGenerating,
  error,
  onClose,
  onGenerate,
}: DocumentSummaryModalProps) {
  const { t } = useTranslation();

  return (
    <div className="modal-backdrop">
      <section className="document-panel" aria-label={t('documentSummary.title')}>
        <header className="panel-header">
          <h1>{t('documentSummary.title')}</h1>
          <button type="button" className="panel-close-button" aria-label={t('documentSummary.actions.close')} onClick={onClose}>
            <WorkspaceIcon name="close" />
          </button>
        </header>

        <div className="document-picker">
          <p>{t('documentSummary.picker.description')}</p>
          <div className="document-candidate-list">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.cellId}
                type="button"
                disabled={isGenerating}
                onClick={() => onGenerate(candidate.cellId)}
              >
                <span>{getCandidateLabel(candidate, index, (cellIndex) => t('documentSummary.cellLabel', { index: cellIndex }))}</span>
              </button>
            ))}
          </div>
          {!candidates.length && <p className="document-error">{t('documentSummary.errors.noCandidates')}</p>}
          {isGenerating && <p className="document-status">{t('documentSummary.status.sending')}</p>}
          {error && <p className="document-error">{error}</p>}
        </div>
      </section>
    </div>
  );
}

function getCandidateLabel(candidate: DocumentCandidate, index: number, formatCellLabel: (index: number) => string): string {
  if (candidate.url.startsWith('api:')) {
    return `${formatCellLabel(index + 1)} - ${candidate.url.slice(4)}`;
  }

  const site = findPresetSiteByUrl(candidate.url);
  if (site) {
    return `${formatCellLabel(index + 1)} - ${site.name}`;
  }

  try {
    return `${formatCellLabel(index + 1)} - ${new URL(candidate.url).hostname.replace(/^www\./, '')}`;
  } catch {
    return formatCellLabel(index + 1);
  }
}
