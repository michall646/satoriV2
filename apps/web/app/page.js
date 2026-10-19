// Home dashboard: resume + stats + contests + todo + activity. Guard clauses, no nesting.
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, API, STR, getLang } from '../lib/client';
import { EmptyState, ErrorState, Skeleton, Tabs, VerdictPill } from '../components/ui';
import { Countdown } from '../components/ui/Code';
import FluidRippleBackground from '../components/FluidRippleBackground';
import EyebrowFx from '../components/EyebrowFx';

function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function streakDays(dates) {
  const days = [...new Set(dates.map(dayKey))].sort().reverse();
  if (!days.length) return 0;
  const today = dayKey(new Date());
  const yesterday = dayKey(Date.now() - 864e5);
  if (days[0] !== today && days[0] !== yesterday) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i += 1) {
    const prev = new Date(`${days[i - 1]}T12:00:00Z`).getTime();
    const cur = new Date(`${days[i]}T12:00:00Z`).getTime();
    if (prev - cur !== 864e5) break;
    streak += 1;
  }
  return streak;
}

function timeAgo(ts) {
  if (!ts) return '';
  const lang = getLang();
  const t = STR[lang];
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return t.ago_soon;
  const m = Math.floor(ms / 60000);
  if (m < 1) return t.ago_now;
  if (m < 60) return `${m}${t.ago_min}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t.ago_h}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}${t.ago_d}`;
  return new Date(ts).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-US');
}

function useRecentId() {
  const [recentId, setRecentId] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setRecentId(localStorage.getItem('satori-recent')); } catch { setRecentId(null); }
    setReady(true);
  }, []);
  return { recentId, ready };
}

function openPalette() {
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  } catch { /* noop */ }
}

/* Icons: inline SVG, aria-hidden, currentColor. */
function I({ d, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}
const P_CHECK = 'M20 6 9 17l-5-5';
const P_BOLT = 'M13 2 3 14h7l-1 8 10-12h-7l1-8z';
const P_TROPHY = 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a1 1 0 0 0-1 1c0 2 1.5 3.5 4 3.5M17 6h3a1 1 0 0 1 1 1c0 2-1.5 3.5-4 3.5';
const P_FLAME = 'M12 22c4 0 7-2.7 7-6.5 0-2.8-1.8-5-3.5-6.5C14 7.5 13 6 13 3c-3 2-5 4.5-5 7-1-.5-1.8-1.3-2.2-2.5C4.7 8.7 5 10 5 11.5 5 18 8 22 12 22z';
const P_CLOCK = 'M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';
const P_ARROW = 'M5 12h14M13 6l6 6-6 6';
const P_SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3';

function ProgressBar({ value, max, label }) {
  if (!max) return null;
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="mt-3">
      <div className="flex justify-between items-baseline text-xs">
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span className="type-mono tabular-nums">{value}/{max} · {pct}%</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden mt-1.5" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-line)', transitionDuration: '200ms' }} />
      </div>
    </div>
  );
}

function SectionHead({ title, count, action }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {count > 0 ? <span className="type-mono" style={{ color: 'var(--muted)' }}>{count}</span> : null}
      {action ? <span className="ml-auto text-[13px]">{action}</span> : null}
    </div>
  );
}

/* ---------- header ---------- */

