// Tabs — underline + count pill. Controlled or uncontrolled. Guard clauses.
// Tokens only. Counts use mono + tnum. Motion ≤150ms, killed by reduced-motion globally.
'use client';
import { useState } from 'react';

function CountPill({ count, active }) {
  if (count == null) return null;
  return (
    <span
      aria-hidden="true"
      className="tabular-nums"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1.4,
        padding: '1px 6px',
        borderRadius: '999px',
        fontFeatureSettings: "'tnum'",
        background: active ? 'var(--accent)' : 'var(--hover-wash)',
        color: active ? 'var(--accent-fg)' : 'var(--muted)',
        transition: 'background 120ms ease-out, color 120ms ease-out',
      }}
    >
      {count}
    </span>
  );
}

export default function Tabs({ tabs = [], value, defaultId, onChange, ariaLabel = 'tabs', className = '' }) {
  const [inner, setInner] = useState(defaultId || tabs[0]?.id);
  if (!tabs.length) return null;

  const isControlled = value !== undefined;
  const active = isControlled ? value : inner;
  const current = tabs.find((t) => t.id === active) || tabs[0];

  function select(id) {
    const t = tabs.find((x) => x.id === id);
    if (!t || t.disabled) return;
    if (!isControlled) setInner(id);
    if (onChange) onChange(id);
  }

  function onKey(e) {
    const idx = tabs.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight') { e.preventDefault(); select(tabs[(idx + 1) % tabs.length].id); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); select(tabs[(idx - 1 + tabs.length) % tabs.length].id); return; }
    if (e.key === 'Home') { e.preventDefault(); select(tabs[0].id); return; }
    if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1].id); return; }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b overflow-x-auto no-scrollbar overscroll-x-contain -mx-1 px-1" style={{ borderColor: 'var(--border)' }} onKeyDown={onKey}>
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={isActive}
              aria-controls={t.content ? `panel-${t.id}` : undefined}
              tabIndex={isActive ? 0 : -1}
              disabled={t.disabled}
              onClick={() => select(t.id)}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] whitespace-nowrap shrink-0 focus-ring transition-colors duration-150 ease-out border-b-2 -mb-px rounded-t-[6px] disabled:opacity-50 disabled:cursor-not-allowed"
              style={isActive
                ? { borderColor: 'var(--accent)', color: 'var(--fg)', fontWeight: 600, background: 'transparent' }
                : { borderColor: 'transparent', color: 'var(--muted)', fontWeight: 500, background: 'transparent' }}
            >
              <span>{t.label}</span>
              <CountPill count={t.count} active={isActive} />
            </button>
          );
        })}
      </div>
      {current?.content ? <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} className="pt-3">{current.content}</div> : null}
    </div>
  );
}
