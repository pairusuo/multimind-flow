import { useTranslation } from 'react-i18next';
import type { CellNoticePayload } from '../../shared/types';
import { WorkspaceIcon } from './WorkspaceIcon';

interface CellNoticeProps {
  notice: CellNoticePayload;
  onClose: () => void;
}

const NOTICE_LABEL_KEYS: Record<CellNoticePayload['type'], string> = {
  'google-login-blocked': 'notices.googleLoginBlocked.label',
  'inject-failed': 'notices.injectFailed.label',
  'load-failed': 'notices.loadFailed.label',
  'load-timeout': 'notices.loadTimeout.label',
  'source-response-pending': 'notices.sourceResponsePending.label',
  'conversation-truncated': 'notices.conversationTruncated.label',
};

const NOTICE_ICONS: Record<CellNoticePayload['type'], string> = {
  'google-login-blocked': 'i',
  'inject-failed': '↵',
  'load-failed': '!',
  'load-timeout': '…',
  'source-response-pending': '…',
  'conversation-truncated': '…',
};

export default function CellNotice({ notice, onClose }: CellNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className={`cell-notice cell-notice-${notice.type}`} role="status">
      <span className="cell-notice-icon" aria-hidden="true">
        {NOTICE_ICONS[notice.type]}
      </span>
      <div className="cell-notice-copy">
        <strong>{t(NOTICE_LABEL_KEYS[notice.type])}</strong>
        <span>{t(notice.messageKey)}</span>
      </div>
      <button type="button" aria-label={t('notices.close')} onClick={onClose}>
        <WorkspaceIcon name="close" />
      </button>
    </div>
  );
}
