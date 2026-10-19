// Lane D — Gate A: grade matrix parity, analytics, settings round-trip, USOS export.
// Uses the shared dynamic-port harness so it can run beside other lanes.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let teacherTok;
let studentTok;
let studentId;
let cid;
let pids;
let firstBloodAt;

const GRADE_SCALE = '95:5,80:4,50:3,0:2';
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

function insertSubmit(extra) {
  return h.store.insert('submits', {
    contestId: cid, sampleOnly: false, code: 'print(1)', filename: 'sol.py', lang: 'Python',
    ...extra,
  });
}

before(async () => {
  h = await startServer({ prefix: 'satori-lane-d-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');
  const me = await h.api('/api/me', {}, studentTok);
  studentId = me.body.id;
  h.store.update('users', studentId, { usosId: '123456' });

  h.store.insert('users', {
    login: 'low_student', firstName: 'Low', lastName: 'Student', email: 'low@uj.edu.pl',
    pass: 'unused', rolesGlobal: ['student'], createdAt: new Date().toISOString(),
  });

  const contest = await h.createContest(teacherTok, {
    name: 'Lane D grading', mode: 'LABS',
    startAt: '2026-01-01T00:00:00Z', endAt: '2026-12-31T23:59:59Z',
    settings: {
      penaltyMin: 0, bestOfK: 3, gradeScale: GRADE_SCALE,
      scoring: { rule: 'best', dropWorstN: 1, customKey: 'keep-me' },
      deadlinePolicy: { enabled: false, penaltyKind: 'perDay', penaltyValue: 5, graceMin: 0 },
    },
  });
  cid = contest.id;

  const a = await h.createProblem(cid, teacherTok, { code: 'A', name: 'Alpha' });
  const b = await h.createProblem(cid, teacherTok, { code: 'B', name: 'Beta' });
  const c = await h.createProblem(cid, teacherTok, { code: 'C', name: 'Gamma' });
  pids = [a.id, b.id, c.id];
  await h.api(`/api/problems/${a.id}`, { method: 'PATCH', body: { weight: 2 } }, teacherTok);

  const add = await h.api(`/api/contests/${cid}/members/csv`, { method: 'POST', body: { csv: 'jan_kowalski' } }, teacherTok);
  assert.equal(add.status, 200);
  const addLow = await h.api(`/api/contests/${cid}/members`, { method: 'POST', body: { login: 'low_student', role: 'participant' } }, teacherTok);
  assert.equal(addLow.status, 201);

  // A: WA then OK; B: WA then OK (80); C: WA. The worst (C) is dropped by dropWorstN=1.
  // Recent timestamps keep the active student out of the 7-day idle at-risk rule.
  firstBloodAt = hoursAgo(4);
  insertSubmit({ problemId: a.id, userId: studentId, status: 'WA', points: 0, createdAt: hoursAgo(5), perTestFull: [{ n: 1, verdict: 'WA' }] });
  insertSubmit({ problemId: a.id, userId: studentId, status: 'OK', points: 100, createdAt: firstBloodAt, perTestFull: [{ n: 1, verdict: 'OK' }] });
  insertSubmit({ problemId: b.id, userId: studentId, status: 'WA', points: 0, createdAt: hoursAgo(3) });
  insertSubmit({ problemId: b.id, userId: studentId, status: 'OK', points: 80, createdAt: hoursAgo(2) });
  insertSubmit({ problemId: c.id, userId: studentId, status: 'WA', points: 0, createdAt: hoursAgo(1) });
});

after(async () => {
  if (h) await h.close();
});

test('D1 matrix total/grade match /grade, preview and CSV (USOS + BOM)', async () => {
  const matrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  assert.equal(matrix.status, 200);
  assert.deepEqual(matrix.body.problems.map((p) => p.code), ['A', 'B', 'C']);
  assert.ok(matrix.body.scale.some((s) => s.min === 80 && s.grade === 4), 'contest scale returned');

  const jan = matrix.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.ok(jan, 'student row present');
  assert.equal(jan.total, 93.3, 'weighted best-of-2 / drop worst');
  assert.equal(jan.grade, 4, 'settings.gradeScale applied');
  assert.equal(jan.cells[pids[0]].points, 100);
  assert.equal(jan.cells[pids[1]].points, 80);
  assert.equal(jan.cells[pids[2]].points, 0);
  assert.equal(jan.attempts, 5);
  assert.ok(!matrix.body.rows.some((r) => r.login === 'g_herman'), 'teachers are not graded');

  const grade = await h.api(`/api/contests/${cid}/grade?user=${studentId}`, {}, teacherTok);
  assert.equal(grade.status, 200);
  assert.equal(grade.body.total, jan.total, 'matrix total == /grade total');
  assert.equal(grade.body.grade, jan.grade, 'matrix grade == /grade grade');

  const preview = await h.api(`/api/contests/${cid}/grade/preview`, { method: 'POST', body: { student: 'jan_kowalski' } }, teacherTok);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.student.total, jan.total, 'preview default == matrix');
  assert.equal(preview.body.student.grade, jan.grade, 'preview default grade == matrix');
  assert.equal(preview.body.rows.find((r) => r.login === 'jan_kowalski').total, jan.total);

  // fetch().text() strips the BOM, so inspect raw bytes for the Excel guard.
  const csvRes = await fetch(`${h.base}/api/contests/${cid}/grade/export.csv`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  assert.equal(csvRes.status, 200);
  const csvBytes = Buffer.from(await csvRes.arrayBuffer());
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM for Excel');
  const lines = csvBytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  assert.match(lines[0], /^login,usos_id,first_name,last_name,email,total,pct,grade,A,B,C$/);
  const janLine = lines.find((l) => l.startsWith('jan_kowalski,'));
  assert.ok(janLine, 'jan in export');
  const cols = janLine.split(',');
  assert.equal(cols[1], '123456', 'USOS ID exported');
  assert.equal(Number(cols[5]), jan.total, 'CSV total == matrix');
  assert.equal(Number(cols[6]), jan.total, 'CSV pct == total');
  assert.equal(Number(cols[7]), jan.grade, 'CSV grade == matrix');
  assert.equal(Number(cols[8]), 100, 'problem A cell');
  assert.equal(Number(cols[10]), 0, 'problem C dropped to 0 points still exported');

  const me = await h.api('/api/me', {}, studentTok);
  assert.equal(me.body.usosId, '123456', 'usosId round-trips through /me');

  const override = await h.request(`/api/contests/${cid}/grade/export.csv?scale=${encodeURIComponent('0:2')}`, {}, teacherTok);
  const overrideCols = override.text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.startsWith('jan_kowalski,')).split(',');
  assert.equal(Number(overrideCols[7]), 2, 'explicit scale override still honoured');
});

