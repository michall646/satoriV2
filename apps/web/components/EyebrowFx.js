'use client';
import { useCallback, useEffect, useRef } from 'react';

// Simple hover accent: no glyph swap, no shift, no glitch.
// Hit char -> accent + 700 fast, slow fade back. Fixed 1ch cells.
const HOLD_MS = 250;
const OUT_FADE = 700;
const IDLE_MS = 350;

export default function EyebrowFx({ text = 'FEATURES', className = '', as = 'p', children, ...rest }) {
  const rootRef = useRef(null);
  const idleRef = useRef(0);

  const restore = useCallback((el, slow = true) => {
    if (!el) return;
    el._gen = (el._gen || 0) + 1;
    el._active = false;
    window.clearTimeout(el._t);
    el.style.transition = `color ${slow ? OUT_FADE : 80}ms ease-out`;
    el.style.color = '';
    el.style.fontWeight = '400';
  }, []);

  const restoreAll = useCallback((slow = true) => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('[data-i]').forEach((el) => restore(el, slow));
  }, [restore]);

  const fire = useCallback((i) => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-i="${i}"]`);
    if (!el || el._active) return;
    el._active = true;
    el._gen = (el._gen || 0) + 1;
    const gen = el._gen;
    window.clearTimeout(el._t);
    el.style.transition = 'none';
    el.style.color = 'var(--accent)';
    el.style.fontWeight = '700';
    el._t = window.setTimeout(() => {
      if (el._gen !== gen) return;
      el.style.transition = `color ${OUT_FADE}ms ease-out`;
      el.style.color = '';
      el.style.fontWeight = '400';
      el._t = window.setTimeout(() => {
        if (el._gen !== gen) return;
        el._active = false;
      }, OUT_FADE);
    }, HOLD_MS);
  }, []);

  const pokeIdle = useCallback(() => {
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => restoreAll(true), IDLE_MS);
  }, [restoreAll]);

  useEffect(() => () => window.clearTimeout(idleRef.current), [text]);

  function onMove(e) {
    const t = e.target?.closest?.('[data-i]');
    if (!t) {
      pokeIdle();
      return;
    }
    fire(Number(t.dataset.i));
    pokeIdle();
  }

  const Tag = as;
  return (
    <Tag
      ref={rootRef}
      className={`eyebrow-fx ${className}`}
      onPointerMove={onMove}
      onPointerLeave={() => restoreAll(true)}
      aria-label={text}
      {...rest}
    >
      {children ?? Array.from(text).map((ch, i) => (
        <span
          key={i}
          data-i={i}
          data-base={ch}
          aria-hidden={i !== 0}
          style={{
            display: 'inline-block',
            width: '1ch',
            textAlign: 'center',
            whiteSpace: 'pre',
            verticalAlign: 'top',
            fontWeight: 400,
          }}
        >
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
      <style jsx>{`
        .eyebrow-fx { cursor: default; letter-spacing: 0.12em; margin: 0; font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; color: var(--muted); }
        .eyebrow-fx :global(span) { transition: color 700ms ease-out; }
      `}</style>
    </Tag>
  );
}
