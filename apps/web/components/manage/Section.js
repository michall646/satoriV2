// Manage layout primitives: sectioned surface (hairlines, no card spam) + flat stat row.
'use client';
import Link from 'next/link';
import EyebrowFx from '../EyebrowFx';

// A page section: hairline top divider, quiet title, content. No card.
export function PageSection({ title, hint, actions, children, className = '' }) {
  return (
    <section className={`manage-section ${className}`}>
      {title || actions ? (
        <div className="section-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {hint ? <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
      {children ? <div className={title ? 'mt-3' : ''}>{children}</div> : null}
    </section>
  );
}

// Flat stat row: numbers split by hairlines, no boxes.
export function StatRow({ children }) {
  return <div className="stat-row">{children}</div>;
}

const TONE = {
  neutral: 'var(--fg)',
  accent: 'var(--accent-text)',
  ok: 'var(--ok-text)',
  warn: 'var(--tle-text)',
  danger: 'var(--wa-text)',
};

export function Stat({ label, value, hint, tone = 'neutral', href }) {
  const body = (
    <div className="stat">
      <EyebrowFx text={label} />
      <p className="stat-value tabular-nums" style={{ color: TONE[tone] || TONE.neutral }}>{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
  if (!href) return body;
  return <Link href={href} prefetch className="stat-link focus-ring rounded" style={{ borderRadius: 'var(--radius-sm)' }}>{body}</Link>;
}

// Danger strip: tinted, not a neutral card.
export function DangerStrip({ title = 'Danger zone', hint, children }) {
  return (
    <section className="manage-danger">
      <h2>{title}</h2>
      {hint ? <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}
