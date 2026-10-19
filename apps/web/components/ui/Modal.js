// Modal — focus trap (Tab wraps, focus restored on close), Esc closes, Ctrl+Enter submits.
'use client';
import { useEffect, useRef } from 'react';
import { STR, getLang } from '../../lib/client';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, onSubmit, submitLabel }) {
  const t = STR[getLang()];
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;

    function onKey(e) {
      if (e.key === 'Escape') { onClose?.(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); return; }
      if (e.key !== 'Tab') return;
      const nodes = [...(ref.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return; }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,textarea,select,button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose, onSubmit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-20 px-4" style={{ background: 'rgb(15 23 40 / 0.55)', backdropFilter: 'blur(4px)' }} onClick={() => onClose?.()} role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} className="card w-[560px] h-fit p-5" onClick={(e) => e.stopPropagation()}>
        {title ? <h2 className="type-h2 mb-2 prob-code">{title}</h2> : null}
        <div>{children}</div>
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" onClick={() => onClose?.()} className="btn btn-secondary focus-ring">{t.ui_close_esc}</button>
          {onSubmit ? <button type="button" onClick={() => onSubmit()} className="btn btn-primary focus-ring">{submitLabel || t.ui_submit} (Ctrl+Enter)</button> : null}
        </div>
      </div>
    </div>
  );
}
