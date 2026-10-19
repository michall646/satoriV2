// Inline destructive confirm. Replaces window.confirm/prompt with explicit UI.
'use client';
import { useState } from 'react';
import { STR, getLang } from '../../lib/client';
import Button from '../ui/Button';

export function ConfirmButton({ children, confirmLabel, description, onConfirm, variant = 'danger', busy }) {
  const t = STR[getLang()];
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {description ? <span className="text-xs" style={{ color: 'var(--muted)' }}>{description}</span> : null}
        <Button variant={variant} onClick={() => setArmed(true)} disabled={busy}>{children}</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold" style={{ color: 'var(--wa-text)' }}>{confirmLabel ?? t.common_confirm}</span>
      <Button variant={variant} onClick={() => { setArmed(false); onConfirm?.(); }} disabled={busy}>{busy ? t.common_working : t.common_yes_do_it}</Button>
      <Button variant="secondary" onClick={() => setArmed(false)} disabled={busy}>{t.common_cancel}</Button>
    </div>
  );
}

export default ConfirmButton;
