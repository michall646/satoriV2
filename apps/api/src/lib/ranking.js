// Satori V2 — ranking engines: ICPC / IOI / LABS(course).
// Pure functions. Guard clauses. No nested ifs.
'use strict';

const PENALTY_PER_WRONG_MIN = 20;

function isAccepted(v) {
  return v === 'OK' || v === 'ANS';
}

function minutesBetween(startIso, atIso) {
  const s = new Date(startIso).getTime();
  const t = new Date(atIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(t)) return 0;
  if (t < s) return 0;
  return Math.floor((t - s) / 60000);
}

function fmtHMM(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Deadlines: single source of truth for effective deadline + lateness.
// Priority: problem.deadlineAt > set.deadlineAt > contestDefault (contest.endAt or settings.defaultDeadline) > null.
function resolveEffectiveDeadline({ problem, set, contest }) {
  if (problem && problem.deadlineAt) return { at: problem.deadlineAt, source: 'problem' };
  if (set && set.deadlineAt) return { at: set.deadlineAt, source: 'set' };
  if (contest && contest.settings && contest.settings.defaultDeadline) return { at: contest.settings.defaultDeadline, source: 'contest-default' };
  if (contest && contest.endAt && contest.mode !== 'PLAYGROUND' && contest.mode !== 'VIRTUAL') return { at: contest.endAt, source: 'contest-end' };
  return { at: null, source: 'none' };
}

function defaultDeadlinePolicy(contest) {
  const p = (contest && contest.settings && contest.settings.deadlinePolicy) || {};
  return {
    enabled: Boolean(p.enabled),
    lateMode: p.lateMode === 'hard' ? 'hard' : 'soft',
    penaltyKind: p.penaltyKind || 'perDay',
    penaltyValue: Number(p.penaltyValue ?? p.latePenaltyPerDay ?? contest?.settings?.latePenaltyPerDay ?? 0),
    graceMin: Number(p.graceMin ?? 0),
    capZeroAfterDays: p.capZeroAfterDays ?? null,
    tiers: Array.isArray(p.tiers) ? p.tiers : null,
  };
}

function lateUnitsBetween(deadlineIso, atIso, kind, graceMin) {
  const dl = new Date(deadlineIso).getTime();
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(dl) || !Number.isFinite(at)) return 0;
  const graceMs = (Number(graceMin) || 0) * 60000;
  const diff = at - dl - graceMs;
  if (diff <= 0) return 0;
  if (kind === 'perHour' || kind === 'percent') return Math.ceil(diff / 3600000);
  return Math.ceil(diff / 86400000);
}

function isLateAt(deadlineIso, atIso, graceMin) {
  return lateUnitsBetween(deadlineIso, atIso, 'perDay', graceMin) > 0;
}

// Tie-break comparator. Keys: solves|total (high wins), time|attempts|lastSolve (low wins).
// Unknown keys ignored. Empty list keeps input order.
function compareBy(order) {
  const keys = (Array.isArray(order) ? order : []).filter((k) => ['solves', 'total', 'time', 'attempts', 'lastSolve'].includes(k));
  if (!keys.length) return () => 0;
  return (a, b) => {
    for (const k of keys) {
      if (k === 'solves' || k === 'total') {
        const d = (b[k] ?? 0) - (a[k] ?? 0);
        if (d) return d;
      } else {
        const d = (a[k] ?? 0) - (b[k] ?? 0);
        if (d) return d;
      }
    }
    return 0;
  };
}

// Late floor: penalized score never drops below floorPct % of the raw score.
function applyFloor(pts, raw, lateUnits, floorPct) {
  if (!(lateUnits > 0)) return pts;
  const f = Number(floorPct);
  if (!Number.isFinite(f) || f <= 0) return pts;
  return Math.max(pts, raw * Math.min(f, 100) / 100);
}

// Stepped late tiers: [{days, pct}] — first tier covering the delay wins (lose pct %).
// Past the last tier everything is lost. Returns null when no tiers configured.
function tieredPct(lateDays, tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const sorted = [...tiers]
    .map((t) => ({ days: Number(t.days), pct: Number(t.pct) }))
    .filter((t) => Number.isFinite(t.days) && Number.isFinite(t.pct) && t.days >= 0);
  if (!sorted.length) return null;
  sorted.sort((a, b) => a.days - b.days);
  for (const t of sorted) {
    if (lateDays <= t.days) return Math.min(Math.max(t.pct, 0), 100);
  }
  return 100;
}

