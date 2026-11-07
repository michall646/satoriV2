// Satori V2 — contest deadlines, LABS grades, and ranking projection.
'use strict';
const { store } = require('./store');
const { rankICPC, rankIOI, gradeLabs, isAccepted, resolveEffectiveDeadline, defaultDeadlinePolicy, filterFrozenSubmits, isFrozen } = require('./ranking');
const { resolveContestEnd } = require('./contestTime');

// Contest objects read from legacy data may still carry `stopAt`; every engine
// consumer works on a view whose `endAt` is already canonical (D1).
function canonicalContest(contest) {
  return { ...contest, endAt: resolveContestEnd(contest) };
}

function contestDeadlines(contest) {
  const canon = canonicalContest(contest);
  const probs = store.query('problems', (x) => String(x.contestId) === String(contest.id));
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const deadlines = {};
  const meta = {};
  for (const pr of probs) {
    const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest: canon });
    if (r.at) deadlines[pr.id] = r.at;
    meta[pr.id] = r;
  }
  return { deadlines, meta, policy: defaultDeadlinePolicy(canon) };
}

function enrichProblemWithDeadline(pr, contest) {
  if (!contest) return { ...pr, effectiveDeadline: pr.deadlineAt || null, deadlineSource: pr.deadlineAt ? 'problem' : 'none', deadlinePolicy: { enabled: false } };
  const canon = canonicalContest(contest);
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest: canon });
  const policy = defaultDeadlinePolicy(canon);
  if (!policy.enabled) return { ...pr, effectiveDeadline: null, deadlineSource: 'disabled', deadlinePolicy: policy };
  return { ...pr, effectiveDeadline: r.at, deadlineSource: r.source, deadlinePolicy: policy };
}

// One source of truth for LABS scoring: used by /grade and the LABS board, so they cannot drift.
// opts.submits: optional pre-filtered contest submits (freeze/replay handled by the caller).
function computeLabsGrade(c, probs, matchSubmit, opts = {}) {
  const weights = {};
  probs.forEach((x) => { weights[x.id] = x.weight ?? 1; });
  const scores = {};
  const submittedAt = {};
  const misses = {};
  const dl = contestDeadlines(c);
  const scoring = ((c.settings || {}).scoring) || {};
  const source = Array.isArray(opts.submits)
    ? opts.submits
    : store.query('submits', (s) => !s.sampleOnly && matchSubmit(s));
  for (const x of probs) {
    const subs = source.filter((s) => String(s.problemId) === String(x.id) && !s.sampleOnly && matchSubmit(s));
    let best = 0;
    let bestAt = null;
    let miss = 0;
    for (const s of subs) {
      const v = Number(s.points || (isAccepted(s.status) ? 100 : 0));
      if (!isAccepted(s.status) && (s.status !== 'CE' || scoring.exemptCE === false)) miss += 1;
      if (scoring.rule === 'latest') { best = v; bestAt = s.createdAt; }
      else if (v >= best) { best = v; bestAt = s.createdAt; }
    }
    scores[x.id] = best;
    misses[x.id] = miss;
    if (bestAt) submittedAt[x.id] = bestAt;
  }
  const policy = dl.policy;
  const out = gradeLabs({
    weights, scores, bestOfK: (c.settings || {}).bestOfK, dropWorstN: scoring.dropWorstN,
    latePenaltyPerDay: policy.penaltyValue || (c.settings || {}).latePenaltyPerDay,
    submittedAt, deadlines: policy.enabled ? dl.deadlines : null,
    penaltyKind: policy.penaltyKind, graceMin: policy.graceMin, capZeroAfterDays: policy.capZeroAfterDays,
    floorPct: scoring.floorPct ?? undefined, tiers: policy.tiers,
    misses, missDeduction: scoring.missDeduction || undefined,
  });
  // D3: gradeLabs keeps its legacy thresholds internally; the contest scale is
  // applied here so page, preview, board and export all agree.
  const scale = resolveGradeScale(c);
  out.grade = gradeFromScale(scale, out.total);
  return { out, deadlines: dl.deadlines, policy, submittedAt, scale };
}
function mySessions(me, currentJti) {
  const rows = store.query('sessions', (s) => String(s.userId) === String(me.id) && !s.revoked)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const out = rows.map((s) => ({ id: s.jti, device: s.device || 'web', at: s.at || null, current: Boolean(currentJti && s.jti === currentJti) }));
  out.sort((a, b) => Number(b.current) - Number(a.current));
  return out;
}
function myTeams(userId) {
  const uid = String(userId);
  const inTeam = (t) => (t.memberIds || []).map(String).includes(uid) || (t.members || []).map(String).includes(uid);
  const teams = store.query('teams', inTeam);
  const viaRows = store.query('teamMembers', (r) => String(r.userId) === uid).map((r) => String(r.teamId));
  const extra = viaRows.length ? store.all('teams').filter((t) => viaRows.includes(String(t.id)) && !inTeam(t)) : [];
  return [...teams, ...extra].map((t) => ({ id: t.id, name: t.name, contestId: t.contestId ?? null }));
}
function normalizeExam(contest, extra) {
  const s = (contest && contest.settings) || {};
  const canonical = (o) => {
    if (!o) return {};
    const out = { ...o };
    if (out.ipAllow == null && out.ips != null) out.ipAllow = out.ips;
    if (out.timeWindow == null && out.tokens != null) out.timeWindow = out.tokens;
    delete out.ips;
    delete out.tokens;
    return out;
  };
  const src = { ...canonical(s.exam), ...canonical(extra) };
  return {
    fullscreen: Boolean(src.fullscreen),
    pasteBlock: Boolean(src.pasteBlock),
    shuffle: Boolean(src.shuffle),
    ipAllow: String(src.ipAllow ?? s.ips ?? '').trim(),
    timeWindow: String(src.timeWindow ?? s.tokens ?? '').trim(),
  };
}
const DEFAULT_GRADE_SCALE = [{ min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 0, grade: 2 }];

