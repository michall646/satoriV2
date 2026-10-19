// Satori V2 — contest deadlines, LABS grades, and ranking projection.
'use strict';
const { store } = require('./store');
const { rankICPC, rankIOI, gradeLabs, isAccepted, resolveEffectiveDeadline, defaultDeadlinePolicy } = require('./ranking');

function contestDeadlines(contest) {
  const probs = store.query('problems', (x) => String(x.contestId) === String(contest.id));
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const deadlines = {};
  const meta = {};
  for (const pr of probs) {
    const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest });
    if (r.at) deadlines[pr.id] = r.at;
    meta[pr.id] = r;
  }
  return { deadlines, meta, policy: defaultDeadlinePolicy(contest) };
}

function enrichProblemWithDeadline(pr, contest) {
  if (!contest) return { ...pr, effectiveDeadline: pr.deadlineAt || null, deadlineSource: pr.deadlineAt ? 'problem' : 'none', deadlinePolicy: { enabled: false } };
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest });
  const policy = defaultDeadlinePolicy(contest);
  if (!policy.enabled) return { ...pr, effectiveDeadline: null, deadlineSource: 'disabled', deadlinePolicy: policy };
  return { ...pr, effectiveDeadline: r.at, deadlineSource: r.source, deadlinePolicy: policy };
}

// One source of truth for LABS scoring: used by /grade and the LABS board, so they cannot drift.
function computeLabsGrade(c, probs, matchSubmit) {
  const weights = {};
  probs.forEach((x) => { weights[x.id] = x.weight ?? 1; });
  const scores = {};
  const submittedAt = {};
  const misses = {};
  const dl = contestDeadlines(c);
  const scoring = ((c.settings || {}).scoring) || {};
  for (const x of probs) {
    const subs = store.query('submits', (s) => String(s.problemId) === String(x.id) && !s.sampleOnly && matchSubmit(s));
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
  return { out, deadlines: dl.deadlines, policy, submittedAt };
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
function parseGradeScale(raw) {
  const defaults = [{ min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 0, grade: 2 }];
  if (!raw) return defaults;
  const out = [];
  for (const part of String(raw).split(',')) {
    const [a, b2] = part.split(':').map((x) => Number(String(x).trim()));
    if (Number.isFinite(a) && Number.isFinite(b2)) out.push({ min: a, grade: b2 });
  }
  return out.length ? out.sort((x, y) => y.min - x.min) : defaults;
}
function gradeFromScale(scale, pct) {
  for (const s of scale) if (pct >= s.min) return s.grade;
  return scale.length ? scale[scale.length - 1].grade : 2;
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
function buildRanking(c, me) {
  const mode = String(c.mode || 'ICPC').toUpperCase();
  const settings = c.settings || {};
  const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
  const teams = store.query('teams', (x) => String(x.contestId) === String(c.id));
  const contestants = teams.length
    ? teams.map((x) => ({ id: `t:${x.id}`, name: x.scoreboardName }))
    : (c.members || []).map((id) => { const x = store.get('users', id); return { id: `u:${id}`, name: x ? x.login : String(id) }; });
  const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly).map((s) => ({
    ...s,
    contestantId: s.teamId ? `t:${s.teamId}` : `u:${s.userId}`,
  }));
  const dl = contestDeadlines(c);
  const scoring = settings.scoring || {};
  const penaltyMin = settings.penaltyMin ?? scoring.wrongTryMin ?? scoring.penaltyMin ?? c.penalty ?? 20;
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
  const unfreezeAt = c.freezeAt ? (settings.unfreezeAt || c.endAt || null) : null;
  const base = { contestMode: c.mode, problems, freezeAt: c.freezeAt, unfreezeAt, penaltyMin, deadlines: dl.deadlines, deadlinePolicy: dl.policy };
  if (mode === 'IOI') {
    const rows = rankIOI({ contestants, submits: subs, problems: probs, ...scoreOpts });
    return { ...base, mode, rows, me: rankMe(rows, me) };
  }
  if (mode === 'LABS' || mode === 'COURSE') {
    const rows = contestants.map((ct) => {
      const match = (s) => (s.teamId ? `t:${s.teamId}` : `u:${s.userId}`) === ct.id;
      const { out } = computeLabsGrade(c, probs, match);
      const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
      const cells = {};
      for (const p2 of probs) {
        const d = detail.get(String(p2.id));
        const pts = d ? Math.round(Number(d.points) * 10) / 10 : 0;
        cells[p2.id] = { text: d && d.lateUnits > 0 ? `${pts} †` : String(pts), points: pts, late: Boolean(d && d.lateUnits > 0) };
      }
      return { contestantId: ct.id, name: ct.name, total: out.total, grade: out.grade, cells };
    });
    rows.sort((a, b2) => b2.total - a.total);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { ...base, mode: 'LABS', rows, me: rankMe(rows, me) };
  }
  const rows = rankICPC({ contestants, submits: subs, problems: probs, contestStart: c.startAt, freezeAtIso: c.freezeAt, ...scoreOpts });
  return { ...base, mode: 'ICPC', rows, me: rankMe(rows, me) };
}

module.exports = { contestDeadlines, enrichProblemWithDeadline, computeLabsGrade, normalizeExam, parseGradeScale, gradeFromScale, csvCell, icsText, rankMe, buildRanking, mySessions, myTeams };