// Miss deduction: lose `value` points per wrong try.
// accrue 'always' deducts regardless; 'on-solve' only when the final score > 0.
function applyMissDeduction(pts, misses, missDeduction) {
  if (!missDeduction || misses <= 0) return pts;
  const v = Number(missDeduction.value);
  if (!Number.isFinite(v) || v <= 0) return pts;
  if (missDeduction.accrue !== 'always' && !(pts > 0)) return pts;
  return Math.max(0, pts - misses * v);
}

// Freeze/unfreeze (B3): one pure filter shared by ICPC, IOI and any board mode.
// Freeze is active only when freezeAtIso parses, no replay view is requested, and
// `nowMs` (default Date.now()) is before unfreezeAtIso when one is given.
// Submits flagged `_unfrozenView` stay visible while frozen (replay rows).
function isFrozen({ freezeAtIso, unfreezeAtIso, nowMs, unfrozenView, _unfrozenView } = {}) {
  if (unfrozenView || _unfrozenView) return false;
  if (!freezeAtIso) return false;
  const from = new Date(freezeAtIso).getTime();
  if (!Number.isFinite(from)) return false;
  const until = unfreezeAtIso ? new Date(unfreezeAtIso).getTime() : NaN;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (now < from) return false; // freeze has not started yet
  if (!Number.isFinite(until)) return true; // no unfreeze time -> frozen until replay
  return now < until;
}

// Pure board filter: hides submits created after freezeAtIso while frozen.
// opts: { freezeAtIso, unfreezeAtIso, nowMs, unfrozenView }.
// Returns the input array unchanged when no freeze is active.
function filterFrozenSubmits(submits, opts = {}) {
  const list = Array.isArray(submits) ? submits : [];
  if (!isFrozen(opts)) return list;
  const from = new Date(opts.freezeAtIso).getTime();
  return list.filter((s) => {
    if (s && (s._unfrozenView || s.unfrozenView)) return true;
    const t = new Date(s && s.createdAt).getTime();
    if (!Number.isFinite(t)) return true; // unreadable timestamp never hides a row
    return t <= from;
  });
}

// ICPC: per contestant×problem: tries, solvedAtMin, solved.
// Cell text: '-' | 'N' | 'N (H:MM)' — matches V1 UZI board.
// deadlines: {problemId: iso} optional. policy: {enabled, lateMode} — hard late excluded, soft marked late.
function rankICPC({ contestants, submits, problems, contestStart, freezeAtIso, unfreezeAtIso, nowMs, unfrozenView, deadlines, policy, penaltyMin, exemptStatuses, tiebreak, maxTries }) {
  const visible = filterFrozenSubmits(submits, { freezeAtIso, unfreezeAtIso, nowMs, unfrozenView });
  const byKey = new Map(); // `${cid}:${pid}` -> {tries, solvedTry, solvedMin}
  const sorted = [...visible].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const hardLate = policy && policy.enabled && policy.lateMode === 'hard' && deadlines;
  const cost = Number(penaltyMin ?? PENALTY_PER_WRONG_MIN);
  const exempt = new Set(exemptStatuses || ['CE']);

  for (const s of sorted) {
    if (s.sampleOnly) continue;
    if (hardLate && deadlines[s.problemId] && isLateAt(deadlines[s.problemId], s.createdAt, policy.graceMin)) continue;
    const key = `${s.contestantId}:${s.problemId}`;
    if (!byKey.has(key)) byKey.set(key, { tries: 0, solvedTry: 0, solvedMin: 0, solved: false, late: false });
    const cell = byKey.get(key);
    if (cell.solved) continue;
    if (exempt.has(s.status) && !isAccepted(s.status)) continue;
    const cap = Number(maxTries);
    if (Number.isFinite(cap) && cap > 0 && cell.tries >= cap) continue;
    cell.tries += 1;
    if (isAccepted(s.status)) {
      cell.solved = true;
      cell.solvedTry = cell.tries;
      cell.solvedMin = minutesBetween(contestStart, s.createdAt);
      if (deadlines && deadlines[s.problemId] && isLateAt(deadlines[s.problemId], s.createdAt, policy && policy.graceMin)) cell.late = true;
    }
  }

  const rows = contestants.map((c) => {
    let solved = 0;
    let time = 0;
    let attempts = 0;
    let lastSolve = 0;
    const cells = {};
    for (const p of problems) {
      const cell = byKey.get(`${c.id}:${p.id}`) || { tries: 0, solved: false };
      attempts += cell.tries;
      if (cell.solved) {
        solved += 1;
        time += cell.solvedMin + (cell.solvedTry - 1) * (Number.isFinite(cost) ? cost : PENALTY_PER_WRONG_MIN);
        if (cell.solvedMin > lastSolve) lastSolve = cell.solvedMin;
        cells[p.id] = { text: `${cell.solvedTry} (${fmtHMM(cell.solvedMin)})${cell.late ? ' †' : ''}`, tries: cell.tries, solved: true, late: Boolean(cell.late) };
      } else if (cell.tries > 0) {
        cells[p.id] = { text: `${cell.tries}`, tries: cell.tries, solved: false };
      } else {
        cells[p.id] = { text: '-', tries: 0, solved: false };
      }
    }
    return { contestantId: c.id, name: c.name, solved, time, attempts, lastSolve, cells };
  });

  rows.sort(compareBy(tiebreak || ['solves', 'time']));
  let rank = 0;
  let prev = null;
  for (const r of rows) {
    if (!prev || r.solved !== prev.solved || r.time !== prev.time) rank += 1;
    r.rank = rank;
    prev = r;
  }
  return rows;
}

