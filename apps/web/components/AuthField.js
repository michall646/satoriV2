// Auth field: EyebrowFx label + quiet input + optional password reveal.
// Error = text + icon (never color-only), hint/error wired via aria-describedby.
'use client';
import { useState } from 'react';
import EyebrowFx from './EyebrowFx';
import { STR, getLang } from '../lib/client';

export default function AuthField({ id, label, hint, error, reveal = false, ...props }) {
  const [show, setShow] = useState(false);
  const t = STR[getLang()];
  const type = reveal ? (show ? 'text' : 'password') : (props.type || 'text');
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const described = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="auth-field">
      <div className="auth-label">
        <label htmlFor={id}>
          <span className="sr-only">{label}</span>
          <EyebrowFx as="span" text={label} aria-hidden="true" />
        </label>
      </div>
      <div className="auth-input-wrap">
        <input
          id={id}
          type={type}
          aria-invalid={!!error}
          aria-describedby={described}
          className={`auth-input focus-ring${reveal ? ' is-pw' : ''}`}
          {...props}
        />
        {reveal ? (
          <button
            type="button"
            className="auth-eye focus-ring"
            aria-pressed={show}
            aria-label={show ? t.auth_hide_aria : t.auth_show_aria}
            onClick={() => setShow((v) => !v)}
          >
            {show ? t.auth_hide : t.auth_show}
          </button>
        ) : null}
      </div>
      {hint && !error ? <span id={hintId} className="auth-hint">{hint}</span> : null}
      {error ? (
        <span id={errId} role="alert" className="auth-error">
          <span aria-hidden="true">⚠ </span>{error}
        </span>
      ) : null}
    </div>
  );
}