function normalizeScaleArray(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const part of raw) {
    if (!part || typeof part !== 'object') continue;
    const min = Number(part.min);
    const grade = Number(part.grade);
    if (Number.isFinite(min) && Number.isFinite(grade)) out.push({ min, grade });
  }
  return out.length ? out.sort((x, y) => y.min - x.min) : null;
}

// Accepts the canonical array form and the legacy "min:grade,min:grade" string.
function parseGradeScale(raw) {
  const defaults = DEFAULT_GRADE_SCALE.map((x) => ({ ...x }));
  if (!raw) return defaults;
  const fromArray = normalizeScaleArray(raw);
  if (fromArray) return fromArray;
  const out = [];
  for (const part of String(raw).split(',')) {
    const [a, b2] = part.split(':').map((x) => Number(String(x).trim()));
    if (Number.isFinite(a) && Number.isFinite(b2)) out.push({ min: a, grade: b2 });
  }
  return out.length ? out.sort((x, y) => y.min - x.min) : defaults;
}

// D3: one source of truth for the grade scale — settings.gradeScale or the platform default.
function resolveGradeScale(contest) {
  return parseGradeScale((contest && contest.settings && contest.settings.gradeScale) || null);
}
function gradeFromScale(scale, pct) {
  // Accepts a resolved scale array, a "min:grade,..." string, or a contest.
  const list = Array.isArray(scale)
    ? scale
    : typeof scale === 'string'
      ? parseGradeScale(scale)
      : resolveGradeScale(scale);
  for (const s of list) if (pct >= s.min) return s.grade;
  return list.length ? list[list.length - 1].grade : 2;
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
}
function rankMe(rows, me) {
  if (!me) return null;
  const idx = (rows || []).findIndex((r) => r.name === me.login);
  if (idx < 0) return null;
  const r = rows[idx];
  return { rank: r.rank ?? idx + 1, name: me.login, total: r.total ?? r.points ?? r.solved ?? null };
}
// D2: `scoreboardMode` is canonical, contest `mode` is the fallback.
// EXAM/TAKEHOME/PLAYGROUND are IOI; VIRTUAL is ICPC; no implicit ICPC fallthrough.
function normalizeScoreboardMode(value) {
  const m = String(value || '').toUpperCase();
  if (m === 'LABS' || m === 'COURSE') return 'LABS';
  if (m === 'ICPC' || m === 'IOI') return m;
  return null;
}

function resolveScoreboardMode(contest) {
  const explicit = normalizeScoreboardMode(contest && (contest.scoreboardMode ?? (contest.settings || {}).scoreboardMode));
  if (explicit) return explicit;
  const mode = String((contest && contest.mode) || '').toUpperCase();
  if (mode === 'EXAM' || mode === 'TAKEHOME' || mode === 'PLAYGROUND' || mode === 'IOI') return 'IOI';
  if (mode === 'LABS' || mode === 'COURSE') return 'LABS';
  return 'ICPC'; // ICPC, VIRTUAL and legacy/blank contest modes
}

