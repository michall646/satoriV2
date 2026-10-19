// Clean form primitives: label with hover-card (i) info + hint + control.
// Hover: styled card (tokens-only surface), keyboard-focus shows card, aria-describedby. No new deps.
'use client';
import { Input, Select, Textarea } from '../ui';
import { HoverCard } from '../ui/Feedback';
import { INFO } from './settingDefs';
import { STR, getLang } from '../../lib/client';

export function Info({ for: forKey }) {
  const text = STR[getLang()][INFO[forKey]];
  if (!text) return null;
  return <HoverCard text={text} />;
}

export function Field({ infoKey, label, hint, children }) {
  return (
    <div className="block text-sm">
      <span className="block font-medium mb-1" style={{ fontSize: 13 }}>
        {label}
        <Info for={infoKey} />
      </span>
      {children}
      {hint ? <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</span> : null}
    </div>
  );
}

export function Section({ title, infoKey, hint, stat, children }) {
  return (
    <section className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{title}{infoKey ? <Info for={infoKey} /> : null}</h2>
      {stat ? <p className="type-mono mt-1">{stat}</p> : null}
      {hint ? <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</p> : null}
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 mt-4">{children}</div>
    </section>
  );
}

// Wrappers so callers keep label/hover in one place.
export function FInput({ infoKey, label, ...props }) {
  return (
    <div className="block text-sm">
      <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{label}<Info for={infoKey} /></span>
      <Input label={null} {...props} />
    </div>
  );
}

export function FSelect({ infoKey, label, children, ...props }) {
  return (
    <div className="block text-sm">
      <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{label}<Info for={infoKey} /></span>
      <Select label={null} {...props}>{children}</Select>
    </div>
  );
}

export function FTextarea({ infoKey, label, ...props }) {
  return (
    <div className="block text-sm">
      <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{label}<Info for={infoKey} /></span>
      <Textarea label={null} {...props} />
    </div>
  );
}
