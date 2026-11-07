// Ranking: single mode per contest (Plan B), per-problem columns, CSV export, ticker.
'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, API, STR, getLang, withAuth } from '../../../../lib/client';
import { Badge, Button, EmptyState, Icon, Notice, Skeleton, Table } from '../../../../components/ui';
import { Countdown } from '../../../../components/ui/Code';

export default function RankingPage({ params }) {
  const t = STR[getLang()];
  const [mode, setMode] = useState(null);
  const [contestMode, setContestMode] = useState(null);
  const [problems, setProblems] = useState([]);
  const [rows, setRows] = useState(null);
  const [freeze, setFreeze] = useState(null);
  const [unfreezeAt, setUnfreezeAt] = useState(null);
  const [frozen, setFrozen] = useState(false);
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });
  const [openTeam, setOpenTeam] = useState(null);
  const [ticker, setTicker] = useState([]);
  const [deadlinePolicy, setDeadlinePolicy] = useState(null);
  const [boardMode, setBoardMode] = useState('everyone');
  const [meLogin, setMeLogin] = useState(null);
  const [meStanding, setMeStanding] = useState(null);
  const [penaltyMin, setPenaltyMin] = useState(20);

  async function load(unfrozenView = false) {
    const query = unfrozenView ? '?unfrozen=1' : '';
    const cacheKey = `satori-ranking-${params.id}${unfrozenView ? '-unfrozen' : ''}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const c = JSON.parse(cached);
        if (Date.now() - c.at < 15000) {
          setRows(c.rows);
          setProblems(c.problems || []);
          setMode(c.mode || null);
          setFreeze(c.freezeAt || null);
          setUnfreezeAt(c.unfreezeAt || null);
          setFrozen(Boolean(c.frozen));
        }
      }
    } catch { /* noop */ }
    try {
      const d = await api(`/api/contests/${params.id}/ranking${query}`);
      const rowsData = d.rows || [];
      const probs = d.problems || [];
      setRows(rowsData);
      setProblems(probs);
      setMode(d.mode || 'ICPC');
      setContestMode(d.contestMode || d.mode || 'ICPC');
      setFreeze(d.freezeAt || null);
      setDeadlinePolicy(d.deadlinePolicy || null);
      setUnfreezeAt(d.unfreezeAt || null);
      // B3/B9: the server owns freeze state; keep a timestamp fallback for old APIs.
      const freezeNow = typeof d.frozen === 'boolean'
        ? d.frozen
        : Boolean(d.freezeAt && (!d.unfreezeAt || new Date(d.unfreezeAt).getTime() > Date.now()));
      setFrozen(freezeNow);
      setMeStanding(d.me || null);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), rows: rowsData, problems: probs, mode: d.mode, freezeAt: d.freezeAt || null, unfreezeAt: d.unfreezeAt || null, frozen: freezeNow })); } catch { /* noop */ }
    } catch { setRows([]); }
  }

  useEffect(() => {
    const unfrozenView = new URLSearchParams(window.location.search).get('unfrozen') === '1';
    load(unfrozenView);
    const query = unfrozenView ? '?unfrozen=1' : '';
    const es = new EventSource(withAuth(`${API}/api/contests/${params.id}/rankings/live${query}`));
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.clarification) setTicker((prev) => [d.clarification, ...prev].slice(0, 5));
        else load(unfrozenView);
      } catch { load(unfrozenView); }
    };
    api(`/api/contests/${params.id}/clarifications`).then((d) => setTicker((d.items || []).slice(0, 5))).catch(() => {});
    api(`/api/contests/${params.id}`).then((c) => {
      setBoardMode(c.settings?.board?.mode || 'everyone');
      setPenaltyMin(c.settings?.penaltyMin ?? c.settings?.scoring?.wrongTryMin ?? c.penalty ?? 20);
    }).catch(() => {});
    api('/api/me').then((m) => setMeLogin(m.login || null)).catch(() => {});
    return () => es.close();
  }, [params.id]);

  const displayRows = boardMode === 'me-only' && meLogin
    ? rows?.filter((r) => r.name === meLogin)
    : rows;

  const shown = useMemo(() => {
    if (!displayRows) return [];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...displayRows].sort((a, b) => {
      if (sort.key === 'name') return String(a.name).localeCompare(String(b.name)) * dir;
      if (sort.key === 'solved') return ((a.solved ?? a.total ?? 0) - (b.solved ?? b.total ?? 0)) * dir;
      if (sort.key === 'time') return ((a.time || 0) - (b.time || 0)) * dir;
      return ((a.rank || 0) - (b.rank || 0)) * dir;
    });
  }, [displayRows, sort]);

  function cellText(cell) {
    if (cell == null) return '-';
    if (typeof cell === 'string') return cell === '' ? '-' : cell;
    return cell.text ?? (cell.points != null ? String(cell.points) : '-');
  }

  function exportCSV() {
    const probHead = problems.map((p) => `"${String(p.code || p.id).replace(/"/g, '""')}"`).join(',');
    const head = mode === 'ICPC' ? `rank,name,time,${probHead ? `${probHead},` : ''}solved\n` : `rank,name,${probHead ? `${probHead},` : ''}total\n`;
    const body = shown.map((r) => {
      const cells = problems.map((p) => {
        const c = r.cells?.[p.id];
        return `"${cellText(c).replace(/"/g, '""')}"`;
      }).join(',');
      if (mode === 'ICPC') return `${r.rank},"${(r.name || '').replace(/"/g, '""')}",${r.time ?? ''},${cells},${r.solved ?? ''}`;
      return `${r.rank},"${(r.name || '').replace(/"/g, '""')}",${cells ? `${cells},` : ''}${r.total ?? ''}`;
    }).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ranking-${params.id}-${mode || 'ranking'}.csv`;
    a.click();
  }

  function onSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  if (rows === null || mode === null) return <Skeleton lines={8} />;
  const isICPC = mode === 'ICPC';
  const scoreCol = isICPC
    ? { key: 'solved', label: t.cockpit_solved, sortKey: 'solved', align: 'right', minWidth: 72, stickyRight: true, render: (r) => <strong>{r.solved ?? '—'}</strong> }
    : { key: 'solved', label: t.col_total, sortKey: 'solved', align: 'right', minWidth: 72, stickyRight: true, render: (r) => <strong>{r.total ?? '—'}</strong> };

  return (
    <div>
      <div className="flex items-start justify-between gap-x-6 gap-y-3 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="type-h1">{t.ranking}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-2 min-h-[22px]">
            <Badge tone="neutral">{mode}</Badge>
            {contestMode && contestMode !== mode ? <span className="type-small" style={{ color: 'var(--muted)' }}>{t.rank_contest_suffix.replace('{mode}', contestMode)}</span> : null}
            {freeze && !frozen ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge tone="neutral">{t.rank_freeze}</Badge>
                <span className="type-mono" style={{ color: 'var(--muted)' }}><Countdown to={freeze} /></span>
              </span>
            ) : null}
            {deadlinePolicy?.enabled ? (
              <Badge tone="neutral" title={t.rank_late_mode_title.replace('{m}', deadlinePolicy.lateMode).replace('{v}', String(deadlinePolicy.penaltyValue)).replace('{unit}', deadlinePolicy.penaltyKind)}>
                <span style={{ color: 'var(--muted)' }}>{t.rank_deadlines}</span>
                <span className="mx-1" style={{ opacity: 0.45 }}>·</span>
                <span>{deadlinePolicy.lateMode}</span>
                <span className="mx-1" style={{ opacity: 0.45 }}>·</span>
                <span style={{ color: 'var(--muted)' }}>{t.rank_late_mark}</span>
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Button variant="secondary" onClick={exportCSV}>{t.rank_export_csv}</Button>
          <Button variant="ghost" onClick={() => window.print()}>{t.rank_print}</Button>
        </div>
      </div>
      {frozen ? (
        <Notice tone="warn" role="alert" title={t.rank_frozen_msg} icon={<Icon name="lock" size={15} />} className="mb-2">
          {unfreezeAt ? <Countdown to={unfreezeAt} label={t.rank_to_unfreeze} /> : null}
        </Notice>
      ) : null}
      {boardMode === 'hidden' ? (
        <Notice tone="info" icon={<Icon name="eyeOff" size={15} />} className="mb-2">
          {t.rank_board_hidden}
        </Notice>
      ) : null}
      {boardMode === 'me-only' ? (
        <Notice tone="info" icon={<Icon name="user" size={15} />} className="mb-2">
          {t.rank_board_private}
        </Notice>
      ) : null}
      {meStanding ? (
        <p className="flex items-baseline gap-2 text-sm mb-2" style={{ color: 'var(--muted)' }}>
          {t.rank_your_standing}
          <strong className="type-mono" style={{ color: 'var(--fg)', fontSize: 13 }}>#{meStanding.rank}</strong>
          {meStanding.total != null ? <span className="type-mono" style={{ color: 'var(--muted)' }}>· {meStanding.total} {t.rank_pts}</span> : null}
        </p>
      ) : null}
      {ticker.length ? (
        <Notice icon={<Icon name="message" size={15} />} className="mb-2" aria-live="polite">
          <p className="eyebrow">{t.rank_ticker}</p>
          <p className="text-sm leading-5 mt-0.5" style={{ color: 'var(--fg)' }}>{ticker.map((item) => item.question || item).join(' · ')}</p>
        </Notice>
      ) : null}
      <div className="mt-1">
      {boardMode === 'hidden' ? <EmptyState line={t.rank_empty_hidden} /> : !shown.length ? <EmptyState line={t.rank_empty_rows} /> : (
        <Table
          stickyHeader stickyFirstCols stickyLast sort={sort} onSort={onSort}
          caption={`${mode} ranking. ${isICPC ? t.rank_penalty_caption.replace('{n}', String(penaltyMin)) : t.rank_points_caption} ${t.rank_times_caption}`}
          columns={[
            { key: 'rank', label: t.col_rank, sortKey: 'rank', align: 'right', minWidth: 52 },
            { key: 'name', label: t.prob_name, sortKey: 'name', minWidth: 160, render: (r) => <span><button onClick={() => setOpenTeam(openTeam === r.contestantId ? null : r.contestantId)} className="underline focus-ring rounded">{r.name}</button>{openTeam === r.contestantId && r.members ? <span className="block text-xs text-muted">{r.members.join(', ')}</span> : null}</span> },
            ...(isICPC ? [{ key: 'time', label: t.col_time, sortKey: 'time', align: 'right', minWidth: 72, render: (r) => <span title={r.timeUtc || r.time}>{r.time ?? ''}</span> }] : []),
            ...problems.slice(0, 12).map((p) => ({
              key: `p-${p.id}`, label: String(p.code || 'P'), align: 'center', minWidth: 88, render: (r) => {
                const cell = r.cells?.[p.id];
                if (cell == null) return <span className="text-muted">-</span>;
                if (typeof cell === 'object') {
                  const txt = cell.text ?? `${cell.points ?? '-'}`;
                  return <span title={cell.late ? t.rank_late_title : String(cell.text || '')} style={cell.late ? { fontWeight: 600 } : undefined}>{txt}</span>;
                }
                return <span>{String(cell)}</span>;
              },
            })),
            scoreCol,
          ]}
          rows={shown.map((r) => ({ ...r, key: r.contestantId || r.name }))}
        />
      )}
      </div>
      <style>{`@media print { header, button, input, select { display: none !important; } table { font-size: 10px; } }`}</style>
    </div>
  );
}
