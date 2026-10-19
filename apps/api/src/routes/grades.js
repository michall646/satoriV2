// Satori V2 — grade matrix, analytics, preview, feedback, and CSV export.
// All totals/grades come from computeLabsGrade so page, preview, board and export agree.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');
const { computeLabsGrade, parseGradeScale, gradeFromScale, csvCell } = require('../lib/contestAccess');
const { isAccepted } = require('../lib/ranking');

const NO_CONTEST = { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } };
const BOM = '\uFEFF';
const IDLE_MS = 7 * 864e5;
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

// One matrix builder shared by preview, matrix, analytics and CSV.
function matrixData(c, probsArg) {
  const probs = probsArg || contestProblems(c);
  const subs = contestSubmits(c);
  const users = gradeMembers(c);
  let scale = parseGradeScale((c.settings || {}).gradeScale);
  const rows = users.map((u2) => {
    const own = subs.filter((s) => String(s.userId) === String(u2.id));
    const { out } = computeLabsGrade(c, probs, (s) => String(s.userId) === String(u2.id), { submits: subs });
    if (Array.isArray(out.scale) && out.scale.length) scale = out.scale;
    const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
    const cells = {};
    for (const p of probs) {
      const d = detail.get(String(p.id));
      cells[p.id] = d
        ? { points: round1(d.points), raw: round1(d.raw), weight: d.weight, lateUnits: d.lateUnits || 0, late: (d.lateUnits || 0) > 0 }
        : null;
    }
    const lastSubmitAt = own.reduce((at, s) => (!at || new Date(s.createdAt) > new Date(at) ? s.createdAt : at), null);
    return {
      id: u2.id, login: u2.login, usosId: u2.usosId || '',
      total: out.total, pct: out.total, grade: out.grade,
      cells, attempts: own.length, lastSubmitAt,
    };
  });
  rows.sort((a, b2) => (b2.total - a.total) || String(a.login).localeCompare(String(b2.login)));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const average = rows.length ? round1(rows.reduce((sum, r) => sum + r.total, 0) / rows.length) : 0;
  return {
    contestId: c.id,
    mode: c.mode || null,
    scale,
    problems: probs.map((p) => problemMeta(c, p)),
    rows,
    summary: { students: rows.length, graded: rows.filter((r) => r.attempts > 0).length, average },
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
    for (const uid of userIds) store.insert('notifications', { userId: uid, type: 'grade.feedback', payload: { contestId: c.id, filter, text }, read: false, at: new Date().toISOString() });
    audit(me.id, 'contest.grade.feedback', `contest:${c.id}`, { filter, submits: matched.length, users: userIds.length });
    return send(res, 200, { ok: true, count: matched.length, users: userIds.length });
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

module.exports = { handle };
