// B2.4/E3: results filters + grouped best-first + timeline + sample filter + pagination + compare.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, API, STR, getLang } from '../../lib/client';
import { Badge, Button, CodeBlock, DiffView, EmptyState, Icon, Input, Select, Skeleton, Table, Tabs, VerdictCell } from '../../components/ui';
import { toast } from '../../components/ui/Toast';

const VERDICTS = ['', 'OK', 'ANS', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'QUE', 'CMP', 'TST'];
const LIMITS = [25, 50, 100, 200];
// "Best first" = verdict quality order (accepted first, in-progress, then failures), newest first within a rank.
const VERDICT_RANK = { OK: 0, ANS: 1, TST: 2, CMP: 2, QUE: 2, WA: 3, TLE: 4, MLE: 4, RE: 5, CE: 6 };

const E3_TXT = {
  en: {
    hideSamples: 'hide sample runs',
    sample: 'sample',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    showing: 'showing {a} of {b}',
  },
  pl: {
    hideSamples: 'ukryj uruchomienia próbne',
    sample: 'próbne',
    loadMore: 'Wczytaj więcej',
    loadingMore: 'Wczytywanie…',
    showing: 'pokazano {a} z {b}',
  },
};

function loadLS(key, fb) {
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) : fb; } catch { return fb; }
}

function problemDisplay(s, metaMap) {
  const meta = metaMap[String(s.problemId)];
  const code = meta?.alias || meta?.code || null;
  const name = meta?.name || null;
  const label = code ? (name && name !== code ? `${code} · ${name}` : code) : `#${s.problemId}`;
  const href = s.contestId != null ? `/contests/${s.contestId}/problems/${s.problemId}` : null;
  return { label, href };
}

