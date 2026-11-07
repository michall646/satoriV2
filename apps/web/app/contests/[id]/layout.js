// In-contest side nav: fixed viewport-left, fixed width. Problems, Results, Ranking, Clarifications, Manage (admin).
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api, API, STR, getLang, withAuth, authToken } from '../../../lib/client';
import { Badge, Button, Icon, Notice, Skeleton } from '../../../components/ui';
import { toast } from '../../../components/ui/Toast';
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
  return (
    <Notice
      role="status"
      dense
      tone={next.overdue ? 'danger' : urgent ? 'warn' : 'neutral'}
      icon={<Icon name={next.overdue ? 'alert' : urgent ? 'clock' : 'calendar'} size={15} />}
      className="mx-3 mb-1 min-w-[240px] !px-3 !py-1.5"
    >
      <div className="flex gap-2 items-center flex-wrap">
        <Link className="underline font-semibold focus-ring rounded" style={{ color: 'var(--fg)' }} href={`/contests/${contestId}/problems/${next.p.id}`}>{next.p.code} {next.p.name}</Link>
        {next.overdue ? <span style={{ color: 'var(--wa-text)' }}>{t.timer_overdue}</span> : <Countdown to={next.p.effectiveDeadline} />}
        <a className="underline opacity-80 focus-ring rounded" href={withAuth(`${API}/api/contests/${contestId}/grade.ics`)}>ICS</a>
      </div>
    </Notice>
  );
}

function LockedContest({ contest, notFound, onApply, applying, t }) {
  if (notFound || !contest) {
    return (
      <div className="w-full max-w-xl mx-auto py-16 text-center">
        <h1 className="type-h1">{t.contest_not_found}</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>{t.contest_not_found_hint}</p>
        <Link className="inline-block mt-5 text-sm underline focus-ring rounded" href="/contests" prefetch>{t.contests}</Link>
      </div>
    );
  }
  const pending = contest.membership === 'pending';
  const invite = contest.registration === 'invite';
  const draft = contest.lifecycle === 'draft';
  const logged = Boolean(authToken());
  let line = t.contest_locked_body;
  if (pending) line = t.contest_locked_pending;
  else if (invite) line = t.contest_locked_invite;
  else if (draft) line = t.contest_locked_draft;
  return (
    <div className="w-full max-w-2xl mx-auto py-10">
      <p className="type-mono text-xs uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>{t.contest_members_only}</p>
      <h1 className="type-display mt-1">{contest.name}</h1>
      {contest.description ? <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>{contest.description}</p> : null}
      <div className="mt-6 p-5 rounded-lg" style={{ background: 'rgb(128 140 155 / 0.12)' }}>
        <p className="text-sm">{line}</p>
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          {pending ? <Badge tone="warn">{t.contests_pending_state}</Badge> : null}
          {!pending && !invite && !draft && !logged ? <Link className="btn btn-primary focus-ring" href="/login">{t.contest_locked_login}</Link> : null}
          {!pending && !invite && !draft && logged ? (
            <Button onClick={onApply} disabled={applying}>
              {applying ? t.contests_applying : (contest.registration === 'open' ? t.contest_locked_join : t.contest_locked_request)}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ContestLayout({ children, params }) {
  const t = STR[getLang()];
  const teamLabel = getLang() === 'pl' ? 'Drużyna' : 'Team';
  const [isAdmin, setIsAdmin] = useState(false);
  const [contest, setContest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tick, setTick] = useState(0);
  const pathname = usePathname?.() || '';

  useEffect(() => {
    let live = true;
    setLoading(true);
    api(`/api/contests/${params.id}`)
      .then((c) => { if (live) { setContest(c); setNotFound(false); } })
      .catch(() => { if (live) { setContest(null); setNotFound(true); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [params.id, tick]);

  useEffect(() => {
    if (!contest || contest.access !== 'open') { setIsAdmin(false); return undefined; }
    let live = true;
    api(`/api/contests/${params.id}/members`).then(() => { if (live) setIsAdmin(true); }).catch(() => { if (live) setIsAdmin(false); });
    return () => { live = false; };
  }, [params.id, contest]);

  async function requestAccess() {
    setApplying(true);
    try {
      const r = await api(`/api/contests/${params.id}/apply`, { method: 'POST', body: '{}' });
      toast(`${contest?.name || ''}: ${r.state || 'applied'}`);
      setTick((v) => v + 1);
    } catch (e) { toast(e.message, 'danger'); }
    finally { setApplying(false); }
  }

  const tabs = [
    { href: `/contests/${params.id}`, labelKey: 'contest_tab_problems', active: pathname === `/contests/${params.id}`, icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
    { href: `/contests/${params.id}/results`, labelKey: 'contest_tab_results', active: pathname.includes('/results'), icon: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></> },
    { href: `/contests/${params.id}/ranking`, labelKey: 'contest_tab_ranking', active: pathname.includes('/ranking'), icon: <><circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" /></> },
    { href: `/contests/${params.id}/team`, label: teamLabel, active: pathname.includes('/team'), icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
    { href: `/contests/${params.id}/clarifications`, labelKey: 'contest_tab_clarifications', active: pathname.includes('/clarifications'), icon: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /> },
    { href: `/contests/${params.id}/announcements`, labelKey: 'announcements', active: pathname.includes('/announcements'), icon: <><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M16 8a5 5 0 0 1 0 8" /><path d="M19 5a9 9 0 0 1 0 14" /></> },
  ];
  if (isAdmin) tabs.push({ href: `/contests/${params.id}/manage`, labelKey: 'contest_tab_manage', active: pathname.includes('/manage'), icon: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></> });

  // D4: a members-only contest shows a join gate instead of the content nav.
  if (loading) return <div className="w-full py-10"><Skeleton lines={5} /></div>;
  if (notFound || !contest || contest.access === 'locked') {
    return <LockedContest contest={contest} notFound={notFound} onApply={requestAccess} applying={applying} t={t} />;
  }

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
            {tab.labelKey ? t[tab.labelKey] : tab.label}
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
