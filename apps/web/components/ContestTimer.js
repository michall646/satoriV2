// Top-bar contest timer: desktop only, contextual to /contests/[id]/*.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, API, STR, getLang } from '../lib/client';
import { Countdown } from './ui/Code';

function pickNext(items) {
  if (!items || !items.length) return null;
  const dated = items
    .filter((p) => p.effectiveDeadline)
    .map((p) => ({ p, t: new Date(p.effectiveDeadline).getTime() }))
    .filter((x) => Number.isFinite(x.t));
  if (!dated.length) return null;
  const now = Date.now();
  const future = dated.filter((x) => x.t > now).sort((a, b) => a.t - b.t);
  if (future.length) return { ...future[0], overdue: false };
  const past = dated.sort((a, b) => b.t - a.t);
  return { ...past[0], overdue: true };
}

export default function ContestTimer() {
  const pathname = usePathname?.() || '';
  const m = pathname.match(/^\/contests\/([^/]+)/);
  const contestId = m?.[1] || null;
  const t = STR[getLang()];

  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!contestId) return;
    let live = true;
    setItems(null);
    api(`/api/contests/${contestId}/problems`)
      .then((d) => { if (live) setItems(d.items || []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [contestId]);

  const next = useMemo(() => pickNext(items), [items]);

  if (!contestId) return null;
  if (!next) return null;

  const ms = next.t - Date.now();
  const urgent = !next.overdue && ms < 86400000;
  const tone = next.overdue
    ? { bg: 'var(--wa-soft)', line: 'var(--wa-line)', text: 'var(--wa-text)' }
    : urgent
      ? { bg: 'var(--tle-soft)', line: 'var(--tle-line)', text: 'var(--tle-text)' }
      : { bg: 'var(--accent-soft)', line: 'var(--accent-line)', text: 'var(--accent-text)' };

  return (
    <div
      className="top-timer hidden lg:flex"
      role="status"
      title={new Date(next.p.effectiveDeadline).toString()}
      style={{ background: tone.bg, borderColor: tone.line, color: tone.text }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      <Link href={`/contests/${contestId}/problems/${next.p.id}`} prefetch className="top-timer-link focus-ring">
        {next.p.code} {next.p.name}
      </Link>
      {next.overdue ? <span>{t.timer_overdue}</span> : <Countdown to={next.p.effectiveDeadline} label={t.timer_left} />}
      <a href={`${API}/api/contests/${contestId}/grade.ics`} className="top-timer-ics focus-ring" aria-label={t.timer_ics_aria}>ICS</a>
    </div>
  );
}