function teamMemberIds(team) {
  const list = Array.isArray(team.members) && team.members.length ? team.members : team.memberIds;
  return (list || []).map(String);
}
function teamMemberLogins(team) {
  return teamMemberIds(team).map((id) => { const u = store.get('users', id); return u ? u.login : String(id); });
}
function contestantKey(submit, teamMode, teamIds) {
  const hasTeam = submit.teamId != null && submit.teamId !== '';
  if (teamMode && hasTeam && teamIds.has(String(submit.teamId))) return `t:${submit.teamId}`;
  return `u:${submit.userId}`;
}
function attachMembers(rows, contestants) {
  const byId = new Map(contestants.map((x) => [x.id, x]));
  for (const row of rows) {
    const ct = byId.get(row.contestantId);
    if (ct && ct.members) row.members = ct.members;
  }
  return rows;
}

function buildRanking(c, me, opts = {}) {
  const mode = normalizeScoreboardMode(opts.mode) || resolveScoreboardMode(c);
  const settings = c.settings || {};
  const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
  const teams = store.query('teams', (x) => String(x.contestId) === String(c.id));
  const teamIds = new Set(teams.map((x) => String(x.id)));
  // B5: teams are used only when explicitly enabled; legacy team rows never
  // replace the individual board.
  const teamMode = c.teamMode === true;
  const contestants = teamMode && teams.length
    ? teams.map((x) => ({ id: `t:${x.id}`, name: x.scoreboardName || x.name || `team-${x.id}`, members: teamMemberLogins(x) }))
    : (c.members || []).map((id) => { const x = store.get('users', id); return { id: `u:${id}`, name: x ? x.login : String(id) }; });
  // B5: a submit whose team is not part of this contest is ignored.
  let subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly)
    .filter((s) => s.teamId == null || s.teamId === '' || teamIds.has(String(s.teamId)))
    .map((s) => ({ ...s, contestantId: contestantKey(s, teamMode, teamIds) }));
  const replayAtMs = opts.at ? new Date(opts.at).getTime() : (Number.isFinite(opts.nowMs) ? opts.nowMs : NaN);
  if (Number.isFinite(replayAtMs)) {
    subs = subs.filter((s) => {
      const t = new Date(s.createdAt).getTime();
      return !Number.isFinite(t) || t <= replayAtMs;
    });
  }
  const dl = contestDeadlines(c);
  const scoring = settings.scoring || {};
  // B6: settings.penaltyMin is canonical; scoring.wrongTryMin is the legacy fallback.
  const penaltyMin = settings.penaltyMin ?? scoring.wrongTryMin ?? c.penalty ?? 20;
  const endAt = resolveContestEnd(c);
  // B3: freeze lifts at settings.unfreezeAt, or at the contest end by default.
  const unfreezeAt = c.freezeAt ? (settings.unfreezeAt || endAt || null) : null;
  const freezeOpts = {
    freezeAtIso: c.freezeAt || null,
    unfreezeAtIso: unfreezeAt,
    unfrozenView: Boolean(opts.unfrozen),
    nowMs: Number.isFinite(replayAtMs) ? replayAtMs : opts.nowMs,
  };
  const frozen = isFrozen(freezeOpts);
  const visibleSubs = filterFrozenSubmits(subs, freezeOpts);
  const scoreOpts = {
    deadlines: dl.policy.enabled ? dl.deadlines : null, policy: dl.policy,
    scoreRule: scoring.rule || 'best', floorPct: scoring.floorPct ?? undefined,
    tiebreak: scoring.tiebreak || undefined,
    penaltyMin,
    exemptStatuses: scoring.exemptCE === false ? [] : ['CE'],
    missDeduction: scoring.missDeduction || undefined,
    maxTries: scoring.maxTries || undefined,
  };
  const problems = [...probs].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''))).map((x) => ({ id: x.id, code: x.code, name: x.name }));
  const base = {
    contestMode: c.mode,
    problems,
    startAt: c.startAt || null,
    endAt,
    freezeAt: c.freezeAt || null,
    unfreezeAt,
    frozen,
    replayAt: Number.isFinite(replayAtMs) ? new Date(replayAtMs).toISOString() : null,
    penaltyMin,
    deadlines: dl.deadlines,
    deadlinePolicy: dl.policy,
  };
  if (mode === 'IOI') {
    const rows = attachMembers(rankIOI({ contestants, submits: visibleSubs, problems: probs, ...scoreOpts, ...freezeOpts }), contestants);
    return { ...base, mode, rows, me: rankMe(rows, me) };
  }
  if (mode === 'LABS') {
    const rows = contestants.map((ct) => {
      const match = (s) => s.contestantId === ct.id;
      const { out } = computeLabsGrade(c, probs, match, { submits: visibleSubs });
      const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
      const cells = {};
      for (const p2 of probs) {
        const d = detail.get(String(p2.id));
        const pts = d ? Math.round(Number(d.points) * 10) / 10 : 0;
        cells[p2.id] = { text: d && d.lateUnits > 0 ? `${pts} †` : String(pts), points: pts, late: Boolean(d && d.lateUnits > 0) };
      }
      return { contestantId: ct.id, name: ct.name, members: ct.members, total: out.total, grade: out.grade, cells };
    });
    rows.sort((a, b2) => b2.total - a.total);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { ...base, mode: 'LABS', rows, me: rankMe(rows, me) };
  }
  const rows = attachMembers(rankICPC({ contestants, submits: visibleSubs, problems: probs, contestStart: c.startAt, ...scoreOpts, ...freezeOpts }), contestants);
  return { ...base, mode: 'ICPC', rows, me: rankMe(rows, me) };
}

