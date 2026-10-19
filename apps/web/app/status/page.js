// Public status: judge queue depth + ETA + worker images.
'use client';
import { useEffect, useState } from 'react';
import { API, STR, getLang } from '../../lib/client';
import { Card, Skeleton } from '../../components/ui';
import { Countdown } from '../../components/ui/Code';

export default function StatusPage() {
  const [s, setS] = useState(null);
  const t = STR[getLang()];
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch(`${API}/api/status`);
        const j = await r.json();
        if (live) setS(j);
      } catch { /* keep */ }
    }
    load();
    const iv = setInterval(load, 20000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  if (!s) return <Skeleton lines={3} />;
  return (
    <div>
      <h1 className="type-h1">Status</h1>
      {s.maintenance ? <Card className="mt-2" style={{ borderColor: 'var(--tle-line)', background: 'var(--tle-soft)', color: 'var(--tle-text)' }}><strong>{t.status_maintenance}</strong> {s.maintenance}</Card> : null}
      <Card className="mt-2 text-sm">
        <p>{t.status_queue} {s.queue}, ETA ~{s.etaSec}s <span style={{ color: 'var(--muted)' }}>({s.etaNote || t.status_estimate})</span> {s.freezeAt ? <span>· {t.status_freeze} <Countdown to={s.freezeAt} label={t.status_to_freeze} /></span> : null}</p>
        <p>{t.status_workers} {(s.workers || []).join(', ') || '—'}{s.local ? ` · ${t.status_local}` : ''}</p>
        <p>{t.languages_title}: {(s.languages || []).join(', ') || '—'}{(s.missingToolchains || []).length ? <span style={{ color: 'var(--muted)' }}> · {t.status_missing} {s.missingToolchains.join(', ')}</span> : null}</p>
        {s.sandbox ? <p className="type-mono" style={{ color: 'var(--muted)' }}>{s.sandbox}</p> : null}
      </Card>
    </div>
  );
}
