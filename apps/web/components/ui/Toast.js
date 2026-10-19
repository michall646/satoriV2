// Toast — SSE events. Minimal event bus via window CustomEvent 'satori-toast'.
// Tone = left ink bar on a surface card. aria-live polite announces.
'use client';
import { useEffect, useState } from 'react';

const TONE_BAR = {
  info: 'var(--accent)',
  success: 'var(--ok)',
  warn: 'var(--tle)',
  danger: 'var(--wa)',
};

export function toast(message, tone = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('satori-toast', { detail: { message, tone, id: Date.now() } }));
}

export default function Toast() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    function onToast(e) {
      const item = e.detail;
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== item.id)), 5000);
    }
    window.addEventListener('satori-toast', onToast);
    return () => window.removeEventListener('satori-toast', onToast);
  }, []);

  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[320px]">
      {items.map((t) => (
        <div key={t.id} className="card p-2.5 text-sm" style={{ borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${TONE_BAR[t.tone] || TONE_BAR.info}` }}>{t.message}</div>
      ))}
    </div>
  );
}
