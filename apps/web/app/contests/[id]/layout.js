// In-contest side nav: fixed viewport-left, fixed width. Problems, Results, Ranking, Clarifications, Manage (admin).
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, API, STR, getLang } from '../../../lib/client';
import { Countdown } from '../../../components/ui/Code';
import ExamGuard from '../../../components/ExamGuard';

function pickNextDeadline(items) {
  if (!items || !items.length) return null;
  const dated = items.filter((p) => p.effectiveDeadline).map((p) => ({ p, t: new Date(p.effectiveDeadline).getTime() })).filter((x) => Number.isFinite(x.t));
  if (!dated.length) return null;
  const now = Date.now();
  const future = dated.filter((x) => x.t > now).sort((a, b) => a.t - b.t);
  if (future.length) return { ...future[0], overdue: false };
  const past = dated.sort((a, b) => b.t - a.t);
  return { ...past[0], overdue: true };
}

function DeadlineStrip({ contestId }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/api/contests/${contestId}/problems`).then((d) => { if (live) setItems(d.items || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [contestId]);
  const next = useMemo(() => pickNextDeadline(items), [items]);
  if (!next) return null;
  const ms = next.t - Date.now();
  const urgent = !next.overdue && ms < 86400000;
  const style = next.overdue ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : urgent ? { borderColor: 'var(--warn)', color: 'var(--warn)' } : { borderColor: 'var(--border)', color: 'var(--muted)' };
  return (
    <div className="mx-3 mb-1 px-3 py-2 border rounded-xl text-xs flex gap-2 items-center flex-wrap" role="status" style={style} title={new Date(next.p.effectiveDeadline).toString()}>
      <span aria-hidden="true">{next.overdue ? '⏰' : '🗓️'}</span>
      <Link className="underline font-semibold focus-ring rounded" href={`/contests/${contestId}/problems/${next.p.id}`}>{next.p.code} {next.p.name}</Link>
      {next.overdue ? <span>{t.timer_overdue}</span> : <Countdown to={next.p.effectiveDeadline} />}
      <a className="underline opacity-80 focus-ring rounded" href={`${API}/api/contests/${contestId}/grade.ics`}>ICS</a>
    </div>
  );
}

export default function ContestLayout({ children, params }) {
  const t = STR[getLang()];
  const [isAdmin, setIsAdmin] = useState(false);
  const [contest, setContest] = useState(null);
  const pathname = usePathname?.() || '';

  useEffect(() => {
    api(`/api/contests/${params.id}/members`).then(() => setIsAdmin(true)).catch(() => setIsAdmin(false));
    api(`/api/contests/${params.id}`).then(setContest).catch(() => setContest(null));
  }, [params.id]);

  const tabs = [
    { href: `/contests/${params.id}`, labelKey: 'contest_tab_problems', active: pathname === `/contests/${params.id}`, icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
    { href: `/contests/${params.id}/results`, labelKey: 'contest_tab_results', active: pathname.includes('/results'), icon: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></> },
    { href: `/contests/${params.id}/ranking`, labelKey: 'contest_tab_ranking', active: pathname.includes('/ranking'), icon: <><circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" /></> },
    { href: `/contests/${params.id}/clarifications`, labelKey: 'contest_tab_clarifications', active: pathname.includes('/clarifications'), icon: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /> },
  ];
  if (isAdmin) tabs.push({ href: `/contests/${params.id}/manage`, labelKey: 'contest_tab_manage', active: pathname.includes('/manage'), icon: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></> });

  // Manage owns its own grouped rail — drop the contest nav there so two navs don't stack.
  // F4: ExamGuard is mounted on every contest route, manage included.
  if (pathname.includes('/manage')) {
    return (
      <div className="w-full min-w-0">
        <ExamGuard contestId={params.id} staff={isAdmin} />
        {children}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col md:flex-row gap-6 md:pl-56">
      <nav aria-label={t.contest_nav_aria} className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto py-2 md:py-1 md:fixed md:left-5 md:top-[4.5rem] md:bottom-4 md:w-48">
        <div className="hidden md:block px-3 py-2">
          <strong className="block text-sm leading-tight" style={{ fontFamily: 'var(--font-display)' }}>{contest?.name || t.contest_fallback}</strong>
        </div>
        <div className="lg:hidden w-full">
          <DeadlineStrip contestId={params.id} />
        </div>
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} prefetch aria-current={tab.active ? 'page' : undefined} className="text-sm px-3 py-2 rounded-xl whitespace-nowrap focus-ring flex items-center gap-2.5 transition" style={tab.active ? { background: 'rgb(128 140 155 / 0.16)', color: 'var(--fg)', fontWeight: 600 } : { color: 'var(--muted)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tab.icon}</svg>
            {t[tab.labelKey]}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 pt-2 md:pt-0">
        <ExamGuard contestId={params.id} staff={isAdmin} />
        {children}
      </div>
    </div>
  );
}
