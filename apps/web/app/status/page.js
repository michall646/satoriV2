// Public status: queue depth + ETA + language availability + missing toolchains + sandbox note.
'use client';
import { useEffect, useState } from 'react';
import { API, STR, getLang } from '../../lib/client';
import { Badge, Card, Skeleton } from '../../components/ui';
import { Countdown } from '../../components/ui/Code';

const COPY = {
  en: {
    title: 'Status',
    eta: 'ETA',
    languages: 'Languages',
    missing: 'Missing toolchains',
    none: 'none',
    available: 'available',
    unavailable: 'toolchain missing',
    sandbox: 'Sandbox',
    queueEmpty: 'Queue is empty — submissions are judged immediately.',
    autoRefresh: 'auto-refreshes every 20 s',
  },
  pl: {
    title: 'Status',
    eta: 'Szacowany czas',
    languages: 'Języki',
    missing: 'Brakujące toolchainy',
    none: 'brak',
    available: 'dostępny',
    unavailable: 'brak toolchainu',
    sandbox: 'Sandbox',
    queueEmpty: 'Kolejka jest pusta — zgłoszenia są oceniane od razu.',
    autoRefresh: 'odświeżanie co 20 s',
  },
};

function languageBadges(names, available, copy) {
  if (!names || !names.length) return <span style={{ color: 'var(--muted)' }}>{copy.none}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <Badge key={name} tone={available ? 'accent' : 'warn'} title={available ? copy.available : copy.unavailable}>{name}</Badge>
      ))}
    </span>
  );
}

export default function StatusPage() {
  const [s, setS] = useState(null);
  const locale = getLang();
  const t = STR[locale];
  const copy = COPY[locale] || COPY.en;
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch(`${API}/api/status`);
        const j = await r.json();
        if (live) setS(j);
      } catch { /* keep last known status */ }
    }
    load();
    const iv = setInterval(load, 20000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  if (!s) return <Skeleton lines={3} />;
  const queue = Number(s.queue || 0);
  const available = Array.isArray(s.languages) ? s.languages : [];
  const missing = Array.isArray(s.missingToolchains) ? s.missingToolchains : [];
  return (
    <div>
      <h1 className="type-h1">{copy.title}</h1>
      {s.maintenance ? <Card className="mt-2" style={{ borderColor: 'var(--tle-line)', background: 'var(--tle-soft)', color: 'var(--tle-text)' }}><strong>{t.status_maintenance}</strong> {s.maintenance}</Card> : null}
      <Card className="mt-2 text-sm">
        <p>
          <strong>{t.status_queue}:</strong> {queue}
          <span> · {copy.eta} ~{s.etaSec}s <span style={{ color: 'var(--muted)' }}>({s.etaNote || t.status_estimate})</span></span>
          {queue === 0 ? <span style={{ color: 'var(--muted)' }}> · {copy.queueEmpty}</span> : null}
          {s.freezeAt ? <span> · {t.status_freeze} <Countdown to={s.freezeAt} label={t.status_to_freeze} /></span> : null}
        </p>
        <p><strong>{t.status_workers}</strong> {(s.workers || []).join(', ') || '—'}{s.local ? ` · ${t.status_local}` : ''} <span style={{ color: 'var(--muted)' }}>· {copy.autoRefresh}</span></p>
        <p className="flex flex-wrap items-center gap-1"><strong>{copy.languages}:</strong> {languageBadges(available, true, copy)}</p>
        <p className="flex flex-wrap items-center gap-1"><strong>{copy.missing}:</strong> {languageBadges(missing, false, copy)}</p>
        {s.sandbox ? <p className="type-mono" style={{ color: 'var(--muted)' }}><strong>{copy.sandbox}:</strong> {s.sandbox}</p> : null}
      </Card>
    </div>
  );
}
