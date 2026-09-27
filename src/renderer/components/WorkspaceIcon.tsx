import type { LayoutMode } from '../../shared/types';

export type WorkspaceIconName = 'back' | 'forward' | 'reload' | 'plus' | 'close' | 'expand' | 'collapse' | 'check' | 'share' | 'send' | 'document' | 'new-chat' | 'settings' | 'globe' | 'search' | 'appearance' | 'chat' | 'memory' | 'sun' | 'moon' | 'system';

const paths: Record<WorkspaceIconName, JSX.Element> = {
  back: <path d="m14 6-6 6 6 6M8 12h12" />,
  forward: <path d="m10 6 6 6-6 6M4 12h12" />,
  reload: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  expand: <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />,
  collapse: <path d="M4 8h4V4m12 4h-4V4M8 20v-4H4m12 4v-4h4" />,
  check: <path d="m5 12 4 4L19 6" />,
  share: <><path d="M14 5h5v5m0-5-9 9" /><path d="M10 5H5v14h14v-5" /></>,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  document: <><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9l-6-6Zm0 0v6h6" /><path d="M9 13h6m-6 4h4" /></>,
  'new-chat': <><path d="M13 4H6a2 2 0 0 0-2 2v14l4-3h10a2 2 0 0 0 2-2v-4" /><path d="m12 12 1-4 6-6 3 3-6 6-4 1Z" /></>,
  settings: <><path d="M4 7h7m4 0h5M4 17h5m4 0h7" /><circle cx="13" cy="7" r="2" /><circle cx="11" cy="17" r="2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  appearance: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
  chat: <path d="M4 5h16v12H8l-4 3V5Z" />,
  memory: <><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M3 7h4m-4 5h4m-4 5h4m6-10h4m-4 4h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />,
  system: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
};

export function WorkspaceIcon({ name, className = '' }: { name: WorkspaceIconName; className?: string }) {
  return <svg className={`workspace-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function LayoutIcon({ mode }: { mode: LayoutMode }) {
  return (
    <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {(mode === 'horizontal' || mode === 'triple' || mode === 'quad') && <path d="M12 4v16" />}
      {(mode === 'vertical' || mode === 'quad') && <path d="M3 12h18" />}
      {mode === 'triple' && <path d="M12 12h9" />}
    </svg>
  );
}