export default function ResultsPage({ searchParams }) {
  const t = STR[getLang()];
  const txt = E3_TXT[getLang() === 'pl' ? 'pl' : 'en'];
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [f, setF] = useState(() => ({
    contest: searchParams?.contest || '',
    problem: searchParams?.problem || '',
    verdict: searchParams?.verdict || '',
    me: '1',
    team: searchParams?.team || '',
    limit: LIMITS.includes(Number(searchParams?.limit)) ? Number(searchParams.limit) : loadLS('satori-results-limit', 50),
  }));
  const [hideSample, setHideSample] = useState(() => loadLS('satori-results-hide-sample', false));
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [probMeta, setProbMeta] = useState({});
  const [compare, setCompare] = useState([]);
  const [cmpCodes, setCmpCodes] = useState([]);
  const reqSeq = useRef(0);
  const metaSeen = useRef(new Set());

  function queryFor(offset) {
    const limit = Math.min(200, Math.max(1, Number(f.limit) || 50));
    const q = new URLSearchParams();
    if (f.contest) q.set('contest', f.contest);
    if (f.problem) q.set('problem', f.problem);
    if (f.verdict) q.set('verdict', f.verdict);
    if (f.me) q.set('me', '1');
    if (f.team) q.set('team', f.team);
    q.set('limit', String(limit));
    // E3: offset is deliberately not written to the URL; deep links stay on page one.
    if (offset > 0) q.set('offset', String(offset));
    return { q, limit };
  }

  async function load(offset = 0) {
    const my = ++reqSeq.current;
    setLoading(true);
    setError('');
    const { q, limit } = queryFor(offset);
    try { localStorage.setItem('satori-results-limit', JSON.stringify(limit)); } catch { /* noop */ }
    try {
      const d = await api(`/api/submits?${q}`);
      if (my !== reqSeq.current) return;
      const rows = d.items || [];
      setItems(offset > 0 ? (prev) => [...(prev || []), ...rows] : rows);
      setTotal(Number(d.total) || 0);
      if (offset === 0) {
        const url = new URL(window.location.href);
        url.search = q.toString();
        window.history.replaceState(null, '', url);
      }
    } catch (e) {
      if (my !== reqSeq.current) return;
      setError(String(e.message || e));
      if (offset === 0) setItems([]);
    } finally {
      if (my === reqSeq.current) setLoading(false);
    }
  }

  async function loadMore() {
    if (loading || loadingMore || items == null) return;
    const my = ++reqSeq.current;
    setLoadingMore(true);
    setError('');
    const { q } = queryFor(items.length);
    try {
      const d = await api(`/api/submits?${q}`);
      if (my !== reqSeq.current) return;
      setItems((prev) => {
        const seen = new Set((prev || []).map((x) => String(x.id)));
        return [...(prev || []), ...(d.items || []).filter((x) => !seen.has(String(x.id)))];
      });
      setTotal(Number(d.total) || 0);
    } catch (e) {
      if (my === reqSeq.current) toast(String(e.message || e), 'danger');
    } finally {
      setLoadingMore(false);
    }
  }

  const lockedContest = !!searchParams?.contest;

  useEffect(() => { load(); }, [f.contest, f.problem, f.verdict, f.me, f.team, f.limit]);

  // E3: resolve ids to contest code/name once per contest instead of raw numeric ids.
  useEffect(() => {
    if (!items || !items.length) return undefined;
    const ids = [...new Set(items.map((s) => s.contestId).filter((v) => v != null))];
    const missing = ids.filter((id) => !metaSeen.current.has(String(id)));
    if (!missing.length) return undefined;
    let live = true;
    Promise.all(missing.map((id) => api(`/api/contests/${id}/problems`)
      .then((d) => [id, d.items || []])
      .catch(() => [id, []])))
      .then((pairs) => {
        if (!live) return;
        const next = {};
        for (const [id, arr] of pairs) {
          metaSeen.current.add(String(id));
          for (const p of arr) next[String(p.id)] = p;
        }
        setProbMeta((prev) => ({ ...prev, ...next }));
      });
    return () => { live = false; };
  }, [items]);

  function toggleCompare(id) {
    setCompare((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id];
      if (next.length === 2) loadCompareCodes(next);
      else setCmpCodes([]);
      return next;
    });
  }

  function toggleHideSample() {
    const next = !hideSample;
    setHideSample(next);
    try { localStorage.setItem('satori-results-hide-sample', JSON.stringify(next)); } catch { /* noop */ }
  }

  async function downloadZip() {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('SATORI_TOKEN') : null;
      const params = new URLSearchParams();
      if (f.contest) params.set('contest', f.contest);
      if (f.problem) params.set('problem', f.problem);
      const res = await fetch(`${API}/api/submits/codes.zip?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my-codes.zip';
      a.click();
      toast(t.results_zip_done);
    } catch (e) { toast(`${t.res_download_failed} ${e.message}`, 'danger'); }
  }

  async function loadCompareCodes(ids) {
    const out = [];
    for (const id of ids) {
      try {
        const d = await api(`/api/submits/${id}`);
        out.push({ id, code: d.code || '', status: d.status, lang: d.lang });
      } catch { /* skip */ }
    }
    setCmpCodes(out);
  }

  const visible = useMemo(() => {
    const arr = items || [];
    return hideSample ? arr.filter((s) => !s.sampleOnly) : arr;
  }, [items, hideSample]);

  if (items === null) return <Skeleton lines={6} />;
  const rows = visible.map((s) => ({ ...s, _problem: problemDisplay(s, probMeta) }));
  const best = [...rows].sort((a, b) => {
    const ra = VERDICT_RANK[a.status] ?? 9;
    const rb = VERDICT_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const timeline = [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const cmp = compare.map((id) => (items || []).find((x) => String(x.id) === String(id))).filter(Boolean);
  const more = items.length < total;

  return (
    <div>
      <h1 className="type-h1">{t.me_results}</h1>
      <form className="flex flex-wrap gap-2 my-3 items-end" onSubmit={(e) => { e.preventDefault(); load(); }}>
        {lockedContest ? null : (
          <Input label={t.contest_fallback} placeholder="ID" value={f.contest} onChange={(e) => setF({ ...f, contest: e.target.value })} className="w-20 sm:!w-24 shrink-0" />
        )}
        <Input label={t.col_problem} placeholder="ID" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} className="flex-1 min-w-[90px] sm:!w-28" />
        <Select label={t.prob_verdict} value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })} className="flex-1 min-w-[110px] sm:!w-28">
          <option value="">{t.results_all}</option>
          {VERDICTS.slice(1).map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Select label={t.col_show} value={String(LIMITS.includes(Number(f.limit)) ? Number(f.limit) : 50)} onChange={(e) => setF({ ...f, limit: e.target.value })} className="w-20 sm:!w-24 shrink-0">
          {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <button
          type="button"
          aria-pressed={!!f.me}
          onClick={() => setF({ ...f, me: f.me ? '' : '1' })}
          className={`px-3 py-2 rounded-xl border text-sm font-semibold focus-ring transition shrink-0 ${f.me ? '' : 'opacity-60'}`}
          style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--fg)' }}
        >
          {f.me ? '●' : '○'} {t.res_mine}
        </button>
        <label className="flex gap-1 items-center text-sm py-2 shrink-0">
          <input type="checkbox" checked={hideSample} onChange={toggleHideSample} /> {txt.hideSamples}
        </label>
        <details className="text-sm py-2 shrink-0">
          <summary className="cursor-pointer underline opacity-70">{t.results_more}</summary>
          <div className="pt-1">
            <Input label={t.col_team} placeholder="ID" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} className="!w-28" />
          </div>
        </details>
        {items?.length ? <Button variant="ghost" onClick={downloadZip} title={t.results_zip_title}><Icon name="download" size={14} />ZIP</Button> : null}
      </form>
      {error ? <EmptyState line={error} action={<Button variant="secondary" onClick={() => load(0)}>{t.common_retry}</Button>} /> : null}
      {!error && !rows.length ? <EmptyState line={t.res_empty} /> : null}
      {!error && rows.length ? (
        <Tabs tabs={[
          { id: 'best', label: t.res_best_first, content: <ResultsTable rows={best} compare={compare} onCompare={toggleCompare} sampleLabel={txt.sample} /> },
          { id: 'time', label: t.res_timeline, content: <ResultsTable rows={timeline} compare={compare} onCompare={toggleCompare} sampleLabel={txt.sample} /> },
        ]} />
      ) : null}
      {!error && items.length ? (
        <div className="flex gap-2 items-center flex-wrap mt-3">
          <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{txt.showing.replace('{a}', String(items.length)).replace('{b}', String(total))}</span>
          {more ? <Button variant="secondary" onClick={loadMore} disabled={loadingMore || loading}>{loadingMore ? txt.loadingMore : txt.loadMore}</Button> : null}
        </div>
      ) : null}
      {cmp.length === 2 ? (
        <div className="mt-2">
          <strong className="text-sm">{t.res_compare_title.replace('{a}', String(cmp[0].id)).replace('{b}', String(cmp[1].id))}</strong>
          {cmpCodes.length === 2 ? <div className="mt-1"><DiffView expected={cmpCodes[0].code} got={cmpCodes[1].code} /></div>
            : <div className="grid md:grid-cols-2 gap-2 mt-1 text-xs">{cmp.map((s) => <CodeBlock key={s.id} language={s.lang} code={(s.code || '').slice(0, 4000)} />)}</div>}
        </div>
      ) : null}
    </div>
  );
}

function ResultsTable({ rows, compare, onCompare, sampleLabel }) {
  const t = STR[getLang()];
  return (
    <Table
      stickyHeader
      columns={[
        {
          key: 'id', label: '#',
          render: (s) => (
            <span className="inline-flex gap-1 items-center">
              <Link className="underline focus-ring rounded" href={`/results/${s.id}`} prefetch>#{s.id}</Link>
              {s.sampleOnly ? <Badge tone="warn">{sampleLabel}</Badge> : null}
            </span>
          ),
        },
        {
          key: 'problemId', label: t.col_problem,
          render: (s) => (s._problem?.href
            ? <Link className="underline focus-ring rounded" href={s._problem.href} prefetch>{s._problem.label}</Link>
            : <span className="type-mono">{s._problem?.label || `#${s.problemId}`}</span>),
        },
        {
          key: 'lang', label: t.col_lang,
          render: (s) => <span className="type-mono">{s.lang || '?'}</span>,
        },
        { key: 'status', label: t.prob_verdict, fill: true, render: (s) => <VerdictCell verdict={s.status} sub={s.cpuMs != null ? `${s.cpuMs}ms` : ''} /> },
        { key: 'createdAt', label: t.col_when, render: (s) => <span title={s.createdAt}>{s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</span> },
        { key: 'cmp', label: t.col_compare, render: (s) => <input type="checkbox" checked={compare.includes(s.id)} onChange={() => onCompare(s.id)} aria-label={t.res_compare_aria.replace('{id}', String(s.id))} /> },
      ]}
      rows={rows.map((s) => ({ ...s, key: s.id }))}
    />
  );
}
