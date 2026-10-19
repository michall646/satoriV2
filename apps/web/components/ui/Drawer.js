// Drawer — row expand panel.
'use client';
import { STR, getLang } from '../../lib/client';

export default function Drawer({ open, onClose, title, children }) {
  const t = STR[getLang()];
  if (!open) return null;
  return (
    <div className="border rounded p-3 mt-1" role="region" aria-label={title || 'details'} style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      <div className="flex items-center gap-2">
        {title ? <strong className="text-sm">{title}</strong> : null}
        <button type="button" onClick={() => onClose?.()} className="btn btn-ghost ml-auto text-xs px-2 py-0.5 focus-ring" aria-label={t.ui_collapse_aria}>{t.ui_hide}</button>
      </div>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}