function DashboardHeader({ me, unread, complete, lang }) {
  const date = new Date().toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const pct = Math.round((complete / 5) * 100);
  return (
    <div className="dash-header">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="min-w-0">
          <EyebrowFx text={date} />
          <h1 className="type-h1 mt-1 truncate">{STR[lang].home_hi} {me.firstName || me.login}</h1>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <Link href="/notifications" prefetch className="text-[13px] underline focus-ring rounded" style={{ color: 'var(--muted)' }}>
            {STR[lang].notifications}: <strong className="tabular-nums" style={{ color: unread > 0 ? 'var(--tle-text)' : 'var(--fg)' }}>{unread}</strong>
          </Link>
          <button type="button" onClick={openPalette} className="btn btn-secondary btn-compact focus-ring" title="Ctrl/⌘+K">
            {STR[lang].home_switch} <kbd className="type-mono opacity-70">⌘K</kbd>
          </button>
          <Link href="/contests" prefetch className="btn btn-primary btn-compact focus-ring">{STR[lang].home_browse}</Link>
        </div>
      </div>
      {complete < 5 ? (
        <div className="flex gap-2 items-center mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          <span>{STR[lang].auth_completion} <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>{complete}/5</strong></span>
          <div className="w-24 h-1 rounded-full overflow-hidden" role="progressbar" aria-valuenow={complete} aria-valuemin={0} aria-valuemax={5} aria-label={STR[lang].auth_completion} style={{ background: 'var(--border)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
          <Link href="/me" prefetch className="underline focus-ring rounded">{STR[lang].home_set_affiliation}</Link>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- continue hero ---------- */

function ContinueHero({ recentId, ready, recent, loading, error, solved, lastSubmit, onRetry }) {
  const lang = getLang();
  const t = STR[lang];
  if (!ready || loading) return <section aria-label={t.home_continue}><SectionHead title={t.home_continue} /><Skeleton lines={3} /></section>;
  if (error) return <section aria-label={t.home_continue}><SectionHead title={t.home_continue} /><ErrorState title={t.home_err_recent} line={String(error)} action={<button type="button" onClick={onRetry} className="btn btn-secondary btn-compact focus-ring">{t.common_retry}</button>} /></section>;
  if (!recentId) return <section aria-label={t.home_continue}><SectionHead title={t.home_continue} /><EmptyState icon="◎" line={t.home_no_recent} action={<Link href="/contests" prefetch className="btn btn-primary btn-compact focus-ring">{t.home_pick_one}</Link>} /></section>;
  if (!recent) return <section aria-label={t.home_continue}><SectionHead title={t.home_continue} /><EmptyState icon="○" line={t.home_recent_gone} action={<Link href="/contests" prefetch className="btn btn-primary btn-compact focus-ring">{t.home_pick_one}</Link>} /></section>;
  return (
    <section aria-label={t.home_continue}>
      <EyebrowFx text={t.home_continue} />
      <h2 className="mt-1 leading-tight truncate" style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.015em' }}><Link className="hover:underline focus-ring rounded" href={`/contests/${recent.id}`} prefetch>{recent.name}</Link></h2>
      <p className="flex gap-2 items-center mt-1.5 flex-wrap text-[13px]" style={{ color: 'var(--muted)' }}>
        <span className="type-mono">{recent.mode}</span>
        {recent.lifecycle ? <span>· {recent.lifecycle}</span> : null}
        {recent.endAt ? <span className="tabular-nums">· <Countdown to={recent.endAt} /></span> : null}
      </p>
      {solved ? <ProgressBar value={solved.n} max={solved.total} label={`${t.home_solved_of} ${solved.n} ${t.home_of} ${solved.total}`} /> : null}
      {lastSubmit ? (
        <p className="text-[13px] mt-3 flex gap-2 items-center flex-wrap" aria-live="polite">
          <span style={{ color: 'var(--muted)' }}>{t.home_last}</span>
          <Link className="underline focus-ring rounded type-mono" href={`/results/${lastSubmit.id}`} prefetch>#{lastSubmit.id}</Link>
          <VerdictPill verdict={lastSubmit.status} />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{timeAgo(lastSubmit.createdAt)}</span>
        </p>
      ) : (
        <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>{t.home_no_submits}</p>
      )}
      <div className="flex gap-3 mt-3 items-center flex-wrap">
        <Link href={`/contests/${recent.id}`} prefetch className="btn btn-primary focus-ring">{t.home_open_contest} <I d={P_ARROW} size={13} /></Link>
        <Link href="/results?me=1" prefetch className="text-[13px] underline focus-ring rounded" style={{ color: 'var(--muted)' }}>{t.home_my_results}</Link>
      </div>
    </section>
  );
}

/* ---------- status ---------- */

function StatusMini() {
  const lang = getLang();
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch(`${API}/api/status`);
        const j = await r.json();
        if (live) setSt(j);
      } catch { /* keep */ }
    }
    load();
    const iv = setInterval(load, 20000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  return (
    <p className="text-xs flex gap-2 items-center flex-wrap" style={{ color: 'var(--muted)' }} aria-live="polite">
      <span className="inline-block w-1.5 h-1.5 rounded-full" aria-hidden="true" style={{ background: (st?.queue || 0) > 0 ? 'var(--tle)' : 'var(--ok)' }} />
      {st ? `${STR[lang].home_queue} ${st.queue ?? 0}${st.etaSec != null ? ` · ETA ~${st.etaSec}s` : ''}` : STR[lang].home_checking_queue}
      <Link href="/status" prefetch className="underline focus-ring rounded ml-auto">status →</Link>
    </p>
  );
}

/* ---------- contests ---------- */

function ContestsCard({ joined, pending, loading, error, onRetry }) {
  const lang = getLang();
  const t = STR[lang];
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('joined');
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      try { document.getElementById('dash-contest-search')?.focus(); } catch { /* noop */ }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const rows = useMemo(() => {
    const base = tab === 'pending' ? (pending || []) : tab === 'all' ? [...(joined || []), ...(pending || [])] : (joined || []);
    const ql = q.trim().toLowerCase();
    const t0 = performance.now();
    let arr = ql ? base.filter((c) => `${c.name || ''} ${c.mode || ''}`.toLowerCase().includes(ql)) : [...base];
    arr.sort((a, b) => {
      const ta = a.endAt ? new Date(a.endAt).getTime() : Infinity;
      const tb = b.endAt ? new Date(b.endAt).getTime() : Infinity;
      return ta - tb;
    });
    if (typeof console !== 'undefined' && performance.now() - t0 > 100) console.warn('dashboard contest filter slow');
    return arr;
  }, [joined, pending, q, tab]);
  if (loading) return <section aria-label={t.home_my_contests}><SectionHead title={t.home_my_contests} /><Skeleton lines={3} /></section>;
  if (error) return <section aria-label={t.home_my_contests}><SectionHead title={t.home_my_contests} /><ErrorState title={t.home_err_contests} line={String(error)} action={<button type="button" onClick={onRetry} className="btn btn-secondary btn-compact focus-ring">{t.common_retry}</button>} /></section>;
  if (!(joined || []).length && !(pending || []).length) {
    return <section aria-label={t.home_my_contests}><SectionHead title={t.home_my_contests} /><EmptyState icon="○" line={t.home_not_joined} action={<Link href="/contests" prefetch className="btn btn-primary btn-compact focus-ring">{t.home_browse}</Link>} /></section>;
  }
  const shown = rows.slice(0, 6);
  return (
    <section aria-label={t.home_my_contests}>
      <SectionHead title={t.home_my_contests} count={(joined || []).length} action={<Link href="/contests" prefetch className="underline focus-ring rounded" style={{ color: 'var(--muted)' }}>{t.home_view_all}</Link>} />
      <div className="flex gap-3 mt-1 mb-2 flex-wrap items-center">
        <Tabs
          ariaLabel={t.home_filter_aria}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'joined', label: t.contests_joined, count: (joined || []).length },
            { id: 'pending', label: t.contests_pending, count: (pending || []).length },
            { id: 'all', label: t.home_tab_all },
          ]}
        />
        <label className="relative ml-auto flex-1 min-w-[10rem] max-w-[14rem]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-60" aria-hidden="true"><I d={P_SEARCH} size={13} /></span>
          <input id="dash-contest-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.home_filter_ph} className="w-full text-sm border rounded-full pl-8 pr-3 py-1.5 focus-ring" style={{ borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--fg)' }} />
        </label>
      </div>
      {!shown.length ? (
        <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>{t.home_no_match} “{q}”. <button type="button" onClick={() => setQ('')} className="underline focus-ring rounded">{t.home_clear}</button></p>
      ) : (
        <ul className="divide-y divide-[var(--border)] border-t border-b" style={{ borderColor: 'var(--border)' }}>
          {shown.map((c) => (
            <li key={c.id} className="py-3 flex gap-2 items-center flex-wrap">
              <Link className="font-medium focus-ring rounded text-sm truncate max-w-[16rem] hover:underline" href={`/contests/${c.id}`} prefetch>{c.name}</Link>
              <span className="type-mono" style={{ color: 'var(--muted)' }}>{c.mode}</span>
              {tab !== 'joined' && (pending || []).some((p) => p.id === c.id) ? <span className="text-xs" style={{ color: 'var(--tle-text)' }}>{t.home_pending_w}</span> : null}
              {c.endAt ? <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--muted)' }}><Countdown to={c.endAt} /></span> : null}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 ? <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>+{rows.length - 6} {t.home_more} — <Link href="/contests" prefetch className="underline focus-ring rounded">{t.home_browse_all}</Link></p> : null}
    </section>
  );
}

/* ---------- todo ---------- */

function TodoCard({ loading, error, upsolve, recommended, deadlines, onRetry }) {
  const lang = getLang();
  const t = STR[lang];
  if (loading) return <section aria-label={t.home_todo}><SectionHead title={t.home_todo} /><Skeleton lines={3} /></section>;
  if (error) return <section aria-label={t.home_todo}><SectionHead title={t.home_todo} /><ErrorState title={t.home_err_todo} line={String(error)} action={<button type="button" onClick={onRetry} className="btn btn-secondary btn-compact focus-ring">{t.common_retry}</button>} /></section>;
  if (!upsolve.length && !recommended.length && !deadlines.length) {
    return <section aria-label={t.home_todo}><SectionHead title={t.home_todo} /><EmptyState icon="✓" line={t.home_all_clear} action={<Link href="/contests" prefetch className="btn btn-primary btn-compact focus-ring">{t.home_browse}</Link>} /></section>;
  }
  const total = upsolve.length + recommended.length + deadlines.length;
  return (
    <section aria-label={t.home_todo}>
      <SectionHead title={t.home_todo} count={total} />
      {upsolve.length ? (
        <div className="mt-3 first:mt-0">
          <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{t.home_upsolve}</h3>
          <ul className="mt-1 divide-y divide-[var(--border)]">{upsolve.map((s) => (
            <li key={s.id} className="py-2.5 flex gap-2 items-start">
              <span className="mt-0.5 shrink-0"><VerdictPill verdict={s.status} /></span>
              <div className="min-w-0 flex-1">
                <Link className="hover:underline focus-ring rounded block truncate font-medium" href={`/contests/${s.contestId}/problems/${s.problemId}`} prefetch>{s._code ? <><span className="prob-code">{s._code}</span>{s._name ? <span className="font-normal"> · {s._name}</span> : null}</> : `${t.home_problem} #${s.problemId}`}</Link>
                <p className="type-mono mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{s._cname ? `${s._cname} · ` : ''}p#{s.problemId} · #{s.id} · {timeAgo(s.createdAt)}</p>
              </div>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {recommended.length ? (
        <div className="mt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{t.home_next}</h3>
          <ul className="mt-1 divide-y divide-[var(--border)]">{recommended.map((p) => (
            <li key={p.id} className="py-2 text-[13px]">
              <Link className="hover:underline focus-ring rounded block truncate" href={`/contests/${p.contestId}/problems/${p.id}`} prefetch><span className="prob-code">{p.code}</span> <span style={{ color: 'var(--muted)' }}>{p.name}</span></Link>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {deadlines.length ? (
        <div className="mt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{t.home_deadlines}</h3>
          <ul className="mt-1 divide-y divide-[var(--border)]">{deadlines.map((c) => (
            <li key={c.id} className="py-2 text-[13px] flex gap-2 items-baseline">
              <Link className="hover:underline font-medium focus-ring rounded truncate" href={`/contests/${c.id}`} prefetch>{c.name}</Link>
              <span className="ml-auto tabular-nums whitespace-nowrap" style={{ color: 'var(--muted)' }}><Countdown to={c.endAt} /></span>
            </li>
          ))}</ul>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- activity ---------- */

function ActivityCard({ submits, loading }) {
  const lang = getLang();
  const t = STR[lang];
  if (loading) return <section aria-label={t.home_activity}><SectionHead title={t.home_activity} /><Skeleton lines={3} /></section>;
  if (!submits || !submits.length) return null;
  const items = submits.slice(0, 8);
  return (
    <section aria-label={t.home_activity}>
      <SectionHead title={t.home_activity} action={<Link href="/results?me=1" prefetch className="underline focus-ring rounded" style={{ color: 'var(--muted)' }}>{t.home_view_all}</Link>} />
      <ul className="divide-y divide-[var(--border)] border-t border-b" style={{ borderColor: 'var(--border)' }} aria-live="polite">
        {items.map((s) => (
          <li key={s.id} className="py-2.5 text-sm flex gap-2 items-center flex-wrap">
            <VerdictPill verdict={s.status} />
            <Link className="hover:underline focus-ring rounded" href={`/contests/${s.contestId}/problems/${s.problemId}`} prefetch>p#{s.problemId}</Link>
            <Link className="hover:underline focus-ring rounded type-mono text-xs" style={{ color: 'var(--muted)' }} href={`/results/${s.id}`} prefetch>#{s.id}</Link>
            <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--muted)' }}>{timeAgo(s.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- progress ---------- */

function SparkBars({ counts, lang }) {
  const max = Math.max(1, ...counts);
  const label = lang === 'pl' ? 'Zaakceptowane · 14 dni' : 'Accepted · 14 days';
  const total = counts.reduce((a, b) => a + b, 0);
  const summary = counts.map((n, i) => `${13 - i}d: ${n}`).join(', ');
  return (
    <div>
      <SectionHead title={label} count={total} />
      <div className="flex items-end gap-[3px] h-10" role="img" aria-label={`${label} — ${summary}`}>
        {counts.map((n, i) => (
          <span
            key={i}
            aria-hidden="true"
            title={`${new Date(Date.now() - (13 - i) * 864e5).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-US')}: ${n}`}
            className="flex-1 rounded-sm"
            style={{ height: `${Math.max(4, Math.round((n / max) * 100))}%`, background: n ? 'var(--accent)' : 'var(--border)' }}
          />
        ))}
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {total > 0
          ? (lang === 'pl' ? `${total} zaakceptowanych zgłoszeń` : `${total} accepted submissions`)
          : (lang === 'pl' ? 'Brak zaakceptowanych zgłoszeń w tym okresie.' : 'No accepted submissions in this window.')}
      </p>
    </div>
  );
}

function ProgressCard({ spark, rank, contestName, lang }) {
  if (!spark && !rank) return null;
  const you = lang === 'pl' ? 'Ty' : 'You';
  return (
    <section aria-label={lang === 'pl' ? 'Postęp' : 'Progress'}>
      {spark ? <SparkBars counts={spark.counts} lang={lang} /> : null}
      {rank ? (
        <p className="text-sm mt-3 flex gap-1 items-center flex-wrap">
          <span style={{ color: 'var(--muted)' }}>{STR[lang].rank_your_standing}</span>
          <strong className="type-mono">{you} #{rank.rank}</strong>
          {rank.total != null ? <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>· {rank.total}</span> : null}
          {contestName ? <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>· {contestName}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

/* ---------- teacher ---------- */

function TeacherCard({ managed, counts }) {
  const lang = getLang();
  const t = STR[lang];
  if (!managed || !managed.length) return null;
  const total = managed.reduce((a, c) => a + (counts[c.id]?.pend || 0) + (counts[c.id]?.unans || 0), 0);
  return (
    <section aria-label={t.home_teacher}>
      <SectionHead title={t.home_teacher} count={total || undefined} action={<span className="text-xs" style={{ color: 'var(--muted)' }}>{t.home_approvals}</span>} />
      <ul className="divide-y divide-[var(--border)] border-t border-b" style={{ borderColor: 'var(--border)' }}>
        {managed.map((c) => {
          const info = counts[c.id];
          return (
            <li key={c.id} className="py-3 text-sm flex gap-2 items-center flex-wrap">
              <Link className="hover:underline font-medium focus-ring rounded truncate max-w-[16rem]" href={`/contests/${c.id}/manage`} prefetch>{c.name}</Link>
              {!info ? <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{t.home_checking}</span> : (
                <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                  {info.pend} {t.home_pending_w} · {info.unans} {t.home_unanswered_w}
                </span>
              )}
              <Link href={`/contests/${c.id}/manage`} prefetch className="text-[13px] underline focus-ring rounded ml-auto" style={{ color: 'var(--muted)' }}>{t.home_manage}</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- main ---------- */

export default function Home() {
  const lang = getLang();
  const { recentId, ready: recentReady } = useRecentId();
  const [me, setMe] = useState(undefined);
  const [meError, setMeError] = useState(null);
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState(null);
  const [joined, setJoined] = useState(null);
  const [joinedError, setJoinedError] = useState(null);
  const [pending, setPending] = useState(null);
  const [managed, setManaged] = useState(null);
  const [submits, setSubmits] = useState(null);
  const [submitsError, setSubmitsError] = useState(null);
  const [recent, setRecent] = useState(undefined);
  const [recentError, setRecentError] = useState(null);
  const [recentProblems, setRecentProblems] = useState(undefined);
  const [miniRank, setMiniRank] = useState(null);
  const [teacherCounts, setTeacherCounts] = useState({});
  const [status, setStatus] = useState(null);
  const [tick, setTick] = useState(0);

  async function loadSubmits() {
    try {
      const d = await api('/api/submits?me=1&limit=100');
      setSubmits(d.items || []);
      setSubmitsError(null);
    } catch (e) { setSubmitsError(String(e.message || e)); }
  }

  function retryAll() {
    setMeError(null);
    setJoinedError(null);
    setSubmitsError(null);
    setRecentError(null);
    setTick((v) => v + 1);
  }

  useEffect(() => {
    let live = true;
    api('/api/me').then((d) => { if (live) setMe(d); }).catch((e) => { if (live) { setMe(null); setMeError(String(e.message || e)); } });
    fetch(`${API}/api/status`).then((r) => r.json()).then((d) => { if (live) setStatus(d); }).catch(() => {});
    api('/api/contests').then((d) => { if (live) setOpen(d.items || []); }).catch(() => { if (live) setOpen([]); });
    return () => { live = false; };
  }, [tick]);

  const logged = !!me;

  useEffect(() => {
    if (!logged) return;
    let live = true;
    api('/api/notifications').then((d) => { if (live) setNotes(d.items || []); }).catch(() => { if (live) setNotes([]); });
    api('/api/contests?role=joined').then((d) => { if (live) { setJoined(d.items || []); setJoinedError(null); } }).catch((e) => { if (live) { setJoined([]); setJoinedError(String(e.message || e)); } });
    api('/api/contests?role=pending').then((d) => { if (live) setPending(d.items || []); }).catch(() => { if (live) setPending([]); });
    api('/api/contests?role=managed').then((d) => { if (live) setManaged(d.items || []); }).catch(() => { if (live) setManaged([]); });
    loadSubmits();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged, tick]);

  useEffect(() => {
    if (!logged || !recentReady || !recentId) { setRecent(null); setRecentProblems(null); return; }
    let live = true;
    // Keep stale data visible while refreshing — avoids skeleton flash on nav.
    // Only force skeleton on first load (recent === undefined already).
    setRecentError(null);
    api(`/api/contests/${recentId}`).then((d) => { if (live) setRecent(d); }).catch((e) => { if (live) { setRecent(null); setRecentError(String(e.message || e)); } });
    api(`/api/contests/${recentId}/problems`).then((d) => { if (live) setRecentProblems(d.items || []); }).catch(() => { if (live) setRecentProblems([]); });
    api(`/api/contests/${recentId}/ranking?mode=course`).then((d) => { if (live) setMiniRank(d); }).catch(() => {});
    return () => { live = false; };
  }, [logged, recentReady, recentId, tick]);

  /* Teacher counts: lazy per-contest, non-blocking. Parallel inner fetches. */
  useEffect(() => {
    if (!managed || !managed.length) return;
    let live = true;
    managed.forEach((c) => {
      Promise.all([
        api(`/api/contests/${c.id}/members`).then((d) => (d.pending || []).length).catch(() => 0),
        api(`/api/contests/${c.id}/clarifications`).then((d) => (d.items || []).filter((x) => !x.answer).length).catch(() => 0),
      ]).then(([pend, unans]) => {
        if (live) setTeacherCounts((prev) => ({ ...prev, [c.id]: { pend, unans } }));
      });
    });
    return () => { live = false; };
  }, [managed, tick]);

  /* Live: poll submits while any live verdict exists + refresh on focus. */
  const hasLive = useMemo(() => (submits || []).some((s) => ['QUE', 'CMP', 'TST'].includes(s.status)), [submits]);
  useEffect(() => {
    if (!logged) return;
    if (!hasLive) return;
    const iv = setInterval(loadSubmits, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged, hasLive]);
  useEffect(() => {
    if (!logged) return;
    const iv = setInterval(() => { loadSubmits(); }, 30000);
    function onFocus() { loadSubmits(); }
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged]);
  useEffect(() => {
    if (!submits) return;
    const live = submits.filter((s) => ['QUE', 'CMP', 'TST'].includes(s.status)).slice(0, 3);
    if (!live.length) return;
    const sources = live.map((s) => {
      try {
        const es = new EventSource(`${API}/api/submits/${s.id}/events`);
        es.onmessage = (ev) => {
          let d = null;
          try { d = JSON.parse(ev.data); } catch { return; }
          if (d && d.status && !['QUE', 'CMP', 'TST'].includes(d.status)) { es.close(); loadSubmits(); }
        };
        return es;
      } catch { return null; }
    }).filter(Boolean);
    return () => sources.forEach((es) => { try { es.close(); } catch { /* noop */ } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLive]);

  const stats = useMemo(() => {
    if (!submits) return { streak: 0, last: null, upsolve: [] };
    const accepted = submits.filter((s) => (s.status === 'OK' || s.status === 'ANS') && !s.sampleOnly);
    const seen = new Set();
    const upsolve = [];
    for (const s of submits) {
      if (s.status === 'OK' || s.status === 'ANS' || s.sampleOnly) continue;
      if (!s.problemId || seen.has(`${s.contestId}:${s.problemId}`)) continue;
      seen.add(`${s.contestId}:${s.problemId}`);
      upsolve.push(s);
      if (upsolve.length >= 5) break;
    }
    return { streak: streakDays(accepted.map((s) => s.createdAt).filter(Boolean)), last: submits[0] || null, upsolve };
  }, [submits]);

  const solved = useMemo(() => {
    if (!recentProblems) return null;
    const n = recentProblems.filter((p) => p._best === 'OK' || p._best === 'ANS').length;
    return { n, total: recentProblems.length };
  }, [recentProblems]);

  const recommended = useMemo(() => {
    if (!recentProblems) return [];
    const todo = recentProblems.filter((p) => !(p._best === 'OK' || p._best === 'ANS'));
    todo.sort((a, b) => (b.solvesPct || 0) - (a.solvesPct || 0) || String(a.code || '').localeCompare(String(b.code || '')));
    return todo.slice(0, 3).map((p) => ({ ...p, contestId: p.contestId || recentId }));
  }, [recentProblems, recentId]);

  const deadlines = useMemo(() => {
    return (joined || []).filter((c) => c.endAt).sort((a, b) => new Date(a.endAt) - new Date(b.endAt)).slice(0, 4);
  }, [joined]);

  const upsolveMeta = useMemo(() => {
    const byProb = new Map();
    for (const p of recentProblems || []) {
      const cid = p.contestId || recentId;
      byProb.set(`${cid}:${p.id}`, p);
      if (!byProb.has(String(p.id))) byProb.set(String(p.id), p);
    }
    const contestName = new Map((joined || []).map((c) => [String(c.id), c.name]));
    return (stats.upsolve || []).map((s) => {
      const hit = byProb.get(`${s.contestId}:${s.problemId}`) || byProb.get(String(s.problemId));
      return { ...s, _code: hit?.code, _name: hit?.name, _cname: contestName.get(String(s.contestId)) };
    });
  }, [stats.upsolve, recentProblems, recentId, joined]);

  const spark = useMemo(() => {
    if (!submits) return null;
    const counts = new Array(14).fill(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const s of submits) {
      if (s.status !== 'OK' && s.status !== 'ANS') continue;
      if (s.sampleOnly) continue;
      if (!s.createdAt) continue;
      const d = new Date(s.createdAt);
      d.setHours(0, 0, 0, 0);
      const diff = Math.round((today - d) / 864e5);
      if (diff < 0 || diff > 13) continue;
      counts[13 - diff] += 1;
    }
    return { counts, max: Math.max(1, ...counts) };
  }, [submits]);

  if (me === undefined || open === null) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <Skeleton lines={2} />
        <Skeleton lines={4} />
        <Skeleton lines={3} />
      </div>
    );
  }

  if (!logged) return <GuestHome status={status} open={open} />;

  if (meError && !me) {
    return (
      <div className="max-w-xl">
        <ErrorState title={STR[lang].home_err_profile} line={meError} action={
          <button type="button" onClick={retryAll} className="btn btn-primary btn-compact focus-ring">{STR[lang].common_retry}</button>
        } />
      </div>
    );
  }

  const unread = (notes || []).filter((n) => !n.read).length;
  const complete = [me.login, me.email, me.firstName, me.lastName, me.affiliationOrgId].filter(Boolean).length;
  const showTeacher = (managed || []).length > 0;
  const contestsLoading = joined === null;
  const recentLoading = recent === undefined || recentProblems === undefined;

  return (
    <>
      <FluidRippleBackground variant="header" />
      <div className="relative z-[1] max-w-5xl">
      <DashboardHeader me={me} unread={unread} complete={complete} lang={lang} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_250px] gap-10 mt-8 items-start">
        <div className="flex flex-col gap-10 min-w-0">
          <ContinueHero recentId={recentId} ready={recentReady} recent={recent} loading={recentLoading} error={recentError} solved={solved} lastSubmit={stats.last} onRetry={retryAll} />
          <ContestsCard joined={joined} pending={pending} loading={contestsLoading} error={joinedError} onRetry={retryAll} />
          <ActivityCard submits={submits} loading={submits === null} />
        </div>
        <aside className="flex flex-col gap-8 lg:sticky lg:top-20 min-w-0">
          <TodoCard loading={submits === null} error={submitsError} upsolve={upsolveMeta} recommended={recommended} deadlines={deadlines} onRetry={retryAll} />
          <ProgressCard spark={spark} rank={miniRank?.me?.rank != null ? miniRank.me : null} contestName={recent?.name || null} lang={lang} />
          <StatusMini />
          {showTeacher ? <TeacherCard managed={managed} counts={teacherCounts} /> : null}
        </aside>
      </div>
    </div>
    </>
  );
}

const GUEST_ARCH = [
  ['guest_arch_web_t', 'guest_arch_web_d'],
  ['guest_arch_api_t', 'guest_arch_api_d'],
  ['guest_arch_store_t', 'guest_arch_store_d'],
  ['guest_arch_judge_t', 'guest_arch_judge_d'],
  ['guest_arch_clients_t', 'guest_arch_clients_d'],
];

const GUEST_VS = [
  ['guest_vs_access_k', 'guest_vs_access_o', 'guest_vs_access_n'],
  ['guest_vs_stack_k', 'guest_vs_stack_o', 'guest_vs_stack_n'],
  ['guest_vs_live_k', 'guest_vs_live_o', 'guest_vs_live_n'],
  ['guest_vs_fail_k', 'guest_vs_fail_o', 'guest_vs_fail_n'],
  ['guest_vs_cont_k', 'guest_vs_cont_o', 'guest_vs_cont_n'],
];

function GuestHome({ status, open }) {
  const lang = getLang();
  const t = STR[lang];
  const list = (open || []).filter((c) => !c.archived);
  return (
    <>
      <FluidRippleBackground />
      <div className="guest-hero hero-scrim flex flex-col gap-4 max-w-3xl mx-auto text-center items-center pt-16 pb-10 min-h-[70svh] justify-center">
        <EyebrowFx text={t.guest_eyebrow} />
        <h1 className="type-display" style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)' }}>Satori V2</h1>
        <p className="text-sm mt-1 max-w-xl" style={{ color: 'var(--muted)' }}>{t.guest_tagline}</p>
        <div className="flex gap-2 mt-4 flex-wrap justify-center">
          <Link href="/login" prefetch className="btn btn-primary focus-ring">{t.guest_login}</Link>
          <Link href="/register" prefetch className="btn btn-secondary focus-ring">{t.guest_register}</Link>
          <Link href="/contests" prefetch className="btn btn-secondary focus-ring">{t.home_browse}</Link>
        </div>
        
      </div>
      <div className="guest-body flex flex-col gap-14 max-w-2xl mx-auto pb-16">
      <section>
        <EyebrowFx text={t.guest_about_eyebrow} />
        <h2 className="type-h1 mt-2">{t.guest_about_h}</h2>
        <p className="mt-4 max-w-xl" style={{ fontSize: '16px', lineHeight: '1.7', color: 'var(--muted)' }}>{t.guest_about_p1}</p>
        <p className="mt-3 max-w-xl" style={{ fontSize: '16px', lineHeight: '1.7', color: 'var(--muted)' }}>{t.guest_about_p2}</p>
      </section>
      <section className="pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <EyebrowFx text={t.guest_feat_eyebrow} />
        <dl className="mt-4">
          <div className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)' }}>
            <dt className="font-semibold text-sm">{t.guest_feat_live_t}</dt>
            <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t.guest_feat_live_d}</dd>
          </div>
          <div className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)' }}>
            <dt className="font-semibold text-sm">{t.guest_feat_icpc_t}</dt>
            <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t.guest_feat_icpc_d}</dd>
          </div>
          <div className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)' }}>
            <dt className="font-semibold text-sm">{t.guest_feat_labs_t}</dt>
            <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t.guest_feat_labs_d}</dd>
          </div>
          <div className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)' }}>
            <dt className="font-semibold text-sm">{t.guest_feat_play_t}</dt>
            <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t.guest_feat_play_d}</dd>
          </div>
          <div className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
            <dt className="font-semibold text-sm">{t.guest_feat_fair_t}</dt>
            <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t.guest_feat_fair_d}</dd>
          </div>
        </dl>
      </section>
      <section className="pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <EyebrowFx text={t.guest_arch_eyebrow} />
        <h2 className="type-h1 mt-2">{t.guest_arch_h}</h2>
        <p className="mt-4 max-w-xl" style={{ fontSize: '16px', lineHeight: '1.7', color: 'var(--muted)' }}>{t.guest_arch_p}</p>
        <dl className="mt-4">
          {GUEST_ARCH.map(([nk, dk]) => (
            <div key={nk} className="py-4 grid sm:grid-cols-[12rem_1fr] gap-1 sm:gap-4" style={{ borderTop: '1px solid var(--border)' }}>
              <dt className="font-semibold text-sm">{t[nk]}</dt>
              <dd className="text-sm" style={{ color: 'var(--muted)' }}>{t[dk]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <EyebrowFx text={t.guest_vs_eyebrow} />
        <h2 className="type-h1 mt-2">{t.guest_vs_h}</h2>
        <p className="type-mono text-xs mt-3" style={{ color: 'var(--muted)' }} aria-hidden="true"><span style={{ color: 'var(--wa)' }}>✕</span> original satori · <span style={{ color: 'var(--ok)' }}>✓</span> satori v2</p>
        <dl className="mt-4">
          {GUEST_VS.map(([k, o, n]) => (
            <div key={k} className="py-4 grid sm:grid-cols-[8rem_1fr_1fr] gap-2 sm:gap-6 items-start" style={{ borderTop: '1px solid var(--border)' }}>
              <dt className="font-semibold text-sm">{t[k]}</dt>
              <dd className="text-sm flex gap-2 items-start" style={{ color: 'var(--muted)' }}>
                <span aria-hidden="true" className="shrink-0" style={{ color: 'var(--wa)' }}>✕</span>
                <span><span className="sr-only">{t.guest_vs_sr_old}</span>{t[o]}</span>
              </dd>
              <dd className="text-sm flex gap-2 items-start">
                <span aria-hidden="true" className="shrink-0" style={{ color: 'var(--ok)' }}>✓</span>
                <span><span className="sr-only">{t.guest_vs_sr_new}</span>{t[n]}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="type-mono" style={{ color: 'var(--muted)' }} aria-live="polite">
          <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>{list.length}</strong> {t.guest_open_contests} · {t.guest_queue} <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>{status?.queue ?? '…'}</strong>{status && status.etaSec != null ? ` · ETA ~${status.etaSec}s` : ''} · <Link className="underline focus-ring rounded" href="/contests" prefetch>{t.guest_browse_link}</Link> · <Link className="underline focus-ring rounded" href="/status" prefetch>status →</Link>
        </p>
      </section>
      <section className="pt-10" style={{ borderTop: '1px solid var(--border)' }}>
        <EyebrowFx text={t.guest_how_eyebrow} />
        <ol className="mt-4 list-none ml-0">
          <li className="py-5 flex gap-5 items-baseline" style={{ borderTop: '1px solid var(--border)' }}><strong className="type-mono" style={{ fontSize: '20px', color: 'var(--muted)' }}>01</strong><span className="text-sm">{t.guest_how_1}</span></li>
          <li className="py-5 flex gap-5 items-baseline" style={{ borderTop: '1px solid var(--border)' }}><strong className="type-mono" style={{ fontSize: '20px', color: 'var(--muted)' }}>02</strong><span className="text-sm">{t.guest_how_2}</span></li>
          <li className="py-5 flex gap-5 items-baseline" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}><strong className="type-mono" style={{ fontSize: '20px', color: 'var(--muted)' }}>03</strong><span className="text-sm">{t.guest_how_3}</span></li>
        </ol>
      </section>
      <section className="pt-10 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <h2 className="type-h1">{t.guest_cta_h}</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>{t.guest_cta_p}</p>
        <div className="flex gap-2 mt-5 flex-wrap justify-center">
          <Link href="/register" prefetch className="btn btn-primary focus-ring">{t.guest_cta_btn}</Link>
          <Link href="/login" prefetch className="btn btn-secondary focus-ring">{t.guest_login}</Link>
        </div>
        <p className="text-sm mt-10" style={{ color: 'var(--muted)' }}>
          <Link className="underline focus-ring rounded" href="/languages" prefetch>{t.guest_link_languages}</Link> · <Link className="underline focus-ring rounded" href="/status" prefetch>Status</Link> · <a className="underline focus-ring rounded" href="https://satori.tcs.uj.edu.pl/">{t.guest_v1}</a>
        </p>
      </section>
      </div>
    </>
  );
}
