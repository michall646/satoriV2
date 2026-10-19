// Satori V2 — grade preview, feedback, and CSV export.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');
const { computeLabsGrade, parseGradeScale, gradeFromScale, csvCell } = require('../lib/contestAccess');

async function handle(req, res, url, p, m) {
  const u = url;
  // grading: what-if preview, bulk feedback, grade CSV export (USOS-style)
  let mt = p.match(/^\/api\/contests\/(\d+)\/grade\/(preview|feedback)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
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
      const members = (c.members || []).map((id) => store.get('users', id)).filter(Boolean);
      const rows = members.map((u2) => {
        const { out } = computeLabsGrade(c2, probs2, (s) => String(s.userId) === String(u2.id));
        return { login: u2.login, total: out.total, grade: out.grade };
      }).sort((a, b2) => b2.total - a.total);
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
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
    const scale = parseGradeScale(u.searchParams.get('scale'));
    const members = (c.members || []).map((id) => store.get('users', id)).filter(Boolean).sort((a, b2) => String(a.login).localeCompare(String(b2.login)));
    const lines = [];
    lines.push(['login', 'usos_id', 'first_name', 'last_name', 'email', 'total', 'pct', 'grade', ...probs.map((p2) => p2.code || `P${p2.id}`)].join(','));
    for (const u2 of members) {
      const { out } = computeLabsGrade(c, probs, (s) => String(s.userId) === String(u2.id));
      const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
      const cells = probs.map((p2) => { const d = detail.get(String(p2.id)); return d ? Math.round(Number(d.points) * 10) / 10 : 0; });
      lines.push([csvCell(u2.login), csvCell(u2.usosId || ''), csvCell(u2.firstName || ''), csvCell(u2.lastName || ''), csvCell(u2.email || ''), out.total, out.total, gradeFromScale(scale, out.total), ...cells].join(','));
    }
    audit(me.id, 'contest.grade.export', `contest:${c.id}`, { scale: scale.map((s) => `${s.min}:${s.grade}`).join(' ') });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="grades-contest-${c.id}.csv"`,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(lines.join('\n'));
    return true;
  }
  return false;
}

module.exports = { handle };