// IOI: points per problem+contestant summed.
// scoreRule: 'best' (highest submit counts) | 'latest' (most recent counts) | 'solved-count' (100 if ever accepted).
// Soft late penalized (+ floor), hard late excluded.
function rankIOI({ contestants, submits, problems, freezeAtIso, unfreezeAtIso, nowMs, unfrozenView, deadlines, policy, scoreRule, floorPct, tiebreak, missDeduction, exemptStatuses }) {
  const visible = filterFrozenSubmits(submits, { freezeAtIso, unfreezeAtIso, nowMs, unfrozenView });
  const best = new Map(); // `${cid}:${pid}` -> points
  const bestLate = new Map();
  const misses = new Map(); // `${cid}:${pid}` -> wrong-try count
  const attempts = new Map(); // `${cid}` -> submit count
  const lastSolve = new Map(); // `${cid}` -> epoch ms of latest score-setting submit
  const rule = scoreRule || 'best';
  const exempt = new Set(exemptStatuses || ['CE']);
  const ordered = [...visible].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const s of ordered) {
    if (s.sampleOnly) continue;
    const raw = rule === 'solved-count'
      ? (isAccepted(s.status) ? 100 : 0)
      : Number(s.points || (isAccepted(s.status) ? 100 : 0));
    let pts = raw;
    const dl = deadlines ? deadlines[s.problemId] : null;
    let late = false;
    let lateUnits = 0;
    if (dl && policy && policy.enabled && isLateAt(dl, s.createdAt, policy.graceMin)) {
      late = true;
      if (policy.lateMode === 'hard') continue;
      lateUnits = lateUnitsBetween(dl, s.createdAt, policy.penaltyKind, policy.graceMin);
      const lateDays = (new Date(s.createdAt).getTime() - new Date(dl).getTime()) / 86400000;
      const tier = tieredPct(lateDays, policy.tiers);
      if (tier != null) pts = Math.max(0, pts * (1 - tier / 100));
      else if (policy.penaltyKind === 'percent') pts = Math.max(0, pts * (1 - lateUnits * (policy.penaltyValue || 0) / 100));
      else pts = Math.max(0, pts - lateUnits * (policy.penaltyValue || 0));
      pts = applyFloor(pts, raw, lateUnits, floorPct);
    }
    const key = `${s.contestantId}:${s.problemId}`;
    attempts.set(s.contestantId, (attempts.get(s.contestantId) || 0) + 1);
    if (!isAccepted(s.status) && !exempt.has(s.status)) misses.set(key, (misses.get(key) || 0) + 1);
    const cur = best.get(key) || 0;
    if (rule === 'latest' || pts > cur) {
      best.set(key, pts);
      bestLate.set(key, late);
      const t = new Date(s.createdAt).getTime();
      if (Number.isFinite(t) && t > (lastSolve.get(s.contestantId) || 0)) lastSolve.set(s.contestantId, t);
    }
  }
  const rows = contestants.map((c) => {
    let total = 0;
    const cells = {};
    for (const p of problems) {
      const key = `${c.id}:${p.id}`;
      const v = applyMissDeduction(best.get(key) || 0, misses.get(key) || 0, missDeduction);
      const late = bestLate.get(key) || false;
      total += v;
      cells[p.id] = { text: `${v}${late ? ' †' : ''}`, points: v, late };
    }
    return { contestantId: c.id, name: c.name, total, attempts: attempts.get(c.id) || 0, lastSolve: lastSolve.get(c.id) || 0, cells };
  });
  rows.sort(compareBy(tiebreak || ['total']));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// LABS: weighted problems -> grade, best-of-K (or drop-worst-N), late penalty, what-if projection.
