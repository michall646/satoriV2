// Quiet notice: neutral surface + hairline. Tone stays on the icon and title only,
// never a full tint fill. docs/DESIGN_PLAN.md §2: cards = surface + border + token radius.
const TONES = {
  neutral: { icon: 'var(--muted)', title: 'var(--fg)' },
  info: { icon: 'var(--accent)', title: 'var(--fg)' },
  success: { icon: 'var(--ok-text)', title: 'var(--fg)' },
  warn: { icon: 'var(--tle-text)', title: 'var(--fg)' },
  danger: { icon: 'var(--wa-text)', title: 'var(--fg)' },
};

export default function Notice({ tone = 'neutral', role = 'status', icon, title, children, dense = false, className = '', style, ...props }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 border px-3.5 py-2.5 ${className}`}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', borderRadius: 'var(--radius)', ...style }}
      {...props}
    >
      {icon ? <span className="shrink-0 mt-0.5" style={{ color: t.icon }} aria-hidden="true">{icon}</span> : null}
      <div className={`min-w-0 leading-5 ${dense ? 'text-xs' : 'text-sm'}`}>
        {title ? <p className="font-semibold" style={{ color: t.title }}>{title}</p> : null}
        {children ? <div className={title ? 'text-xs mt-0.5' : ''} style={{ color: 'var(--muted)' }}>{children}</div> : null}
      </div>
    </div>
  );
}
