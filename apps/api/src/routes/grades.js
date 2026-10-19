// Satori V2 — grade matrix, analytics, preview, feedback, CSV export, manual
// overrides, extensions, release gate, and bulk actions.
// All totals/grades come from computeLabsGrade (plus gradeLabs for override
// recomputation) so page, preview, board and export agree.
'use strict';
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');
const { computeLabsGrade, parseGradeScale, gradeFromScale, csvCell, contestDeadlines } = require('../lib/contestAccess');
const { isAccepted, gradeLabs } = require('../lib/ranking');
const { resolveContestEnd } = require('../lib/contestTime');
const { processQueue } = require('../lib/judgeWorker');
const { fireWebhooks } = require('./webhooks');
const { zipStore } = require('../lib/zip');
const { notifyUser } = require('../lib/notifications');
const { isConfigured: mailConfigured, sendMail, webBaseUrl } = require('../lib/mailer');

const NO_CONTEST = { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } };
const BOM = '\uFEFF';
const IDLE_MS = 7 * 864e5;
const MAX_POINTS = 100;
const MAX_REJUDGE = 5000;
const DISTRIBUTION = [
  { label: '0–49', min: 0, max: 50 },
  { label: '50–59', min: 50, max: 60 },
  { label: '60–69', min: 60, max: 70 },
  { label: '70–79', min: 70, max: 80 },
  { label: '80–89', min: 80, max: 90 },
  { label: '90–100', min: 90, max: 100.01 },
];

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function contestProblems(c) {
  return store.query('problems', (x) => String(x.contestId) === String(c.id))
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

function contestSubmits(c) {
  return store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly);
}

// Teachers and jury are contest admins today; they must not appear in grades.
function staffIds(c) {
  return new Set([...(c.admins || []), ...(c.teachers || []), ...(c.jury || [])].map(String));
}

function gradeMembers(c) {
  const staff = staffIds(c);
  return (c.members || []).map(String).filter((id) => !staff.has(id))
    .map((id) => store.get('users', id)).filter(Boolean);
}

function problemMeta(c, p) {
  return {
    id: p.id,
    code: p.code || `P${p.id}`,
    name: p.name || '',
    alias: (p.aliasLetters || {})[String(c.id)] || p.code || null,
    weight: Number(p.weight ?? 1),
    deadlineAt: p.deadlineAt || null,
  };
}