test('D1 matrix applies late penalty and floor through computeLabsGrade', async () => {
  const contest = await h.createContest(teacherTok, {
    name: 'Lane D late', mode: 'LABS',
    settings: {
      gradeScale: '90:5,50:3,0:2',
      deadlinePolicy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 60, graceMin: 0, capZeroAfterDays: null },
      scoring: { rule: 'best', floorPct: 50 },
    },
  });
  const p = await h.createProblem(contest.id, teacherTok, { code: 'L', name: 'Late', deadlineAt: hoursAgo(48) });
  await h.api(`/api/contests/${contest.id}/members/csv`, { method: 'POST', body: { csv: 'jan_kowalski' } }, teacherTok);
  h.store.insert('submits', {
    contestId: contest.id, problemId: p.id, userId: studentId, status: 'OK', points: 100,
    createdAt: hoursAgo(24), sampleOnly: false,
  });
  const matrix = await h.api(`/api/contests/${contest.id}/grade/matrix`, {}, teacherTok);
  const row = matrix.body.rows[0];
  assert.equal(row.total, 50, 'one day late: 100 - 60, floored at 50%');
  assert.equal(row.grade, 3, 'settings scale applied after late penalty');
  const grade = await h.api(`/api/contests/${contest.id}/grade?user=${studentId}`, {}, teacherTok);
  assert.equal(grade.body.total, row.total);
  assert.equal(grade.body.grade, row.grade);
  const csvRes = await fetch(`${h.base}/api/contests/${contest.id}/grade/export.csv`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  const cols = Buffer.from(await csvRes.arrayBuffer()).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.startsWith('jan_kowalski,')).split(',');
  assert.equal(Number(cols[5]), row.total);
  assert.equal(Number(cols[7]), row.grade);
});