function buildReplayData(c, me, opts = {}) {
  const mode = normalizeScoreboardMode(opts.mode) || resolveScoreboardMode(c);
  const settings = c.settings || {};
  const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
  const teams = store.query('teams', (x) => String(x.contestId) === String(c.id));
  const teamIds = new Set(teams.map((x) => String(x.id)));
  const teamMode = c.teamMode === true;
  const contestants = teamMode && teams.length
    ? teams.map((x) => ({ id: `t:${x.id}`, name: x.scoreboardName || x.name || `team-${x.id}`, members: teamMemberLogins(x) }))
    : (c.members || []).map((id) => { const x = store.get('users', id); return { id: `u:${id}`, name: x ? x.login : String(id) }; });

  const endAt = resolveContestEnd(c);
  const unfreezeAt = c.freezeAt ? (settings.unfreezeAt || endAt || null) : null;
  const isJury = opts.isJury || false;
  const unfrozenView = Boolean(opts.unfrozen) || isJury;
  const currentlyFrozen = isFrozen({
    freezeAtIso: c.freezeAt || null,
    unfreezeAtIso: unfreezeAt,
    unfrozenView: Boolean(opts.unfrozen),
  });

  const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly)
    .filter((s) => s.teamId == null || s.teamId === '' || teamIds.has(String(s.teamId)))
    .map((s) => {
      const cid = contestantKey(s, teamMode, teamIds);
      const isSubFrozen = currentlyFrozen && !unfrozenView && Boolean(c.freezeAt && new Date(s.createdAt) > new Date(c.freezeAt));
      return {
        id: s.id,
        contestantId: cid,
        problemId: s.problemId,
        createdAt: s.createdAt,
        status: isSubFrozen ? '?' : s.status,
        points: isSubFrozen ? null : s.points,
        frozen: isSubFrozen,
        realStatus: unfrozenView ? s.status : undefined,
      };
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const problems = [...probs]
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
    .map((x) => ({ id: x.id, code: x.code, name: x.name }));

  const dl = contestDeadlines(c);
  const scoring = settings.scoring || {};
  const penaltyMin = settings.penaltyMin ?? scoring.wrongTryMin ?? c.penalty ?? 20;

  return {
    mode,
    contestMode: c.mode,
    startAt: c.startAt || null,
    endAt,
    freezeAt: c.freezeAt || null,
    unfreezeAt,
    frozen: currentlyFrozen,
    canUnfreeze: Boolean(c.freezeAt && (isJury || !currentlyFrozen || (endAt && new Date() >= new Date(endAt)))),
    penaltyMin,
    deadlines: dl.deadlines,
    deadlinePolicy: dl.policy,
    problems,
    contestants,
    events: subs,
  };
}

module.exports = { contestDeadlines, enrichProblemWithDeadline, computeLabsGrade, normalizeExam, parseGradeScale, resolveGradeScale, gradeFromScale, resolveScoreboardMode, csvCell, icsText, rankMe, buildRanking, buildReplayData, mySessions, myTeams };