// ---- D2 manual overrides / D3 extensions (stored on the contest row) ----
// NOTE: `gradeOverrides` and `extensions` contain user ids, reasons and deadlines,
// so the public contest projection (routes/contests.js publicContestView) must
// strip both keys. That file is owned outside this lane; see the handoff report.
function nextRowId(rows) {
  let max = 0;
  for (const r of rows || []) {
    const n = Number(r.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function gradeOverrideRows(c) {
  return Array.isArray(c.gradeOverrides) ? c.gradeOverrides : [];
}

function contestExtensionRows(c) {
  return Array.isArray(c.extensions) ? c.extensions : [];
}

// Effective extension: a per-problem row wins over the contest-wide (problemId null) row.
function extensionFor(c, userId, problemId) {
  const uid = String(userId);
  const rows = contestExtensionRows(c).filter((e) => String(e.userId) === uid);
  if (problemId != null) {
    const exact = rows.find((e) => e.problemId != null && String(e.problemId) === String(problemId));
    if (exact) return exact;
  }
  return rows.find((e) => e.problemId == null) || null;
}

// D4: grades stay teacher-only until released. `gradeReleased:false` is an explicit
// hold; `gradeReleaseAt` supports a scheduled publish.
function releaseState(c) {
  const s = (c && c.settings) || {};
  const at = s.gradeReleaseAt || null;
  if (s.gradeReleased === true) return { released: true, at };
  if (s.gradeReleased === false) return { released: false, at };
  if (!at) return { released: true, at: null }; // legacy contests stay visible until explicitly held
  const ms = new Date(at).getTime();
  return { released: Number.isFinite(ms) && ms <= Date.now(), at };
}

// D2: replace cell points for the requested problems, then recompute the weighted
// total with gradeLabs so bestOfK/dropWorstN stay identical to the live formula.
// A contest-level row (problemId null) replaces the final total instead.
function applyGradeOverrides(c, out, userId, scale) {
  const rows = gradeOverrideRows(c).filter((o) => String(o.userId) === String(userId));
  if (!rows.length) return out;
  const byProblem = new Map(rows.filter((o) => o.problemId != null).map((o) => [String(o.problemId), o]));
  const finalRow = rows.find((o) => o.problemId == null) || null;
  const detail = (out.detail || []).map((d) => {
    const ov = byProblem.get(String(d.problemId));
    if (!ov) return d;
    const points = Math.max(0, Math.min(MAX_POINTS, Number(ov.points) || 0));
    return {
      ...d, points, raw: points, lateUnits: 0,
      overridden: true, overrideId: ov.id, overrideReason: ov.reason || '',
    };
  });
  const weights = {};
  const scores = {};
  for (const d of detail) { weights[d.problemId] = d.weight; scores[d.problemId] = d.points; }
  const scoring = ((c.settings || {}).scoring) || {};
  const rec = gradeLabs({
    weights, scores,
    bestOfK: (c.settings || {}).bestOfK,
    dropWorstN: scoring.dropWorstN,
  });
  const total = finalRow ? round1(Math.max(0, Math.min(MAX_POINTS, Number(finalRow.points) || 0))) : rec.total;
  return {
    ...out,
    detail,
    total,
    grade: gradeFromScale(scale, total),
    overridden: true,
    finalOverride: finalRow
      ? { id: finalRow.id, points: Number(finalRow.points), reason: finalRow.reason || '', by: finalRow.by || null, at: finalRow.at || null }
      : null,
  };
}

// D2/D3: one row = computeLabsGrade (the single formula) + per-student extension
// deadlines + manual overrides. Extensions only matter when the deadline policy is
// enabled, exactly like late penalties inside computeLabsGrade.
function computeRowGrade(c, probs, userId, submits) {
  const match = (s) => String(s.userId) === String(userId);
  const base = computeLabsGrade(c, probs, match, { submits });
  const scoring = ((c.settings || {}).scoring) || {};
  const extRows = contestExtensionRows(c).filter((e) => String(e.userId) === String(userId));
  let out = base.out;
  let deadlines = base.deadlines;
  if (extRows.length && base.policy.enabled) {
    deadlines = { ...base.deadlines };
    for (const p of probs) {
      const ext = extensionFor(c, userId, p.id);
      if (ext && ext.until) deadlines[p.id] = ext.until;
    }
    const weights = {};
    const scores = {};
    for (const d of out.detail || []) { weights[d.problemId] = d.weight; scores[d.problemId] = d.raw; }
    const misses = {};
    for (const s of submits.filter(match)) {
      if (isAccepted(s.status)) continue;
      if (s.status === 'CE' && scoring.exemptCE !== false) continue;
      misses[s.problemId] = (misses[s.problemId] || 0) + 1;
    }
    out = gradeLabs({
      weights, scores, bestOfK: (c.settings || {}).bestOfK, dropWorstN: scoring.dropWorstN,
      latePenaltyPerDay: base.policy.penaltyValue || (c.settings || {}).latePenaltyPerDay,
      submittedAt: base.submittedAt, deadlines,
      penaltyKind: base.policy.penaltyKind, graceMin: base.policy.graceMin,
      capZeroAfterDays: base.policy.capZeroAfterDays,
      floorPct: scoring.floorPct ?? undefined, tiers: base.policy.tiers,
      misses, missDeduction: scoring.missDeduction || undefined,
    });
    out.grade = gradeFromScale(base.scale, out.total);
  }
  out = applyGradeOverrides(c, out, userId, base.scale);
  return { out, deadlines, policy: base.policy, submittedAt: base.submittedAt, scale: base.scale };
}

function memberIdFromBody(c, b) {
  const memberIds = new Set((c.members || []).map(String));
  let uid = null;
  if (b.userId != null && b.userId !== '') uid = String(b.userId);
  else {
    const login = String(b.login || '').trim();
    if (!login) return null;
    const u = store.query('users', (x) => x.login === login)[0];
    if (!u) return null;
    uid = String(u.id);
  }
  return memberIds.has(uid) ? uid : null;
}

// One matrix builder shared by preview, matrix, analytics and CSV.
function matrixData(c, probsArg) {
  const probs = probsArg || contestProblems(c);
  const subs = contestSubmits(c);
  const users = gradeMembers(c);
  let scale = parseGradeScale((c.settings || {}).gradeScale);
  const rows = users.map((u2) => {
    const own = subs.filter((s) => String(s.userId) === String(u2.id));
    const grade = computeRowGrade(c, probs, u2.id, subs);
    const out = grade.out;
    if (Array.isArray(grade.scale) && grade.scale.length) scale = grade.scale;
    const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
    const cells = {};
    for (const p of probs) {
      const d = detail.get(String(p.id));
      if (!d) { cells[p.id] = null; continue; }
      const cell = {
        points: round1(d.points), raw: round1(d.raw), weight: d.weight,
        lateUnits: d.lateUnits || 0, late: (d.lateUnits || 0) > 0,
      };
      if (d.overridden) {
        cell.overridden = true;
        cell.override = { id: d.overrideId, points: round1(d.points), reason: d.overrideReason || '' };
      }
      const ext = extensionFor(c, u2.id, p.id);
      if (ext) cell.extension = { id: ext.id, until: ext.until, problemId: ext.problemId ?? null };
      cells[p.id] = cell;
    }
    const lastSubmitAt = own.reduce((at, s) => (!at || new Date(s.createdAt) > new Date(at) ? s.createdAt : at), null);
    const userExts = contestExtensionRows(c).filter((e) => String(e.userId) === String(u2.id));
    const ext = userExts.length
      ? userExts.reduce((a, b2) => (new Date(b2.until || 0) > new Date(a.until || 0) ? b2 : a))
      : null;
    return {
      id: u2.id, login: u2.login, usosId: u2.usosId || '',
      total: out.total, pct: out.total, grade: out.grade,
      cells, attempts: own.length, lastSubmitAt,
      ...(ext ? { extension: { id: ext.id, until: ext.until, problemId: ext.problemId ?? null } } : {}),
      ...(out.overridden ? { overridden: true } : {}),
      ...(out.finalOverride ? { finalOverride: out.finalOverride } : {}),
    };
  });
  rows.sort((a, b2) => (b2.total - a.total) || String(a.login).localeCompare(String(b2.login)));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const average = rows.length ? round1(rows.reduce((sum, r) => sum + r.total, 0) / rows.length) : 0;
  const userLogin = (id) => { const u2 = store.get('users', id); return u2 ? u2.login : null; };
  return {
    contestId: c.id,
    mode: c.mode || null,
    scale,
    problems: probs.map((p) => problemMeta(c, p)),
    rows,
    summary: { students: rows.length, graded: rows.filter((r) => r.attempts > 0).length, average },
    overrides: gradeOverrideRows(c).map((o) => ({ ...o, login: userLogin(o.userId), byLogin: userLogin(o.by) })),
    extensions: contestExtensionRows(c).map((e) => ({ ...e, login: userLogin(e.userId), byLogin: userLogin(e.by) })),
    release: releaseState(c),
  };
}

function atRiskRows(rows, nowMs) {
  return rows
    .map((r) => {
      const idle = !r.lastSubmitAt || nowMs - new Date(r.lastSubmitAt).getTime() > IDLE_MS;
      const reasons = [];
      if (r.total < 50) reasons.push('low');
      if (!r.lastSubmitAt) reasons.push('none');
      else if (idle) reasons.push('idle');
      if (!reasons.length) return null;
      return { id: r.id, login: r.login, total: r.total, grade: r.grade, lastSubmitAt: r.lastSubmitAt, attempts: r.attempts, reasons };
    })
    .filter(Boolean)
    .sort((a, b) => (a.total - b.total) || String(a.login).localeCompare(String(b.login)));
}

function problemQuality(c, probs, rows, subs) {
  const denom = Math.max(1, rows.length);
  return probs.map((p) => {
    const ps = subs.filter((s) => String(s.problemId) === String(p.id));
    const accepted = ps.filter((s) => isAccepted(s.status));
    const solvers = new Set(accepted.map((s) => String(s.userId)));
    const first = [...accepted].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
    const firstUser = first ? store.get('users', first.userId) : null;
    return {
      ...problemMeta(c, p),
      attempts: ps.length,
      acceptedSubmits: accepted.length,
      failedSubmits: ps.length - accepted.length,
      solvers: solvers.size,
      solveRatePct: round1((solvers.size / denom) * 100),
      acceptRatePct: ps.length ? round1((accepted.length / ps.length) * 100) : 0,
      firstBlood: first ? {
        submitId: first.id, login: firstUser ? firstUser.login : null,
        at: first.createdAt, points: Number(first.points ?? (isAccepted(first.status) ? 100 : 0)),
      } : null,
    };
  });
}

// USOS ID import: accepts "login,usos_id" rows, with or without a header.
function parseUsosCsv(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { error: 'CSV_EMPTY' };
  const split = (line) => line.split(/[,;\t]/).map((s) => s.trim());
  const head = split(lines[0]).map((s) => s.toLowerCase());
  const hasLoginHead = head.some((c) => c === 'login' || c === 'username');
  const hasUsosHead = head.some((c) => c.startsWith('usos'));
  const hasHeader = hasLoginHead || hasUsosHead;
  let loginIdx = 0;
  let usosIdx = 1;
  if (hasHeader) {
    if (!hasLoginHead || !hasUsosHead) return { error: 'CSV_HEADER' };
    loginIdx = head.findIndex((c) => c === 'login' || c === 'username');
    usosIdx = head.findIndex((c) => c.startsWith('usos'));
  }
  const rows = (hasHeader ? lines.slice(1) : lines)
    .map(split)
    .map((cols) => ({ login: cols[loginIdx] || '', usosId: cols[usosIdx] || '' }))
    .filter((r) => r.login || r.usosId);
  if (!rows.length) return { error: 'CSV_EMPTY' };
  return { rows };
}

function analyticsData(c) {
  const m = matrixData(c);
  const subs = contestSubmits(c);
  const now = Date.now();
  const values = m.rows.map((r) => r.total).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = !values.length ? 0 : values.length % 2 ? values[mid] : round1((values[mid - 1] + values[mid]) / 2);
  const distribution = DISTRIBUTION.map((b) => ({
    label: b.label,
    min: b.min,
    count: m.rows.filter((r) => r.total >= b.min && r.total < b.max).length,
  }));
  const problems = problemQuality(c, contestProblems(c), m.rows, subs);
  const firstBlood = problems
    .filter((p) => p.firstBlood && p.firstBlood.at)
    .map((p) => ({ ...p.firstBlood, problemId: p.id, code: p.code }))
    .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;
  const atRisk = atRiskRows(m.rows, now);
  return {
    contestId: c.id,
    scale: m.scale,
    summary: { ...m.summary, median, atRisk: atRisk.length, problems: m.problems.length },
    distribution,
    atRisk,
    problems,
    firstBlood,
  };
}

function matrixResponse(c, probsArg) {
  const m = matrixData(c, probsArg);
  return {
    contestId: m.contestId, mode: m.mode, scale: m.scale, problems: m.problems,
    rows: m.rows, summary: m.summary,
    overrides: m.overrides, extensions: m.extensions, release: m.release,
  };
}

async function handle(req, res, url, p, m) {
  const u = url;
  // grade matrix: server-side formula, no client-side late/bestOfK/dropWorst duplication
  let mt = p.match(/^\/api\/contests\/(\d+)\/grade\/matrix$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    return send(res, 200, matrixResponse(c));
  }
  // grade analytics: distribution, at-risk (real grade), problem quality, first blood
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/analytics$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    return send(res, 200, analyticsData(c));
  }

  // USOS ID import: login,usos_id rows for contest members (teacher console)
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/usos-import$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const parsed = parseUsosCsv(b.csv);
    if (parsed.error) return send(res, 422, { error: { code: parsed.error, message: parsed.error === 'CSV_HEADER' ? 'Header must contain login and usos_id columns.' : 'CSV with login,usos_id rows required.', hint: 'Example:\njan_kowalski,123456\nanna_nowak,234567' } });
    const memberIds = new Set((c.members || []).map(String));
    let updated = 0;
    const unknown = [];
    const skipped = [];
    const invalid = [];
    for (const row of parsed.rows) {
      const usosId = String(row.usosId || '').trim();
      if (!usosId) { invalid.push(row.login); continue; }
      const u2 = store.query('users', (x) => x.login === row.login)[0];
      if (!u2) { unknown.push(row.login); continue; }
      if (!memberIds.has(String(u2.id))) { skipped.push(row.login); continue; }
      store.update('users', u2.id, { usosId: usosId.slice(0, 64) });
      updated += 1;
    }
    audit(me.id, 'contest.grade.usos-import', `contest:${c.id}`, { updated, unknown: unknown.length, skipped: skipped.length, invalid: invalid.length });
    return send(res, 200, { ok: true, updated, unknown, skipped, invalid });
  }

  // D2: manual grade overrides — per problem cell, or the final total when
  // problemId is null. Stored on the contest row so they travel with it.
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/overrides$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const uid = memberIdFromBody(c, b);
    if (uid == null) return send(res, 422, { error: { code: 'USER', message: 'Contest member required.', hint: 'Pass userId or login of an existing contest member.' } });
    const problemRaw = b.problemId;
    const problemId = problemRaw == null || problemRaw === '' ? null : Number(problemRaw);
    if (problemId != null) {
      if (!Number.isFinite(problemId)) return send(res, 422, { error: { code: 'PROBLEM', message: 'problemId must be a number or null.', hint: 'Use null for a final-total override.' } });
      const pr = store.get('problems', problemId);
      if (!pr || String(pr.contestId) !== String(c.id)) return send(res, 422, { error: { code: 'PROBLEM', message: 'Problem does not belong to this contest.', hint: 'Pick a problem from this contest.' } });
    }
    const points = Number(b.points);
    if (!Number.isFinite(points) || points < 0 || points > MAX_POINTS) {
      return send(res, 422, { error: { code: 'POINTS', message: `points must be a number between 0 and ${MAX_POINTS}.`, hint: 'Use 0–100.' } });
    }
    const reason = String(b.reason || '').slice(0, 500);
    const now = new Date().toISOString();
    const rows = [...gradeOverrideRows(c)];
    const idx = rows.findIndex((o) => String(o.userId) === uid && (o.problemId == null ? problemId == null : String(o.problemId) === String(problemId)));
    let row;
    if (idx >= 0) {
      row = { ...rows[idx], points, reason, by: me.id, at: now };
      rows[idx] = row;
    } else {
      row = { id: nextRowId(rows), contestId: c.id, userId: uid, problemId, points, reason, by: me.id, at: now };
      rows.push(row);
    }
    store.update('contests', c.id, { gradeOverrides: rows });
    audit(me.id, idx >= 0 ? 'contest.grade.override.update' : 'contest.grade.override', `contest:${c.id}`, { overrideId: row.id, userId: uid, problemId, points });
    return send(res, 200, { ok: true, override: row });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/overrides\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const rows = gradeOverrideRows(c);
    const row = rows.find((o) => String(o.id) === String(mt[2]));
    if (!row) return send(res, 404, { error: { code: 'NO_OVERRIDE', message: 'Override not found.', hint: 'Reload the grade matrix.' } });
    store.update('contests', c.id, { gradeOverrides: rows.filter((o) => String(o.id) !== String(mt[2])) });
    audit(me.id, 'contest.grade.override.remove', `contest:${c.id}`, { overrideId: row.id, userId: row.userId, problemId: row.problemId ?? null });
    return send(res, 200, { ok: true, removed: row.id });
  }

  // D4: publish or hide grades for students. Admin matrix/export are unaffected.
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/release$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const settings = { ...(c.settings || {}) };
    if (b.released === false) {
      settings.gradeReleased = false;
      settings.gradeReleaseAt = null;
    } else {
      let at = null;
      if (b.at != null && b.at !== '') {
        at = new Date(b.at);
        if (!Number.isFinite(at.getTime())) return send(res, 422, { error: { code: 'AT', message: 'at must be a valid ISO date.', hint: 'e.g. 2026-10-20T12:00:00Z.' } });
      }
      if (at && at.getTime() > Date.now()) {
        // Scheduled publish: no explicit hold, so releaseState opens it when due.
        delete settings.gradeReleased;
        settings.gradeReleaseAt = at.toISOString();
      } else {
        settings.gradeReleased = true;
        settings.gradeReleaseAt = at ? at.toISOString() : new Date().toISOString();
      }
    }
    store.update('contests', c.id, { settings });
    audit(me.id, 'contest.grade.release', `contest:${c.id}`, { released: settings.gradeReleased, gradeReleaseAt: settings.gradeReleaseAt });
    return send(res, 200, { ok: true, ...releaseState({ ...c, settings }) });
  }

  // D6: bulk rejudge by problem code/id, verdict, or user. Requires a filter so a
  // stray call cannot requeue the whole contest.
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/rejudge$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const f = b.filter && typeof b.filter === 'object' && !Array.isArray(b.filter) ? b.filter : {};
    const problemRef = f.problemId ?? f.problem ?? b.problemId ?? b.problem ?? null;
    const verdictRef = f.verdict ?? f.status ?? b.verdict ?? b.status ?? null;
    const rawUsers = f.userIds ?? f.users ?? b.userIds ?? b.users ?? (f.login ?? b.login ? [f.login ?? b.login] : null);
    if (problemRef == null && !verdictRef && !rawUsers) {
      return send(res, 422, { error: { code: 'FILTER', message: 'At least one filter is required (problem, verdict or userIds).', hint: 'Example: {"filter":{"verdict":"WA"}}.' } });
    }
    const probs = contestProblems(c);
    let matchedProblems = null;
    if (problemRef != null) {
      const byId = store.get('problems', problemRef);
      const list = byId && String(byId.contestId) === String(c.id)
        ? [byId]
        : probs.filter((p2) => String(p2.code).toUpperCase() === String(problemRef).trim().toUpperCase());
      if (!list.length) return send(res, 422, { error: { code: 'PROBLEM', message: 'No problem in this contest matches the filter.', hint: 'Use a problem code (e.g. A) or id.' } });
      matchedProblems = new Set(list.map((p2) => String(p2.id)));
    }
    let userIds = null;
    if (rawUsers != null) {
      const refs = Array.isArray(rawUsers) ? rawUsers : [rawUsers];
      if (!refs.length) return send(res, 422, { error: { code: 'USER', message: 'userIds must not be empty.', hint: '' } });
      userIds = new Set();
      for (const ref of refs) {
        const u2 = store.get('users', ref) || store.query('users', (x) => x.login === String(ref))[0];
        if (!u2) return send(res, 422, { error: { code: 'USER', message: `No user "${ref}".`, hint: 'Pass user ids or logins.' } });
        userIds.add(String(u2.id));
      }
    }
    const verdict = verdictRef == null ? null : String(verdictRef).trim().toUpperCase();
    let matched = contestSubmits(c);
    if (matchedProblems) matched = matched.filter((s) => matchedProblems.has(String(s.problemId)));
    if (verdict) matched = matched.filter((s) => String(s.status).toUpperCase() === verdict);
    if (userIds) matched = matched.filter((s) => userIds.has(String(s.userId)));
    const requeued = [];
    for (const s of matched.slice(0, MAX_REJUDGE)) {
      if (J.QUEUE.includes(Number(s.id))) continue;
      store.update('submits', s.id, { status: 'QUE', testsDone: 0, judgedAt: null, perTest: [], perTestFull: null, compileLog: '', points: 0 });
      J.QUEUE.push(Number(s.id));
      requeued.push(s.id);
    }
    if (requeued.length) {
      processQueue()
        .then(() => {
          for (const id of requeued) fireWebhooks('rejudge.done', { submitId: id, contestId: c.id });
        })
        .catch(() => {});
    }
    audit(me.id, 'contest.grade.rejudge', `contest:${c.id}`, { problem: problemRef ?? null, verdict, users: userIds ? userIds.size : 0, requeued: requeued.length });
    return send(res, 200, { ok: true, requeued: requeued.length, submitIds: requeued });
  }

  // D6: download every member's best/latest code, one file per problem.
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/codes\.zip$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const probs = contestProblems(c);
    const byId = new Map(probs.map((p2) => [String(p2.id), p2]));
    const best = new Map();
    for (const s of contestSubmits(c)) {
      if (!byId.has(String(s.problemId)) || s.userId == null) continue;
      const key = `${String(s.userId)}:${String(s.problemId)}`;
      const cur = best.get(key);
      if (!cur) { best.set(key, s); continue; }
      const sa = isAccepted(s.status) ? 1 : 0;
      const ca = isAccepted(cur.status) ? 1 : 0;
      if (sa !== ca) { if (sa) best.set(key, s); continue; }
      const sp = Number(s.points || 0);
      const cp = Number(cur.points || 0);
      if (sp !== cp) { if (sp > cp) best.set(key, s); continue; }
      if (new Date(s.createdAt) > new Date(cur.createdAt)) best.set(key, s);
    }
    const codeCounts = new Map();
    for (const p2 of probs) {
      const k = String(p2.code || `P${p2.id}`);
      codeCounts.set(k, (codeCounts.get(k) || 0) + 1);
    }
    const safeSegment = (v) => String(v || 'x').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
    const extOf = (filename) => {
      const m2 = String(filename || '').match(/\.([A-Za-z0-9]+)$/);
      return m2 ? `.${m2[1].toLowerCase()}` : '.txt';
    };
    const files = [];
    for (const u2 of gradeMembers(c)) {
      for (const p2 of probs) {
        const s = best.get(`${String(u2.id)}:${String(p2.id)}`);
        if (!s) continue;
        const code = String(p2.code || `P${p2.id}`);
        const base = codeCounts.get(code) > 1 ? `${code}-${p2.id}` : code;
        files.push({
          name: `${safeSegment(u2.login)}/${safeSegment(base)}${extOf(s.filename)}`,
          data: Buffer.from(String(s.code || ''), 'utf8'),
        });
      }
    }
    if (!files.length) return send(res, 404, { error: { code: 'NO_CODES', message: 'No member submissions to bundle.', hint: 'Wait for submissions or adjust membership.' } });
    const zip = zipStore(files);
    audit(me.id, 'contest.grade.codes-zip', `contest:${c.id}`, { files: files.length });
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="codes-contest-${c.id}.zip"`,
      'Content-Length': zip.length,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(zip);
    return true;
  }

  // D3/D6: per-student or per-group deadline extensions. `days` extends each
  // problem's current effective deadline, `until` sets one absolute deadline.
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/extend-selected$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const rawIds = Array.isArray(b.userIds) ? b.userIds : (b.userId != null ? [b.userId] : []);
    if (!rawIds.length) return send(res, 422, { error: { code: 'USER', message: 'userIds must contain at least one member.', hint: 'Pick students in the grade matrix.' } });
    const memberIds = new Set((c.members || []).map(String));
    const uids = [];
    for (const ref of rawIds) {
      const u2 = store.get('users', ref) || store.query('users', (x) => x.login === String(ref))[0];
      if (!u2) return send(res, 422, { error: { code: 'USER', message: `No user "${ref}".`, hint: 'Pass user ids or logins.' } });
      if (!memberIds.has(String(u2.id))) return send(res, 422, { error: { code: 'NOT_MEMBER', message: `${u2.login} is not a contest member.`, hint: 'Add them to the contest first.' } });
      if (!uids.includes(String(u2.id))) uids.push(String(u2.id));
    }
    const probs = contestProblems(c);
    const problemRaw = b.problemId;
    const problemId = problemRaw == null || problemRaw === '' ? null : Number(problemRaw);
    if (problemId != null) {
      if (!Number.isFinite(problemId)) return send(res, 422, { error: { code: 'PROBLEM', message: 'problemId must be a number or null.', hint: '' } });
      const pr = store.get('problems', problemId);
      if (!pr || String(pr.contestId) !== String(c.id)) return send(res, 422, { error: { code: 'PROBLEM', message: 'Problem does not belong to this contest.', hint: '' } });
    }
    const dl = contestDeadlines(c);
    const contestDefault = (c.settings || {}).defaultDeadline || resolveContestEnd(c) || null;
    let days = null;
    let untilIso = null;
    let targets;
    if (b.until != null && b.until !== '') {
      const at = new Date(b.until);
      if (!Number.isFinite(at.getTime())) return send(res, 422, { error: { code: 'UNTIL', message: 'until must be a valid ISO date.', hint: 'e.g. 2026-11-01T23:59:00Z.' } });
      untilIso = at.toISOString();
      targets = [{ problemId, until: untilIso }];
    } else {
      days = Number(b.days);
      if (!Number.isFinite(days) || days === 0) return send(res, 422, { error: { code: 'DAYS', message: 'days (+/-) or until is required.', hint: 'e.g. {"days":7} or {"until":"2026-11-01T23:59:00Z"}.' } });
      if (Math.abs(days) > 365) return send(res, 422, { error: { code: 'DAYS', message: 'days must be between -365 and 365.', hint: '' } });
      const ms = days * 86400000;
      const shift = (iso) => new Date((iso ? new Date(iso).getTime() : Date.now()) + ms).toISOString();
      targets = problemId != null
        ? [{ problemId, until: shift(dl.deadlines[problemId] || contestDefault) }]
        : probs.map((p2) => ({ problemId: p2.id, until: shift(dl.deadlines[p2.id] || contestDefault) }));
    }
    const rows = [...contestExtensionRows(c)];
    const now = new Date().toISOString();
    let updated = 0;
    for (const uid of uids) {
      for (const t of targets) {
        const idx = rows.findIndex((e) => String(e.userId) === uid && (e.problemId == null ? t.problemId == null : String(e.problemId) === String(t.problemId)));
        if (idx >= 0) rows[idx] = { ...rows[idx], until: t.until, by: me.id, at: now };
        else rows.push({ id: nextRowId(rows), contestId: c.id, userId: uid, problemId: t.problemId, until: t.until, by: me.id, at: now });
        updated += 1;
      }
    }
    store.update('contests', c.id, { extensions: rows });
    audit(me.id, 'contest.grade.extend', `contest:${c.id}`, { userIds: uids, problemId, days, until: untilIso, updated });
    return send(res, 200, { ok: true, updated, days, until: untilIso, problemId });
  }

  // grading: what-if preview, bulk feedback, grade CSV export (USOS-style)
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/(preview|feedback)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const probs = contestProblems(c);
    const has = (v) => v !== '' && v != null;
    if (mt[2] === 'preview') {
      const dp = { ...(((c.settings || {}).deadlinePolicy) || {}) };
      if (has(b.penaltyKind)) dp.penaltyKind = String(b.penaltyKind);
      if (has(b.latePenalty)) dp.penaltyValue = Number(b.latePenalty);
      if (has(b.graceMin)) dp.graceMin = Number(b.graceMin);
      if (has(b.capZeroAfterDays)) dp.capZeroAfterDays = Number(b.capZeroAfterDays);
      const scoring = { ...(((c.settings || {}).scoring) || {}) };
      if (has(b.floorPct)) scoring.floorPct = Number(b.floorPct);
      if (has(b.dropWorstN)) scoring.dropWorstN = Number(b.dropWorstN);
      const bestOfK = has(b.bestOfK) ? Number(b.bestOfK) : (c.settings || {}).bestOfK;
      const c2 = { ...c, settings: { ...(c.settings || {}), deadlinePolicy: dp, scoring, bestOfK } };
      const probs2 = probs.map((p2) => (b.weights && has(b.weights[p2.id]) ? { ...p2, weight: Number(b.weights[p2.id]) } : p2));
      const m2 = matrixData(c2, probs2);
      const rows = m2.rows.map((r) => ({ login: r.login, total: r.total, grade: r.grade }));
      const login = String(b.login || b.student || b.previewStudent || '').toLowerCase();
      const student = rows.find((r) => String(r.login).toLowerCase() === login) || null;
      const avg = rows.length ? Math.round((rows.reduce((a, r) => a + r.total, 0) / rows.length) * 10) / 10 : 0;
      audit(me.id, 'contest.grade.preview', `contest:${c.id}`, { overrides: Object.keys(b) });
      return send(res, 200, {
        applied: {
          bestOfK: bestOfK ?? null, penaltyKind: dp.penaltyKind ?? null, penaltyValue: dp.penaltyValue ?? null,
          graceMin: dp.graceMin ?? null, capZeroAfterDays: dp.capZeroAfterDays ?? null,
          floorPct: scoring.floorPct ?? null, dropWorstN: scoring.dropWorstN ?? null,
        },
        scale: m2.scale,
        rows: rows.slice(0, 100), student, summary: { students: rows.length, avg },
      });
    }
    const text = String(b.text || '').slice(0, 2000);
    if (!text) return send(res, 422, { error: { code: 'TEXT', message: 'Feedback text required.', hint: '' } });
    const filter = String(b.filter || '').trim().replace(/^problem\s+/i, '');
    let matched = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly);
    if (filter) {
      const fl = filter.toUpperCase();
      const byProblem = probs.filter((p2) => String(p2.code).toUpperCase() === fl);
      matched = byProblem.length
        ? matched.filter((s) => byProblem.some((p2) => String(p2.id) === String(s.problemId)))
        : matched.filter((s) => String(s.status).toUpperCase() === fl);
    }
    const userIds = [...new Set(matched.map((s) => String(s.userId)))];
    for (const uid of userIds) notifyUser(uid, 'grade.feedback', { contestId: c.id, filter, text });
    // Optional email mirror. UI keeps this implicit: a configured transport delivers,
    // an unconfigured one reports the skip instead of pretending.
    const emailTargets = userIds.map((uid) => store.get('users', uid)).filter((u2) => u2
      && u2.email
      && (!u2.notificationPrefs || u2.notificationPrefs.email !== false)).slice(0, 200);
    let emailed = 0;
    let emailErrors = 0;
    if (mailConfigured() && emailTargets.length) {
      const subject = `[Satori] Feedback — ${c.name}`;
      const link = `${webBaseUrl()}/contests/${c.id}/grade`;
      const results = await Promise.allSettled(emailTargets.map((u2) => sendMail({
        to: u2.email,
        subject,
        text: `${text}\n\nOpen your grade: ${link}`,
      })));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.ok) emailed += 1;
        else emailErrors += 1;
      }
    }
    audit(me.id, 'contest.grade.feedback', `contest:${c.id}`, { filter, submits: matched.length, users: userIds.length, emailed, emailErrors });
    return send(res, 200, {
      ok: true, count: matched.length, users: userIds.length,
      emailed, emailErrors, emailSkipped: !mailConfigured(),
    });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/export\.csv$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, NO_CONTEST);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const matrix = matrixData(c);
    const overrideRaw = u.searchParams.get('scale');
    const override = overrideRaw ? parseGradeScale(overrideRaw) : null;
    const rows = [...matrix.rows].sort((a, b2) => String(a.login).localeCompare(String(b2.login)));
    const lines = [];
    lines.push(['login', 'usos_id', 'first_name', 'last_name', 'email', 'total', 'pct', 'grade', ...matrix.problems.map((p2) => p2.code || `P${p2.id}`)].join(','));
    for (const r of rows) {
      const u2 = store.get('users', r.id) || {};
      const cells = matrix.problems.map((p2) => (r.cells[p2.id] ? round1(r.cells[p2.id].points) : 0));
      lines.push([
        csvCell(u2.login || r.login), csvCell(u2.usosId || ''), csvCell(u2.firstName || ''), csvCell(u2.lastName || ''), csvCell(u2.email || ''),
        r.total, r.total, override ? gradeFromScale(override, r.total) : r.grade, ...cells,
      ].join(','));
    }
    audit(me.id, 'contest.grade.export', `contest:${c.id}`, { scale: (override || matrix.scale).map((s) => `${s.min}:${s.grade}`).join(' '), students: rows.length });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="grades-contest-${c.id}.csv"`,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(BOM + lines.join('\r\n') + '\r\n');
    return true;
  }
  return false;
}

// `computeRowGrade` and `releaseState` are exported as the handoff seam for the
// student `/grade` route (routes/contests.js), which still calls computeLabsGrade
// directly and therefore ignores overrides/extensions until it switches to this.
module.exports = { handle, releaseState, computeRowGrade };