test('D7 analytics use real distribution, grades, problem quality and first blood', async () => {
  const r = await h.api(`/api/contests/${cid}/grade/analytics`, {}, teacherTok);
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.students, 2);
  assert.equal(r.body.summary.problems, 3);
  assert.equal(r.body.summary.average, 46.7, 'average over real rows (93.3 + 0)');

  const total = r.body.distribution.reduce((sum, d) => sum + d.count, 0);
  assert.equal(total, 2, 'every student counted once');
  assert.equal(r.body.distribution.find((d) => d.label === '90–100').count, 1);
  assert.equal(r.body.distribution.find((d) => d.label === '0–49').count, 1);

  assert.equal(r.body.atRisk.length, 1);
  const risk = r.body.atRisk[0];
  assert.equal(risk.login, 'low_student');
  assert.equal(risk.total, 0);
  assert.equal(risk.grade, 2, 'real grade, not a placeholder');
  assert.ok(risk.reasons.includes('low') && risk.reasons.includes('none'));

  const a = r.body.problems.find((p) => p.code === 'A');
  assert.equal(a.attempts, 2);
  assert.equal(a.acceptedSubmits, 1);
  assert.equal(a.failedSubmits, 1);
  assert.equal(a.solvers, 1);
  assert.equal(a.solveRatePct, 50);
  assert.equal(a.firstBlood.login, 'jan_kowalski');

  const b = r.body.problems.find((p) => p.code === 'B');
  assert.equal(b.attempts, 2);
  assert.equal(b.failedSubmits, 1);
  assert.equal(b.firstBlood.login, 'jan_kowalski');

  assert.equal(r.body.firstBlood.code, 'A');
  assert.equal(r.body.firstBlood.login, 'jan_kowalski');
  assert.equal(new Date(r.body.firstBlood.at).toISOString(), new Date(firstBloodAt).toISOString());
});

test('D1/D7 negative paths: anon 401, student 403, missing contest 404', async () => {
  const anonMatrix = await h.api(`/api/contests/${cid}/grade/matrix`);
  assert.equal(anonMatrix.status, 401);
  assert.equal(anonMatrix.body.error.code, 'AUTH');

  const studentMatrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, studentTok);
  assert.equal(studentMatrix.status, 403);
  assert.equal(studentMatrix.body.error.code, 'FORBIDDEN');

  const anonAnalytics = await h.api(`/api/contests/${cid}/grade/analytics`);
  assert.equal(anonAnalytics.status, 401);
  const studentAnalytics = await h.api(`/api/contests/${cid}/grade/analytics`, {}, studentTok);
  assert.equal(studentAnalytics.status, 403);

  const missingMatrix = await h.api('/api/contests/999999/grade/matrix', {}, teacherTok);
  assert.equal(missingMatrix.status, 404);
  assert.equal(missingMatrix.body.error.code, 'NO_CONTEST');
  const missingAnalytics = await h.api('/api/contests/999999/grade/analytics', {}, teacherTok);
  assert.equal(missingAnalytics.status, 404);

  const studentCsv = await h.request(`/api/contests/${cid}/grade/export.csv`, {}, studentTok);
  assert.equal(studentCsv.status, 403);
  const anonCsv = await h.request(`/api/contests/${cid}/grade/export.csv`);
  assert.equal(anonCsv.status, 401);
});

