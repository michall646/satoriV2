// Segmented — single-select filter. Plain text row; the selected option takes the accent color.
// Radio semantics + arrow/Home/End nav + roving tabindex. Tokens only, no nesting.
'use client';

export default function Segmented({ options = [], value, onChange, ariaLabel = 'segmented', className = '' }) {
  if (!options.length) return null;

  function onKey(e) {
    const idx = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(idx + 1) % options.length].value); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(idx - 1 + options.length) % options.length].value); return; }
    if (e.key === 'Home') { e.preventDefault(); onChange(options[0].value); return; }
    if (e.key === 'End') { e.preventDefault(); onChange(options[options.length - 1].value); }
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} onKeyDown={onKey} className={`inline-flex items-center gap-0.5 ${className}`}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`px-2.5 pt-1 pb-1 text-[13px] focus-ring transition-colors duration-150 ease-out whitespace-nowrap ${active ? '' : 'hover:text-[color:var(--fg)]'}`}
            style={active
              ? { background: 'transparent', color: 'var(--accent-text)', fontWeight: 600, borderBottom: '2px solid var(--accent)' }
              : { background: 'transparent', color: 'var(--muted)', fontWeight: 500, borderBottom: '2px solid transparent' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
