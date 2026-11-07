// Queue transparency: judge depth + ETA + maintenance. Replaces silent waiting.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API } from '../lib/client';
import { Icon, Notice } from './ui';

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
    <Notice
      role="status"
      icon={<Icon name="clock" size={14} />}
      dense
      className="!px-3 !py-1.5"
    >
      <span aria-live="polite">
        Judge queue: <strong style={{ color: 'var(--fg)' }}>{st.queue}</strong>, ETA ~{st.etaSec ?? '?'}s · {worker} · <Link href="/status" prefetch className="underline focus-ring rounded">details</Link>
      </span>
    </Notice>
  );
}
