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
  const [replayActive, setReplayActive] = useState(false);
  const [replayData, setReplayData] = useState(null);
  const [replayTimeMs, setReplayTimeMs] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(10);
  const [unfreezeRevealed, setUnfreezeRevealed] = useState(false);

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = String(totalMin % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  async function toggleReplay() {
    if (replayActive) {
      setReplayActive(false);
      setIsPlaying(false);
      return;
    }
    try {
      const data = await api(`/api/contests/${params.id}/ranking/replay${unfreezeRevealed ? '?unfrozen=1' : ''}`);
      setReplayData(data);
      const startMs = new Date(data.startAt || data.events[0]?.createdAt || Date.now() - 3600000).getTime();
      const endMs = new Date(data.endAt || data.events[data.events.length - 1]?.createdAt || Date.now()).getTime();
      setReplayTimeMs(endMs);
      setReplayActive(true);
    } catch {
      /* ignore */
    }
  }

  async function toggleUnfreezeReveal() {
    const nextRevealed = !unfreezeRevealed;
    setUnfreezeRevealed(nextRevealed);
    try {
      const data = await api(`/api/contests/${params.id}/ranking/replay${nextRevealed ? '?unfrozen=1' : ''}`);
      setReplayData(data);
    } catch {
      /* ignore */
    }
  }

  function computeReplayRows(data, timeMs, isICPC, penalty = 20, unfreeze = false) {
    if (!data || !data.contestants) return [];
    const startMs = new Date(data.startAt || (data.events[0]?.createdAt) || 0).getTime();
    const visibleEvents = (data.events || []).filter((e) => new Date(e.createdAt).getTime() <= timeMs);

    if (isICPC) {
      const computed = data.contestants.map((ct) => {
        const subs = visibleEvents.filter((e) => e.contestantId === ct.id);
        let solved = 0;
        let totalPenalty = 0;
        const cells = {};
        for (const p of (data.problems || [])) {
          const pSubs = subs.filter((e) => String(e.problemId) === String(p.id));
          let tries = 0;
          let solvedTry = null;
          let solvedMin = null;
          for (const s of pSubs) {
            if (solvedTry !== null) continue;
            const isOK = (s.status === 'OK') || (unfreeze && s.realStatus === 'OK');
            tries += 1;
            if (isOK) {
              solvedTry = tries;
              const diffMs = Math.max(0, new Date(s.createdAt).getTime() - startMs);
              solvedMin = Math.floor(diffMs / 60000);
              break;
            }
          }
          if (solvedTry !== null) {
            solved += 1;
            const pCost = solvedMin + (solvedTry - 1) * penalty;
            totalPenalty += pCost;
            const h = Math.floor(solvedMin / 60);
            const m = String(solvedMin % 60).padStart(2, '0');
            cells[p.id] = { text: `${solvedTry} (${h}:${m})`, points: 100, solved: true };
          } else if (tries > 0) {
            const hasFrozen = pSubs.some((s) => s.frozen && !unfreeze);
            cells[p.id] = { text: hasFrozen ? `${tries} ?` : `${tries}`, points: 0, tries };
          } else {
            cells[p.id] = { text: '-', points: 0 };
          }
        }
        return {
          contestantId: ct.id,
          name: ct.name,
          members: ct.members,
          solved,
          time: totalPenalty,
          cells,
        };
      });
      computed.sort((a, b) => b.solved - a.solved || a.time - b.time || String(a.name).localeCompare(String(b.name)));
      computed.forEach((r, i) => { r.rank = i + 1; });
      return computed;
    } else {
      const computed = data.contestants.map((ct) => {
        const subs = visibleEvents.filter((e) => e.contestantId === ct.id);
        let total = 0;
        const cells = {};
        for (const p of (data.problems || [])) {
          const pSubs = subs.filter((e) => String(e.problemId) === String(p.id));
          let best = 0;
          let hasPending = false;
          for (const s of pSubs) {
            const pts = unfreeze ? (s.realStatus === 'OK' ? 100 : Number(s.points || 0)) : (s.frozen ? 0 : Number(s.points || (s.status === 'OK' ? 100 : 0)));
            if (pts > best) best = pts;
            if (s.frozen && !unfreeze) hasPending = true;
          }
          total += best;
          cells[p.id] = { text: hasPending ? `${best} ?` : String(best), points: best };
        }
        return { contestantId: ct.id, name: ct.name, members: ct.members, total, cells };
      });
      computed.sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));
      computed.forEach((r, i) => { r.rank = i + 1; });
      return computed;
    }
  }

  const startMs = replayData
    ? new Date(replayData.startAt || replayData.events?.[0]?.createdAt || Date.now() - 3600000).getTime()
    : Date.now() - 3600000;
  const endMs = replayData
    ? new Date(replayData.endAt || replayData.events?.[replayData.events.length - 1]?.createdAt || Date.now()).getTime()
    : Date.now();

  useEffect(() => {
    if (!replayActive || !isPlaying || !replayData) return;
    const interval = setInterval(() => {
      setReplayTimeMs((prev) => {
        const next = (prev || startMs) + playSpeed * 1000;
        if (next >= endMs) {
          setIsPlaying(false);
          return endMs;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [replayActive, isPlaying, playSpeed, replayData, endMs, startMs]);

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

  const displayRows = replayActive && replayData
    ? computeReplayRows(replayData, replayTimeMs, mode === 'ICPC', penaltyMin, unfreezeRevealed)
    : (boardMode === 'me-only' && meLogin
      ? rows?.filter((r) => r.name === meLogin)
      : rows);

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
          <Button variant={replayActive ? 'primary' : 'secondary'} onClick={toggleReplay}>
            {replayActive ? t.rank_replay_live : t.rank_replay}
          </Button>
          <Button variant="secondary" onClick={exportCSV}>{t.rank_export_csv}</Button>
          <Button variant="ghost" onClick={() => window.print()}>{t.rank_print}</Button>
        </div>
      </div>
      {replayActive ? (
        <div className="card p-3 mb-3 flex flex-col gap-2.5" style={{ background: 'var(--panel-wash)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap text-sm">
            <div className="flex items-center gap-2">
              <Button variant="secondary" compact onClick={() => setIsPlaying(!isPlaying)}>
                {isPlaying ? t.rank_replay_pause : t.rank_replay_play}
              </Button>
              <div className="flex items-center gap-1 text-xs">
                <span style={{ color: 'var(--muted)' }}>{t.rank_replay_speed}:</span>
                {[1, 5, 20, 60].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPlaySpeed(s)}
                    className={`px-1.5 py-0.5 rounded text-xs font-mono ${playSpeed === s ? 'bg-primary text-white font-bold' : 'hover:bg-hover'}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            <div className="text-sm font-mono" style={{ color: 'var(--muted)' }}>
              <span>{formatElapsed((replayTimeMs || startMs) - startMs)}</span>
              <span className="mx-1.5">/</span>
              <span>{formatElapsed(endMs - startMs)}</span>
              <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>({new Date(replayTimeMs || startMs).toLocaleTimeString()})</span>
            </div>
            {replayData?.canUnfreeze ? (
              <Button variant={unfreezeRevealed ? 'primary' : 'secondary'} compact onClick={toggleUnfreezeReveal}>
                {unfreezeRevealed ? t.rank_frozen : t.rank_replay_unfreeze}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={startMs}
              max={endMs}
              value={replayTimeMs || startMs}
              onChange={(e) => {
                setIsPlaying(false);
                setReplayTimeMs(Number(e.target.value));
              }}
              className="w-full cursor-pointer accent-primary"
              aria-label="Replay timeline scrubber"
            />
          </div>
        </div>
      ) : null}
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
