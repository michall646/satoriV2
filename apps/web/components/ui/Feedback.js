// Skeleton + EmptyState + ErrorState + Tooltip + HoverCard.
// HoverCard: styled hover/focus card (replaces native title tooltips). Tokens only, no deps.
'use client';
import { useId, useState } from 'react';
import Icon from './Icon';
import { STR, getLang } from '../../lib/client';

export function Skeleton({ lines = 3, className = '' }) {
  if (lines <= 0) return null;
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon = '○', line, action }) {
  const t = STR[getLang()];
  return (
    <div className="card p-6 text-center text-sm">
      <div aria-hidden="true" className="type-display opacity-30" style={{ fontSize: 28 }}>{icon}</div>
      <p className="mt-2" style={{ color: 'var(--muted)' }}>{line || t.ui_nothing_here}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, line, digest, action }) {
  const t = STR[getLang()];
  return (
    <div role="alert" className="card p-6 text-center text-sm" style={{ borderColor: 'var(--wa-line)' }}>
      <div aria-hidden="true" style={{ color: 'var(--wa-text)' }}><Icon name="alert" size={20} /></div>
      <p className="mt-2 font-semibold">{title || t.ui_something_wrong}</p>
      {line ? <p className="mt-1" style={{ color: 'var(--muted)' }}>{line}</p> : null}
      {digest ? <p className="mt-1 type-mono" style={{ color: 'var(--muted)' }}>{t.ui_report_id} {String(digest)}</p> : null}
      {action ? <div className="mt-3 flex gap-2 justify-center">{action}</div> : null}
    </div>
  );
}

function CardPop({ id, text, open }) {
  if (!open) return null;
  return (
    <span
      id={id}
      role="tooltip"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: 180,
        maxWidth: 260,
        background: 'var(--surface)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'var(--shadow)',
        padding: '8px 10px',
        fontSize: 12,
        lineHeight: 1.45,
        fontWeight: 400,
        textAlign: 'left',
        whiteSpace: 'normal',
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      {text}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid var(--border)',
        }}
      />
    </span>
  );
}

export function HoverCard({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return null;
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="underline decoration-dotted cursor-help ml-1 text-muted"
        style={{ fontSize: 12 }}
      >
        <Icon name="info" size={13} className="inline align-[-2px]" />
      </span>
      <CardPop id={id} text={text} open={open} />
    </span>
  );
}

export function Tooltip({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!label) return children;
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span tabIndex={0} aria-describedby={id} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="underline decoration-dotted cursor-help">
        {children}
      </span>
      <CardPop id={id} text={label} open={open} />
    </span>
  );
}
