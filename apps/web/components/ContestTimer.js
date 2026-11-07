// Top-bar contest timer: desktop only, contextual to /contests/[id]/*.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, API, STR, getLang, withAuth } from '../lib/client';
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
  const [contest, setContest] = useState(null);

  useEffect(() => {
    if (!contestId) return;
    let live = true;
    setItems(null);
    setContest(null);
    Promise.all([
      api(`/api/contests/${contestId}/problems`).then((d) => d.items || []).catch(() => []),
      api(`/api/contests/${contestId}`).catch(() => null),
    ]).then(([problemItems, c]) => {
      if (!live) return;
      setItems(problemItems);
      setContest(c);
    });
    return () => { live = false; };
  }, [contestId]);

  const next = useMemo(() => {
    const problemEvent = pickNext(items);
    if (problemEvent) {
      return {
        ...problemEvent,
        when: problemEvent.t,
        href: `/contests/${contestId}/problems/${problemEvent.p.id}`,
        label: `${problemEvent.p.code} ${problemEvent.p.name}`,
      };
    }
    if (!contest) return null;
    const now = Date.now();
    const start = contest.startAt ? new Date(contest.startAt).getTime() : null;
    const end = contest.endAt || contest.stopAt ? new Date(contest.endAt || contest.stopAt).getTime() : null;
    const freeze = contest.freezeAt ? new Date(contest.freezeAt).getTime() : null;
    if (Number.isFinite(freeze) && freeze > now && (!Number.isFinite(end) || freeze <= end)) {
      return { when: freeze, href: `/contests/${contestId}/ranking`, label: t.timer_freeze, overdue: false };
    }
    if (Number.isFinite(end) && end > now) {
      return { when: end, href: `/contests/${contestId}`, label: t.timer_contest_end, overdue: false };
    }
    if (Number.isFinite(start) && start > now) {
      return { when: start, href: `/contests/${contestId}`, label: t.timer_contest_start, overdue: false };
    }
    return null;
  }, [items, contest, contestId, t]);

  if (!contestId) return null;
  if (!next) return null;

  const ms = next.when - Date.now();
  const urgent = !next.overdue && ms < 86400000;
  const tone = next.overdue
    ? 'var(--wa-text)'
    : urgent
      ? 'var(--tle-text)'
      : 'var(--accent-text)';

  return (
    <div
      className="top-timer hidden lg:flex"
      role="status"
      title={new Date(next.when).toString()}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: tone }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      <Link href={next.href} prefetch className="top-timer-link focus-ring">
        {next.label}
      </Link>
      {next.overdue ? <span>{t.timer_overdue}</span> : <Countdown to={new Date(next.when).toISOString()} label={t.timer_left} />}
      <a href={withAuth(`${API}/api/contests/${contestId}/grade.ics`)} className="top-timer-ics focus-ring" aria-label={t.timer_ics_aria}>ICS</a>
    </div>
  );
}
