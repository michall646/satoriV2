// B2.4: results filters + grouped best-first + timeline + compare + bundle.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, API, STR, getLang } from '../../lib/client';
import { Button, CodeBlock, DiffView, EmptyState, Input, Select, Skeleton, Table, Tabs, VerdictCell } from '../../components/ui';
import { toast } from '../../components/ui/Toast';

const VERDICTS = ['', 'OK', 'ANS', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'QUE', 'CMP', 'TST'];
const LIMITS = [25, 50, 100, 200];
// "Best first" = verdict quality order (accepted first, in-progress, then failures), newest first within a rank.
const VERDICT_RANK = { OK: 0, ANS: 1, TST: 2, CMP: 2, QUE: 2, WA: 3, TLE: 4, MLE: 4, RE: 5, CE: 6 };

function loadLS(key, fb) {
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) : fb; } catch { return fb; }
}

export default function ResultsPage({ searchParams }) {
  const t = STR[getLang()];
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState(() => ({
    contest: searchParams?.contest || '',
    problem: searchParams?.problem || '',
    verdict: searchParams?.verdict || '',
    me: '1', team: '', limit: loadLS('satori-results-limit', 50),
  }));
  const [compare, setCompare] = useState([]);
  const [cmpCodes, setCmpCodes] = useState([]);

  async function load() {
    setError('');
    const limit = Math.min(200, Math.max(1, Number(f.limit) || 50));
    try { localStorage.setItem('satori-results-limit', JSON.stringify(limit)); } catch { /* noop */ }
    const q = new URLSearchParams();
    if (f.contest) q.set('contest', f.contest);
    if (f.problem) q.set('problem', f.problem);
    if (f.verdict) q.set('verdict', f.verdict);
    if (f.me) q.set('me', '1');
    if (f.team) q.set('team', f.team);
    q.set('limit', String(limit));
    try {
      const d = await api(`/api/submits?${q}`);
      setItems(d.items || []);
      const url = new URL(window.location.href);
      url.search = q.toString();
      window.history.replaceState(null, '', url);
    } catch (e) { setError(String(e.message || e)); setItems([]); }
  }

  const lockedContest = !!searchParams?.contest;

  useEffect(() => { load(); }, [f.contest, f.problem, f.verdict, f.me, f.team, f.limit]);

  function toggleCompare(id) {
    setCompare((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id];
      if (next.length === 2) loadCompareCodes(next);
      else setCmpCodes([]);
      return next;
    });
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

  if (items === null) return <Skeleton lines={6} />;
  const best = [...(items || [])].sort((a, b) => {
    const ra = VERDICT_RANK[a.status] ?? 9;
    const rb = VERDICT_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  const timeline = [...(items || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const cmp = compare.map((id) => (items || []).find((x) => String(x.id) === String(id))).filter(Boolean);

  return (
    <div>
      <h1 className="type-h1">{t.me_results}</h1>
      <form className="flex flex-wrap gap-2 my-3 items-end" onSubmit={(e) => { e.preventDefault(); load(); }}>
        {lockedContest ? null : (
          <Input label={t.contest_fallback} placeholder="ID" value={f.contest} onChange={(e) => setF({ ...f, contest: e.target.value })} className="!w-24" />
        )}
        <Input label={t.col_problem} placeholder="ID" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} className="!w-28 flex-1 min-w-28" />
        <Select label={t.prob_verdict} value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })} className="!w-28">
          <option value="">{t.results_all}</option>
          {VERDICTS.slice(1).map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Select label={t.col_show} value={String(LIMITS.includes(Number(f.limit)) ? Number(f.limit) : 50)} onChange={(e) => setF({ ...f, limit: e.target.value })} className="!w-24">
          {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <button
          type="button"
          aria-pressed={!!f.me}
          onClick={() => setF({ ...f, me: f.me ? '' : '1' })}
          className={`px-3.5 py-2 rounded-xl border text-sm font-semibold focus-ring transition ${f.me ? '' : 'opacity-60'}`}
          style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--fg)' }}
        >
          {f.me ? '●' : '○'} {t.res_mine}
        </button>
        <details className="text-sm">
          <summary className="cursor-pointer underline opacity-70">{t.results_more}</summary>
          <div className="pt-1">
            <Input label={t.col_team} placeholder="ID" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} className="!w-28" />
          </div>
        </details>
        {items?.length ? <Button variant="ghost" onClick={downloadZip} title={t.results_zip_title}>⭳ ZIP</Button> : null}
      </form>
      {error ? <EmptyState line={error} action={<Button variant="secondary" onClick={load}>{t.common_retry}</Button>} /> : null}
      {!error && !items.length ? <EmptyState line={t.res_empty} /> : null}
      {!error && items.length ? (
        <Tabs tabs={[
          { id: 'best', label: t.res_best_first, content: <ResultsTable rows={best} compare={compare} onCompare={toggleCompare} /> },
          { id: 'time', label: t.res_timeline, content: <ResultsTable rows={timeline} compare={compare} onCompare={toggleCompare} /> },
        ]} />
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

function ResultsTable({ rows, compare, onCompare }) {
  const t = STR[getLang()];
  return (
    <Table
      stickyHeader
      columns={[
        { key: 'id', label: '#', render: (s) => <Link className="underline focus-ring rounded" href={`/results/${s.id}`} prefetch>#{s.id}</Link> },
        { key: 'problemId', label: t.col_problem },
        { key: 'lang', label: t.col_lang },
        { key: 'status', label: t.prob_verdict, fill: true, render: (s) => <VerdictCell verdict={s.status} sub={s.cpuMs != null ? `${s.cpuMs}ms` : ''} /> },
        { key: 'createdAt', label: t.col_when, render: (s) => <span title={s.createdAt}>{s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}</span> },
        { key: 'cmp', label: t.col_compare, render: (s) => <input type="checkbox" checked={compare.includes(s.id)} onChange={() => onCompare(s.id)} aria-label={t.res_compare_aria.replace('{id}', String(s.id))} /> },
      ]}
      rows={rows.map((s) => ({ ...s, key: s.id }))}
    />
  );
}
