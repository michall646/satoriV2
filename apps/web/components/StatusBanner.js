// Queue transparency: judge depth + ETA + maintenance. Replaces silent waiting.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API } from '../lib/client';

export default function StatusBanner() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch(`${API}/api/status`);
        const j = await r.json();
        if (live) setSt(j);
      } catch { if (live) setSt(null); }
    }
    load();
    const iv = setInterval(load, 20000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  if (!st) return null;
  if ((st.queue || 0) === 0) return null;
  const worker = st.workers?.[0] || st.worker || 'worker';
  return (
    <div aria-live="polite" className="text-xs border px-2 py-1 rounded" style={{ background: 'var(--tle-soft)', borderColor: 'var(--tle-line)', color: 'var(--tle-text)' }}>
      Judge queue: {st.queue}, ETA ~{st.etaSec ?? '?'}s · {worker} · <Link href="/status" prefetch className="underline focus-ring rounded">details</Link>
    </div>
  );
}