function gradeLabs({ weights, scores, bestOfK, dropWorstN, latePenaltyPerDay, submittedAt, deadlines, penaltyKind, graceMin, capZeroAfterDays, floorPct, tiers, misses, missDeduction }) {
  // weights: {problemId: weight}, scores: {problemId: 0..100}, misses: {problemId: wrong-try count}
  // penaltyKind: 'perDay' (default) | 'perHour' | 'percent'
  // dropWorstN: drop N lowest (alternative way to say bestOfK = count - N)
  const entries = Object.entries(weights);
  if (entries.length === 0) return { total: 0, grade: 2.0, detail: [] };
  let detail = entries.map(([pid, w]) => {
    let pts = Number(scores[pid] || 0);
    const raw = pts;
    const dl = deadlines ? deadlines[pid] : null;
    const at = submittedAt ? submittedAt[pid] : null;
    let lateUnits = 0;
    if (dl && at) lateUnits = lateUnitsBetween(dl, at, penaltyKind || 'perDay', graceMin || 0);
    if (lateUnits > 0) {
      const lateDays = (new Date(at).getTime() - new Date(dl).getTime()) / 86400000;
      const tier = tieredPct(lateDays, tiers);
      if (tier != null) pts = Math.max(0, pts * (1 - tier / 100));
      else if ((penaltyKind || 'perDay') === 'percent') pts = Math.max(0, pts * (1 - lateUnits * (latePenaltyPerDay || 0) / 100));
      else pts = Math.max(0, pts - lateUnits * (latePenaltyPerDay || 0));
      pts = applyFloor(pts, raw, lateUnits, floorPct);
    }
    pts = applyMissDeduction(pts, (misses && misses[pid]) || 0, missDeduction);
    if (capZeroAfterDays != null && lateUnits > 0 && dl && at) {
      const daysLate = (new Date(at) - new Date(dl)) / 86400000;
      if (daysLate > capZeroAfterDays) pts = 0;
    }
    return { problemId: pid, weight: w, points: pts, raw, lateUnits, lateDays: lateUnits };
  });
  detail.sort((a, b) => b.points - a.points);
  const keep = dropWorstN != null && dropWorstN !== ''
    ? Math.max(1, detail.length - Number(dropWorstN))
    : bestOfK;
  const use = keep ? detail.slice(0, keep) : detail;
  const wSum = use.reduce((s, d) => s + d.weight, 0);
  if (wSum <= 0) return { total: 0, grade: 2.0, detail };
  const total = use.reduce((s, d) => s + (d.points * d.weight) / wSum, 0);
  const grade = total >= 91 ? 5.0 : total >= 81 ? 4.5 : total >= 71 ? 4.0 : total >= 61 ? 3.5 : total >= 51 ? 3.0 : 2.0;
  return { total: Math.round(total * 10) / 10, grade, detail };
}

module.exports = { rankICPC, rankIOI, gradeLabs, isAccepted, PENALTY_PER_WRONG_MIN, fmtHMM, resolveEffectiveDeadline, defaultDeadlinePolicy, lateUnitsBetween, isLateAt, filterFrozenSubmits, isFrozen };