test('D5 USOS ID import updates only contest members; rejects bad input', async () => {
  const r = await h.api(`/api/contests/${cid}/grade/usos-import`, {
    method: 'POST',
    body: { csv: 'login,usos_id\nlow_student,654321\nghost_user,111\ng_herman,222\nlow_student,' },
  }, teacherTok);
  assert.equal(r.status, 200);
  assert.equal(r.body.updated, 1, 'only the member with an ID is updated');
  assert.deepEqual(r.body.unknown, ['ghost_user']);
  assert.deepEqual(r.body.skipped, ['g_herman'], 'existing user outside this contest is skipped');
  assert.deepEqual(r.body.invalid, ['low_student'], 'missing ID is reported, not written');

  const matrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  assert.equal(matrix.body.rows.find((x) => x.login === 'low_student').usosId, '654321');

  const csvRes = await fetch(`${h.base}/api/contests/${cid}/grade/export.csv`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  const text = Buffer.from(await csvRes.arrayBuffer()).toString('utf8').replace(/^\uFEFF/, '');
  assert.ok(text.includes('low_student,654321,'), 'imported USOS ID round-trips into the export');

  const anon = await h.api(`/api/contests/${cid}/grade/usos-import`, { method: 'POST', body: { csv: 'low_student,1' } });
  assert.equal(anon.status, 401);
  const student = await h.api(`/api/contests/${cid}/grade/usos-import`, { method: 'POST', body: { csv: 'low_student,1' } }, studentTok);
  assert.equal(student.status, 403);
  const empty = await h.api(`/api/contests/${cid}/grade/usos-import`, { method: 'POST', body: { csv: '  \n ' } }, teacherTok);
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error.code, 'CSV_EMPTY');
  const badHeader = await h.api(`/api/contests/${cid}/grade/usos-import`, { method: 'POST', body: { csv: 'login,grade\nlow_student,5' } }, teacherTok);
  assert.equal(badHeader.status, 422);
  assert.equal(badHeader.body.error.code, 'CSV_HEADER');
  const missing = await h.api('/api/contests/999999/grade/usos-import', { method: 'POST', body: { csv: 'a,1' } }, teacherTok);
  assert.equal(missing.status, 404);
});

test('D8 settings writer preserves unknown keys, penaltyMin and dropWorstN', async () => {
  const contest = await h.createContest(teacherTok, {
    name: 'Lane D settings', mode: 'ICPC',
    settings: {
      penaltyMin: 11, gradeScale: '85:5,70:4,0:2',
      scoring: { rule: 'best', wrongTryMin: 11, dropWorstN: 2, customKey: 'keep-me' },
      customSetting: 'keep-this',
    },
  });
  const before = (await h.api(`/api/contests/${contest.id}`, {}, teacherTok)).body;
  const patch = {
    penalty: 13,
    scoreboardMode: before.mode,
    settings: {
      ...before.settings,
      penaltyMin: 13,
      scoring: { ...before.settings.scoring, penaltyMin: 13, wrongTryMin: 13, dropWorstN: 3 },
    },
  };
  const r = await h.api(`/api/contests/${contest.id}`, { method: 'PATCH', body: patch }, teacherTok);
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.penaltyMin, 13, 'penaltyMin written top-level');
  assert.equal(r.body.settings.scoring.penaltyMin, 13, 'penaltyMin written inside scoring');
  assert.equal(r.body.settings.scoring.wrongTryMin, 13, 'wrongTryMin stays consistent');
  assert.equal(r.body.settings.scoring.customKey, 'keep-me', 'unknown scoring key preserved');
  assert.equal(r.body.settings.scoring.dropWorstN, 3, 'dropWorstN updated');
  assert.equal(r.body.settings.gradeScale, '85:5,70:4,0:2', 'gradeScale preserved');
  assert.equal(r.body.settings.customSetting, 'keep-this', 'unknown settings key preserved');

  // Ranking reads settings.penaltyMin (ICPC wrong-try cost).
  const rc = await h.createContest(teacherTok, { name: 'Lane D penalty', mode: 'ICPC', settings: { penaltyMin: 7 } });
  const p = await h.createProblem(rc.id, teacherTok, { code: 'A', name: 'Penalty' });
  await h.api(`/api/contests/${rc.id}/members/csv`, { method: 'POST', body: { csv: 'jan_kowalski' } }, teacherTok);
  h.store.insert('submits', { contestId: rc.id, problemId: p.id, userId: studentId, status: 'WA', points: 0, createdAt: '2026-01-11T10:00:00Z', sampleOnly: false });
  h.store.insert('submits', { contestId: rc.id, problemId: p.id, userId: studentId, status: 'OK', points: 100, createdAt: '2026-01-11T10:10:00Z', sampleOnly: false });
  const ranking = await h.api(`/api/contests/${rc.id}/ranking`, {}, teacherTok);
  assert.equal(ranking.status, 200);
  assert.equal(ranking.body.penaltyMin, 7, 'ranking honours settings.penaltyMin');
});
