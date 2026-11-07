// Input / Select / Textarea — label + hint + error slots.
// Error state = text + icon (never color-only), red border, wired aria-describedby.
'use client';
import Icon from './Icon';

const FIELD_CLASS = 'rounded px-3 py-2 w-full text-sm focus-ring transition';

function fieldStyle(error) {
  return {
    border: `1px solid ${error ? 'var(--wa-line)' : 'var(--border)'}`,
    background: 'var(--surface)',
    color: 'var(--fg)',
  };
}

function shell(label, hint, error, children, hintId, errId) {
  return (
    <label className="block text-sm">
      {label ? <span className="block font-medium mb-1" style={{ fontSize: 13 }}>{label}</span> : null}
      {children}
      {hint && !error ? <span id={hintId} className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</span> : null}
      {error ? (
        <span id={errId} role="alert" className="block text-xs mt-1" style={{ color: 'var(--wa-text)' }}>
          <span aria-hidden="true" className="inline-flex align-[-2px] mr-1"><Icon name="alert" size={12} /></span>{error}
        </span>
      ) : null}
    </label>
  );
}

function describedBy(hint, error, fieldId) {
  const hintId = hint && !error && fieldId ? `${fieldId}-hint` : undefined;
  const errId = error && fieldId ? `${fieldId}-error` : undefined;
  return { hintId, errId, described: [hintId, errId].filter(Boolean).join(' ') || undefined };
}

export function Input({ label, hint, error, id, className = '', ...props }) {
  const fieldId = id || props.name || undefined;
  const { hintId, errId, described } = describedBy(hint, error, fieldId);
  return shell(label, hint, error, (
    <input id={fieldId} aria-invalid={!!error} aria-describedby={described} className={`${FIELD_CLASS} ${className}`} style={fieldStyle(error)} {...props} />
  ), hintId, errId);
}

export function Select({ label, hint, error, id, children, className = '', ...props }) {
  const fieldId = id || props.name || undefined;
  const { hintId, errId, described } = describedBy(hint, error, fieldId);
  return shell(label, hint, error, (
    <select id={fieldId} aria-invalid={!!error} aria-describedby={described} className={`${FIELD_CLASS} ${className}`} style={fieldStyle(error)} {...props}>{children}</select>
  ), hintId, errId);
}

export function Textarea({ label, hint, error, id, className = '', ...props }) {
  const fieldId = id || props.name || undefined;
  const { hintId, errId, described } = describedBy(hint, error, fieldId);
  return shell(label, hint, error, (
    <textarea id={fieldId} aria-invalid={!!error} aria-describedby={described} className={`${FIELD_CLASS} ${className}`} style={{ ...fieldStyle(error), fontFamily: 'var(--font-mono)' }} {...props} />
  ), hintId, errId);
}
