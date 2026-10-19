// B2.1 flagship: cockpit — filters (?f= shareable), sort, fav, keyboard, notes, live SSE.
'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, API, FILENAME_RE, suggestFilename, getLang, STR } from '../lib/client';
import { Button, CodeEditor, Drawer, EmptyState, Input, Modal, Segmented, Select, Skeleton, VerdictPill, VERDICT_TONE as VCELL_TONE, VERDICT_ICON } from './ui';
import { toast } from './ui/Toast';

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v != null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
}

// E1: the API only accepts canonical language ids (validators.LANGUAGES); the old
// lowercase ids (cpp/python/java) are rejected with LANG_OFF.
const CANONICAL_LANGS = ['C', 'C++17', 'Java', 'Python', 'Rust', 'JavaScript'];

// E1: filename extension wins; conservative code hints only when there is no extension.
function detectLang(filename, code) {
  const f = String(filename || '').toLowerCase();
  if (f.endsWith('.py')) return 'Python';
  if (f.endsWith('.java')) return 'Java';
  if (f.endsWith('.rs')) return 'Rust';
  if (f.endsWith('.js')) return 'JavaScript';
  if (/\.(cpp|cc|cxx|hpp)$/.test(f)) return 'C++17';
  if (f.endsWith('.c') || f.endsWith('.h')) return 'C';
  const src = String(code || '');
  if (/\bfn\s+main\s*\(/.test(src)) return 'Rust';
  if (/\bSystem\.out\b|^\s*import\s+java\./m.test(src)) return 'Java';
  if (/\bconsole\.log\s*\(/.test(src)) return 'JavaScript';
  if (/(^|\n)\s*(def\s+\w+\s*\(|print\()/.test(src) || /^\s*(import\s+\w+|from\s+\w+\s+import)/m.test(src)) return 'Python';
  return 'C++17';
}

// E1: an explicit selector value wins only when it is canonical; never send anything else.
function languageOf(value, filename, code) {
  return CANONICAL_LANGS.includes(value) ? value : detectLang(filename, code);
}

// E5: team-aware view — prefer server team fields when present, keep the per-user shape otherwise.
function bestVerdict(p) { return p._teamBest || p._best; }
function bestScore(p) { return p._teamScore != null ? p._teamScore : p._score; }
function isSolved(p) { const v = bestVerdict(p); return v === 'OK' || v === 'ANS'; }

// E5: per-contest alias letter when the API sends one, problem code otherwise.
function codeOf(p) { return p.alias || p.code; }

function verdictLabel(p) {
  const t = STR[getLang()];
  const v = p._live || bestVerdict(p);
  if (!v) return t.cockpit_todo;
  const score = bestScore(p);
  return score != null ? `${v} ${score}` : v;
}

function verdictMeta(p) {
  const t = STR[getLang()];
  const live = p._live;
  const best = bestVerdict(p);
  const v = live || best;
  const tries = p._tries ?? 0;
  const score = bestScore(p);
  if (!v) return { main: t.cockpit_todo, icon: VERDICT_ICON.todo, sub: tries > 0 ? `${tries} ${t.cockpit_tries_l}` : t.cockpit_not_tried, tone: 'vcell-todo', isTodo: true };
  const isLive = live === 'QUE' || live === 'CMP' || live === 'TST';
  const icon = VERDICT_ICON[v] || '';
  const tone = VCELL_TONE[v] || 'vcell-CE';
  if (isLive) return { main: v, icon, sub: best ? `${t.cockpit_live} • ${t.cockpit_best} ${best}` : t.cockpit_live, tone, isLive: true };
  const scorePart = score != null ? `${score} ${t.cockpit_pts}` : null;
  const triesPart = `${tries} ${tries === 1 ? t.cockpit_try : t.cockpit_tries_l}`;
  return { main: v, icon, sub: scorePart ? `${scorePart} • ${triesPart}` : triesPart, tone };
}

function deadlineMeta(p) {
  const t = STR[getLang()];
  const at = p.effectiveDeadline;
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  const abs = new Date(at).toLocaleString();
  const overdue = diff < 0;
  const days = Math.abs(Math.ceil(diff / 86400000));
  const rel = overdue ? t.cockpit_dl_late.replace('{n}', String(days)) : days === 0 ? t.cockpit_today : t.cockpit_dl_left.replace('{n}', String(days));
  const urgent = !overdue && diff < 86400000;
  return { rel, abs, overdue, urgent, source: p.deadlineSource };
}

export default function ProblemCockpit({ contestId }) {
  const lang = getLang();
  const t = STR[lang];
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const f = sp.get('f');
      if (f) return { status: '', difficulty: '', tag: '', setter: '', group: '', ...JSON.parse(atob(f)) };
    } catch { /* noop */ }
    return { status: 'all', difficulty: '', tag: '', setter: '', group: '' };
  });
  const [sort, setSort] = useState({ key: 'code', dir: 'asc' });
  const [hideSolved, setHideSolved] = useState(() => loadLS('satori-hide-solved', false));
  const [open, setOpen] = useState(null);
  const [modal, setModal] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [kbNav, setKbNav] = useState(false);
  const [notes, setNotes] = useState({});
  const [miniRank, setMiniRank] = useState(null);

  async function load() {
    setError('');
    try {
      const d = await api(`/api/contests/${contestId}/problems`);
      setItems(d.items || []);
    } catch (e) { setError(String(e.message || e)); setItems([]); }
  }

  useEffect(() => { load(); }, [contestId]);
  useEffect(() => {
    api(`/api/contests/${contestId}/ranking?mode=course`).then((d) => setMiniRank(d)).catch(() => {});
  }, [contestId]);

  useEffect(() => {
    saveLS('satori-hide-solved', hideSolved);
  }, [hideSolved]);

  useEffect(() => {
    try {
      const code = btoa(JSON.stringify(filters));
      const url = new URL(window.location.href);
      url.searchParams.set('f', code);
      window.history.replaceState(null, '', url);
    } catch { /* noop */ }
  }, [filters]);

  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('pq')?.focus(); return; }
      if (typing) return;
      if (e.key === 'j') { setKbNav(true); setCursor((c) => Math.min(c + 1, Math.max(0, filtered.length - 1))); }
      if (e.key === 'k') { setKbNav(true); setCursor((c) => Math.max(0, c - 1)); }
      if (e.key === 'o') {
        const el = document.querySelector(`[data-row="${cursor}"] a`);
        if (el) el.click();
      }
      if (e.key === 's') {
        const cur = filtered[cursor];
        if (cur) setModal(cur);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function openNotes(p) {
    if (notes[p.id] !== undefined) return;
    try {
      const d = await api(`/api/notes?problem=${p.id}`);
      // E4: the API answers { items: [...] } — take the newest note's text.
      const items = Array.isArray(d?.items) ? d.items : [];
      const latest = items.reduce((acc, n) => (!acc || Number(n.id || 0) >= Number(acc.id || 0) ? n : acc), null);
      setNotes((prev) => ({ ...prev, [p.id]: latest ? String(latest.text || '') : String(d?.text || d?.note || '') }));
    } catch { setNotes((prev) => ({ ...prev, [p.id]: '' })); }
  }

  async function saveNotes(p) {
    try {
      await api('/api/notes', { method: 'POST', body: JSON.stringify({ problem: p.id, text: notes[p.id] || '' }) });
      toast(t.cockpit_note_saved);
    } catch (e) { toast(`${t.cockpit_note_failed} ${e.message}`); }
  }

  async function submitFromRow(p, code, filename, sampleOnly, language) {
    if (!FILENAME_RE.test(filename || '')) {
      const sug = suggestFilename(filename);
      toast(`${STR[lang].errors_filename_charset} ${STR[lang].errors_filename_suggest}: ${sug}`);
      return;
    }
    if ((code || '').length > 512 * 1024) { toast(t.subm_too_large); return; }
    const langGuess = languageOf(language, filename, code);
    let s;
    try {
      s = await api(`/api/problems/${p.id}/submit`, { method: 'POST', body: JSON.stringify({ code, filename, sampleOnly: !!sampleOnly, language: langGuess }) });
    } catch (e) { toast(`${t.subm_failed} ${e.message}`); return; }
    setModal(null);
    toast(t.subm_queued.replace('{id}', String(s.id)));
    const es = new EventSource(`${API}/api/submits/${s.id}/events`);
    es.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch { return; }
      if (d.status && !['QUE', 'CMP', 'TST'].includes(d.status)) {
        es.close();
        load();
        toast(`#${s.id} ${d.status}`);
      }
      setItems((prev) => (prev || []).map((x) => (x.id === p.id ? { ...x, _best: d.status || x._best, _live: d.phase || d.status, _flashAt: Date.now() } : x)));
    };
  }

  const filtered = useMemo(() => {
    if (!items) return [];
    const t0 = performance.now();
    const ql = q.toLowerCase();
    let arr = items.filter((p) => {
      if (ql && !`${p.code || ''} ${p.alias || ''} ${p.name || ''}`.toLowerCase().includes(ql)) return false;
      if (hideSolved && isSolved(p)) return false;
      if (filters.status === 'solved' && !isSolved(p)) return false;
      if (filters.status === 'tried' && !((p._tries ?? 0) > 0 && !isSolved(p))) return false;
      if (filters.status === 'todo' && (bestVerdict(p) || (p._tries ?? 0) > 0)) return false;
      if (filters.difficulty && String(p.difficulty || '') !== String(filters.difficulty)) return false;
      if (filters.tag && !(p.tags || []).includes(filters.tag)) return false;
      if (filters.setter && (p.setter || '') !== filters.setter) return false;
      if (filters.group && (p.group || p.set || '') !== filters.group) return false;
      return true;
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    arr = [...arr].sort((a, b) => {
      if (sort.key === 'name') return String(a.name || '').localeCompare(String(b.name || '')) * dir;
      if (sort.key === 'solves') return ((a.solvesPct || 0) - (b.solvesPct || 0)) * dir;
      if (sort.key === 'difficulty') return (String(a.difficulty || '').localeCompare(String(b.difficulty || ''))) * dir;
      if (sort.key === 'score') return ((bestScore(a) || 0) - (bestScore(b) || 0)) * dir;
      if (sort.key === 'deadline') {
        const ta = a.effectiveDeadline ? new Date(a.effectiveDeadline).getTime() : Infinity;
        const tb = b.effectiveDeadline ? new Date(b.effectiveDeadline).getTime() : Infinity;
        return (ta - tb) * dir;
      }
      return String(a.code || '').localeCompare(String(b.code || '')) * dir;
    });
    const dt = performance.now() - t0;
    if (dt > 100 && typeof console !== 'undefined') console.warn(`cockpit filter ${Math.round(dt)}ms over ${items.length} rows`);
    return arr;
  }, [items, q, hideSolved, filters, sort]);

  // E5: keep the keyboard cursor inside the filtered list after search/filter changes.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const stats = useMemo(() => {
    if (!items) return { solved: 0, total: 0, points: 0 };
    const solved = items.filter((p) => isSolved(p)).length;
    const points = items.reduce((s, p) => s + (bestScore(p) || 0), 0);
    return { solved, total: items.length, points };
  }, [items]);

  const facets = useMemo(() => {
    if (!items) return { difficulty: false, tag: false, setter: false };
    return {
      difficulty: items.some((p) => p.difficulty),
      tag: items.some((p) => (p.tags || []).length),
      setter: items.some((p) => p.setter),
    };
  }, [items]);

  const recommendations = useMemo(() => {
    if (!items) return { upsolve: [] };
    const upsolve = items.filter((p) => (p._tries || 0) > 0 && !isSolved(p)).slice(0, 5);
    return { upsolve };
  }, [items]);

  if (items === null) return <Skeleton lines={8} />;
  if (error) return <EmptyState line={error} action={<Button variant="secondary" onClick={load}>{t.common_retry}</Button>} />;
  const hasDeadlines = (items || []).some((p) => p.effectiveDeadline);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" aria-label={t.cockpit_progress_aria} style={{ color: 'var(--muted)' }}>
        <span>{t.cockpit_solved} <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>{stats.solved}/{stats.total}</strong></span>
        <span className="inline-block h-1 w-16 rounded-full overflow-hidden align-middle" role="progressbar" aria-valuenow={stats.solved} aria-valuemin={0} aria-valuemax={stats.total} aria-label={t.cockpit_solved_aria} style={{ background: 'var(--border)' }}>
          <span className="block h-1 rounded-full" style={{ width: stats.total ? `${Math.round((stats.solved / stats.total) * 100)}%` : '0%', background: 'var(--accent)' }} />
        </span>
        <span>{t.cockpit_points} <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>{stats.points}</strong></span>
        {miniRank?.me ? <span>{t.cockpit_rank} <strong className="tabular-nums" style={{ color: 'var(--fg)' }}>#{miniRank.me.rank}</strong></span> : null}
        <details className="ml-auto">
          <summary className="text-xs cursor-pointer focus-ring rounded">{t.cockpit_shortcuts}</summary>
          <p className="text-xs mt-1 type-mono">{t.cockpit_kb_help}</p>
        </details>
      </div>
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap gap-2 items-center py-1">
          <span className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--muted)' }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <Input id="pq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.cockpit_search_ph} className="!w-48 !pl-8" aria-label={t.cockpit_search_aria} />
          </span>
          <Segmented
            ariaLabel={t.cockpit_filter_status_aria}
            value={filters.status || 'all'}
            onChange={(v) => setFilters({ ...filters, status: v })}
            options={[
              { value: 'all', label: t.mprob_vis_all },
              { value: 'todo', label: t.home_todo },
              { value: 'tried', label: t.cockpit_f_tried },
              { value: 'solved', label: t.cockpit_solved },
            ]}
          />
          {items.length > 2 && facets.difficulty ? <Input value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })} placeholder={t.prob_difficulty} className="!w-24" /> : null}
          {items.length > 2 && facets.tag ? <Input value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} placeholder={t.cockpit_ph_tag} className="!w-24" /> : null}
          {items.length > 2 && facets.setter ? <Input value={filters.setter} onChange={(e) => setFilters({ ...filters, setter: e.target.value })} placeholder={t.cockpit_ph_setter} className="!w-24" /> : null}
          {items.length > 1 ? (
          <Select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir }); }} aria-label={t.cockpit_sort_aria} className="!w-auto !rounded-xl">
            <option value="code:asc">{t.prob_code} ↑</option>
            <option value="name:asc">{t.prob_name}</option>
            <option value="solves:desc">{t.prob_solves_pct}</option>
            <option value="difficulty:asc">{t.prob_difficulty}</option>
            <option value="score:desc">{t.prob_my_score}</option>
            {hasDeadlines ? <option value="deadline:asc">{t.prob_deadline} ↑</option> : null}
          </Select>
          ) : null}
          {stats.solved > 0 ? <label className="text-[13px] flex gap-1.5 items-center ml-auto" style={{ color: 'var(--muted)' }}><input type="checkbox" checked={hideSolved} onChange={(e) => setHideSolved(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> {STR[lang].hideSolved}</label> : null}
        </div>
        {!filtered.length ? <EmptyState line={STR[lang].empty_no_problems} /> : (
          <div className="doc-table overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="text-left py-3.5 pl-5 pr-4 text-[13px] font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{t.prob_code}</th><th className="text-left px-5 py-3.5 text-[13px] font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{t.prob_name}</th><th className="text-left px-5 py-3.5 text-[13px] font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{t.prob_verdict}</th>{hasDeadlines ? <th className="text-left px-5 py-3.5 text-[13px] font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{t.prob_deadline}</th> : null}<th className="px-5 py-3.5 text-[13px] font-medium" style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{t.prob_tries}</th><th style={{ borderBottom: '1px solid var(--border)' }}><span className="sr-only">{t.prob_actions}</span></th></tr></thead>
            <tbody>
              {filtered.map((p, i) => (
                <Fragment key={p.id}>
                  <tr data-row={i} className={`doc-row ${i === cursor && kbNav ? 'row-cursor' : ''} ${p._flashAt ? (p._flashAt % 2 ? 'row-flash-a' : 'row-flash-b') : ''}`} style={i === cursor && kbNav ? { background: 'rgb(128 140 155 / 0.14)', borderTop: '1px solid var(--border)' } : { borderTop: '1px solid var(--border)' }} onMouseEnter={() => setKbNav(false)}>
                    <td className="py-[18px] pl-5 pr-2 prob-code text-[13px]" style={{ color: 'var(--muted)' }}>{codeOf(p)}</td>
                    <td className="px-5 py-[18px]">
                      <span className="flex items-center gap-2.5">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none" style={{ color: 'var(--muted)' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                        <span>
                          <a className="block font-semibold text-[14px] leading-snug no-underline hover:underline focus-ring rounded" style={{ color: 'var(--fg)' }} href={`/contests/${contestId}/problems/${p.id}`}>{p.name}</a>
                          {p.solvesPct != null ? <span className="block text-xs mt-1 tabular-nums" style={{ color: 'var(--muted)' }}>{t.cockpit_solved_by} {Math.round(p.solvesPct)}%</span> : null}
                        </span>
                      </span>
                    </td>
                    <td className="vcell">
                      {(() => { const m = verdictMeta(p); return (
                        <button onClick={() => { setOpen(open === p.id ? null : p.id); openNotes(p); }} className={`vcell-fill ${m.tone}`} aria-expanded={open === p.id} aria-label={t.cockpit_verdict_hist.replace('{v}', verdictLabel(p))}>
                          <span>{m.icon ? `${m.icon} ${m.main}` : m.main}</span>
                          <span className="vcell-sub">{m.sub}</span>
                        </button>
                      ); })()}
                    </td>
                    {hasDeadlines ? (
                      <td className="px-5 py-[18px] text-[13px] tabular-nums" style={{ color: 'var(--muted)' }}>
                        {(() => { const d = deadlineMeta(p); if (!d) return <span>—</span>; return <span title={`${d.abs} (${d.source})`} style={d.overdue ? { color: 'var(--danger)', fontWeight: 600 } : d.urgent ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{d.rel}</span>; })()}
                      </td>
                    ) : null}
                    <td className="px-5 py-[18px] text-center tabular-nums text-[13px]" style={{ color: 'var(--muted)' }}>{p._tries ?? 0}</td>
                    <td className="whitespace-nowrap text-right pr-5">
                      <Button variant="secondary" className="btn-compact" onClick={() => setModal(p)}>{t.submit}</Button>
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr><td colSpan={hasDeadlines ? 6 : 5}><RowDrawer problem={p} contestId={contestId} note={notes[p.id]} setNote={(v) => setNotes((prev) => ({ ...prev, [p.id]: v }))} onSaveNote={() => saveNotes(p)} onClose={() => setOpen(null)} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {recommendations.upsolve.length > 0 ? (
          <div className="text-sm">
            <div>
              <strong className="type-h2">{t.cockpit_upsolve} ({recommendations.upsolve.length})</strong>
              <ul className="mt-1 flex flex-col">{recommendations.upsolve.map((p) => <li key={p.id} className="py-1" style={{ borderTop: '1px solid var(--border)' }}><a className="font-medium no-underline hover:underline focus-ring rounded" href={`/contests/${contestId}/problems/${p.id}`}>{codeOf(p)} {p.name}</a> <span className="text-xs" style={{ color: 'var(--muted)' }}>{p._tries} {t.cockpit_tries_l}</span></li>)}</ul>
            </div>
          </div>
        ) : null}
      </div>
      {modal && <SubmitModal problem={modal} onClose={() => setModal(null)} onSubmit={submitFromRow} />}
    </div>
  );
}

function RowDrawer({ problem, contestId, note, setNote, onSaveNote, onClose }) {
  const t = STR[getLang()];
  const [hist, setHist] = useState(null);
  useEffect(() => { api(`/api/submits?problem=${problem.id}&me=1&limit=3`).then((d) => setHist(d.items || [])).catch(() => setHist([])); }, [problem.id]);
  if (hist === null) return <Skeleton lines={2} />;
  return (
    <Drawer open title={`${codeOf(problem)} ${t.cockpit_history_l}`} onClose={onClose}>
      <div className="flex flex-col gap-1">
        {hist.map((s) => <div key={s.id}>#{s.id} {s.lang} <VerdictPill verdict={s.status} /> <a className="underline" href={`/results/${s.id}`}>{t.cockpit_view_diff}</a></div>)}
        {!hist.length ? <span className="text-muted">{t.cockpit_no_submits}</span> : null}
        <a className="underline" href={`/results?problem=${problem.id}`}>{t.cockpit_full_history}</a>
        <div className="mt-2">
          <label className="text-xs">{t.cockpit_private_note}<input value={note || ''} onChange={(e) => setNote(e.target.value)} placeholder={t.cockpit_note_ph} className="border rounded px-1 ml-1 text-xs" /></label>
          <button onClick={onSaveNote} className="ml-1 text-xs border px-2 rounded focus-ring">{t.common_save}</button>
          <button onClick={() => { try { navigator.clipboard.writeText(note || ''); } catch { /* noop */ } }} className="ml-1 text-xs border px-2 rounded focus-ring">{t.cockpit_export}</button>
        </div>
      </div>
    </Drawer>
  );
}

function SubmitModal({ problem, onClose, onSubmit }) {
  const t = STR[getLang()];
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState('solution.cpp');
  const [language, setLanguage] = useState('');
  const [sampleOnly, setSampleOnly] = useState(false);
  const [drag, setDrag] = useState(false);
  const [fnameError, setFnameError] = useState('');

  function onFile(f) {
    if (!f) return;
    if (f.size > 512 * 1024) { toast(t.subm_too_large); return; }
    setFilename(f.name || filename);
    if (!FILENAME_RE.test(f.name || '')) setFnameError(`${suggestFilename(f.name)}?`);
    const r = new FileReader();
    r.onload = () => setCode(String(r.result || ''));
    r.readAsText(f);
  }

  function submit() {
    if (!FILENAME_RE.test(filename)) { setFnameError(suggestFilename(filename)); return; }
    onSubmit(problem, code, filename, sampleOnly, languageOf(language, filename, code));
  }

  return (
    <Modal open onClose={onClose} title={`${t.submit} ${problem.code} — ${problem.name}`} onSubmit={submit} submitLabel={t.submit}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
        className={`border rounded p-2 ${drag ? 'border-accent' : ''}`}
      >
        <Input label={t.subm_filename} value={filename} onChange={(e) => { setFilename(e.target.value); setFnameError(FILENAME_RE.test(e.target.value) ? '' : suggestFilename(e.target.value)); }} error={fnameError ? `${t.subm_invalid_try} ${fnameError}` : ''} hint={t.subm_drag_hint} />
        <div className="flex gap-2 mt-1 text-xs">
          <input type="file" onChange={(e) => onFile(e.target.files?.[0])} aria-label={t.cockpit_file_aria} />
          <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t.cockpit_lang_aria}>
            <option value="">auto ({detectLang(filename, code)})</option>
            {CANONICAL_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
        <label className="block text-sm mt-2">{t.prob_code}<CodeEditor value={code} onChange={setCode} filename={filename} height="240px" onSubmit={submit} placeholder={t.cockpit_paste_ph} /></label>
        <label className="text-xs flex gap-1 items-center mt-1"><input type="checkbox" checked={sampleOnly} onChange={(e) => setSampleOnly(e.target.checked)} /> {t.cockpit_sample_run}</label>
        {fnameError ? <Button variant="secondary" className="mt-1" onClick={() => { setFilename(fnameError); setFnameError(''); }}>{t.cockpit_apply} {fnameError}</Button> : null}
      </div>
    </Modal>
  );
}
