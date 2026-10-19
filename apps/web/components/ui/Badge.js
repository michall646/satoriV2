// Badge / Pill + Card. Verdict pill always carries text, never color-only.
// Tint chip recipe: soft bg + line border + AA text. docs/DESIGN_PLAN.md §1.1.
'use client';
import { VERDICT_CLASS } from '../../lib/client';

const TONE_STYLE = {
  accent: { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid transparent' },
  signal: { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid transparent' },
  warn: { background: 'var(--tle-soft)', color: 'var(--tle-text)', border: '1px solid transparent' },
  danger: { background: 'var(--wa-soft)', color: 'var(--wa-text)', border: '1px solid transparent' },
  neutral: { background: 'var(--hover-wash)', color: 'var(--muted)', border: '1px solid transparent' },
};

export function Badge({ tone = 'neutral', className = '', ...props }) {
  const style = TONE_STYLE[tone] || TONE_STYLE.neutral;
  const mono = tone === 'neutral';
  return (
    <span
      className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-semibold ${className}`}
      style={{ ...style, ...(mono ? { fontFamily: 'var(--font-mono)' } : null) }}
      {...props}
    />
  );
}

const VERDICT_ICON = {
  OK: '✓', ANS: '✓', WA: '✕', TLE: '⏱', MLE: '⬢', RE: '⚡', CE: '⚠',
  QUE: '…', CMP: '…', TST: '…',
};

export function VerdictPill({ verdict, score, className = '' }) {
  if (!verdict) return null;
  if (verdict === 'todo') return <span className={`verdict verdict-todo ${className}`}>○ todo</span>;
  const cls = VERDICT_CLASS[verdict] || 'verdict verdict-CE';
  const icon = VERDICT_ICON[verdict] ? `${VERDICT_ICON[verdict]} ` : '';
  const label = score != null ? `${icon}${verdict} ${score}` : `${icon}${verdict}`;
  return <span className={`${cls} ${className}`}>{label}</span>;
}

export function Card({ className = '', ...props }) {
  return <div className={`card ${className}`} {...props} />;
}
