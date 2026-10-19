// Lane K — Batch 2: gradebook overrides, extensions, release and bulk actions.
// Uses the shared dynamic-port harness so it can run beside other lanes.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let teacherTok;
let studentTok;
let studentId;
let lowId;
let cid;
let extCid;
let zipCid;
let rjCid;
let emptyCid;
let pA;
let pB;
let pExt;
let rjA;

const SCALE = '90:5,75:4,50:3,0:2';
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const hoursAhead = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

async function addMembers(contestId, logins) {
  const r = await h.api(`/api/contests/${contestId}/members/csv`, { method: 'POST', body: { csv: logins.join(',') } }, teacherTok);
  assert.equal(r.status, 200);
  return r.body;
}

function putSubmit(extra) {
  return h.store.insert('submits', {
    sampleOnly: false, code: 'print(1)', filename: 'sol.py', lang: 'Python',
    status: 'WA', points: 0, testsTotal: 0, testsDone: 0, judgedAt: '2026-01-01T00:00:00Z',
    createdAt: hoursAgo(1),
    ...extra,
  });
}

// Store-only ZIP reader: local file headers, no compression (lib/zip zipStore).
function zipEntries(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    out.push({ name, method, data: buf.subarray(start, start + compSize).toString('utf8') });
    i = start + compSize;
  }
  return out;
}

async function csvRows(contestId) {
  const res = await fetch(`${h.base}/api/contests/${contestId}/grade/export.csv`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM kept');
  const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  return { header: lines[0], rows: lines.slice(1) };
}

before(async () => {
  h = await startServer({ prefix: 'satori-lane-k-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');
  const me = await h.api('/api/me', {}, studentTok);
  studentId = me.body.id;

  const low = h.store.insert('users', {
    login: 'low_student', firstName: 'Low', lastName: 'Student', email: 'low@uj.edu.pl',
    pass: 'unused', rolesGlobal: ['student'], createdAt: new Date().toISOString(),
  });
  lowId = low.id;

  // ---- D2 overrides: plain LABS contest, no deadline policy ----
  const c = await h.createContest(teacherTok, { name: 'Lane K overrides', mode: 'LABS', settings: { gradeScale: SCALE } });
  cid = c.id;
  pA = await h.createProblem(cid, teacherTok, { code: 'A', name: 'Alpha' });
  pB = await h.createProblem(cid, teacherTok, { code: 'B', name: 'Beta' });
  await addMembers(cid, ['jan_kowalski', 'low_student']);
  putSubmit({ contestId: cid, problemId: pA.id, userId: studentId, status: 'OK', points: 60, code: 'print(60)' });
  putSubmit({ contestId: cid, problemId: pB.id, userId: studentId, status: 'WA', points: 0, code: 'print("bad")' });

  // ---- D3 extensions: late submit with a soft per-day penalty ----
  const ext = await h.createContest(teacherTok, {
    name: 'Lane K extensions', mode: 'LABS',
    settings: {
      gradeScale: SCALE,
      deadlinePolicy: { enabled: true, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 60, graceMin: 0 },
    },
  });
  extCid = ext.id;
  pExt = await h.createProblem(extCid, teacherTok, { code: 'A', name: 'Late', deadlineAt: hoursAgo(48) });
  await addMembers(extCid, ['jan_kowalski']);
  putSubmit({ contestId: extCid, problemId: pExt.id, userId: studentId, status: 'OK', points: 100, code: 'print(100)', createdAt: hoursAgo(28) });

  // ---- D6 ZIP: best (accepted, higher points) wins per member × problem ----
  const zipC = await h.createContest(teacherTok, { name: 'Lane K zip', mode: 'LABS' });
  zipCid = zipC.id;
  const zA = await h.createProblem(zipCid, teacherTok, { code: 'A', name: 'Zip A' });
  const zB = await h.createProblem(zipCid, teacherTok, { code: 'B', name: 'Zip B' });
  await addMembers(zipCid, ['jan_kowalski', 'low_student']);
  putSubmit({ contestId: zipCid, problemId: zA.id, userId: studentId, status: 'OK', points: 60, code: 'print(60)', createdAt: hoursAgo(5) });
  putSubmit({ contestId: zipCid, problemId: zA.id, userId: studentId, status: 'WA', points: 10, code: 'print("later")', createdAt: hoursAgo(1) });
  putSubmit({ contestId: zipCid, problemId: zB.id, userId: studentId, status: 'WA', points: 0, code: 'print("bad")' });
  putSubmit({ contestId: zipCid, problemId: zB.id, userId: lowId, status: 'OK', points: 100, code: 'print("low")' });

  // ---- D6 rejudge filter ----
  const rj = await h.createContest(teacherTok, { name: 'Lane K rejudge', mode: 'ICPC' });
  rjCid = rj.id;
  rjA = await h.createProblem(rjCid, teacherTok, { code: 'A', name: 'Rejudge A' });
  const rjB = await h.createProblem(rjCid, teacherTok, { code: 'B', name: 'Rejudge B' });
  await addMembers(rjCid, ['jan_kowalski']);
  putSubmit({ contestId: rjCid, problemId: rjA.id, userId: studentId, status: 'WA', points: 0, code: 'print(1)' });
  putSubmit({ contestId: rjCid, problemId: rjB.id, userId: studentId, status: 'WA', points: 0, code: 'print(2)' });

  const empty = await h.createContest(teacherTok, { name: 'Lane K empty', mode: 'LABS' });
  emptyCid = empty.id;
  await h.createProblem(emptyCid, teacherTok, { code: 'A', name: 'Empty' });
  await addMembers(emptyCid, ['jan_kowalski']);
});

after(async () => {
  if (h) await h.close();
});

test('D2 problem override changes matrix, preview and CSV; audit row written', async () => {
  const beforeMatrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  assert.equal(beforeMatrix.status, 200);
  const beforeRow = beforeMatrix.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(beforeRow.total, 30);
  assert.equal(beforeRow.grade, 2);

  const set = await h.api(`/api/contests/${cid}/grade/overrides`, {
    method: 'POST',
    body: { userId: studentId, problemId: pA.id, points: 100, reason: 'jury decision' },
  }, teacherTok);
  assert.equal(set.status, 200);
  assert.equal(set.body.override.points, 100);
  assert.equal(set.body.override.reason, 'jury decision');
  assert.ok(set.body.override.id, 'override id returned');

  const matrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  const row = matrix.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(row.total, 50, 'overridden cell feeds the weighted total');
  assert.equal(row.grade, 3, 'contest scale applied after override');
  assert.equal(row.cells[pA.id].points, 100);
  assert.equal(row.cells[pA.id].overridden, true, 'cell carries the override badge');
  assert.equal(row.cells[pA.id].override.reason, 'jury decision');
  assert.equal(row.cells[pB.id].overridden, undefined);
  assert.equal(matrix.body.overrides.length, 1);
  assert.equal(matrix.body.overrides[0].login, 'jan_kowalski');
  assert.equal(matrix.body.overrides[0].byLogin, 'g_herman');

  const preview = await h.api(`/api/contests/${cid}/grade/preview`, { method: 'POST', body: { student: 'jan_kowalski' } }, teacherTok);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.student.total, 50, 'preview applies overrides');
  assert.equal(preview.body.student.grade, 3);
  assert.equal(preview.body.rows.find((r) => r.login === 'jan_kowalski').total, 50);

  const csv = await csvRows(cid);
  assert.match(csv.header, /^login,usos_id,first_name,last_name,email,total,pct,grade,A,B$/);
  const cols = csv.rows.find((l) => l.startsWith('jan_kowalski,')).split(',');
  assert.equal(Number(cols[5]), 50, 'CSV total == matrix total');
  assert.equal(Number(cols[7]), 3, 'CSV grade == matrix grade');
  assert.equal(Number(cols[8]), 100, 'CSV cell uses the override');
  assert.equal(Number(cols[9]), 0);

  const audit = h.store.query('audit', (a) => a.action === 'contest.grade.override' && String(a.target) === `contest:${cid}`);
  assert.equal(audit.length, 1, 'override written to the audit log');
  assert.equal(audit[0].meta.problemId, pA.id);
  assert.equal(audit[0].meta.points, 100);

  // Update in place: one row per (user, problem), not a growing list.
  const again = await h.api(`/api/contests/${cid}/grade/overrides`, {
    method: 'POST',
    body: { login: 'jan_kowalski', problemId: pA.id, points: 80, reason: 'revised' },
  }, teacherTok);
  assert.equal(again.status, 200);
  assert.equal(again.body.override.id, set.body.override.id, 'same row updated');
  const m2 = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  assert.equal(m2.body.overrides.length, 1);
  assert.equal(m2.body.rows.find((r) => r.login === 'jan_kowalski').total, 40);
});

test('D2 final-total override (problemId null) and delete', async () => {
  const set = await h.api(`/api/contests/${cid}/grade/overrides`, {
    method: 'POST',
    body: { userId: studentId, problemId: null, points: 75, reason: 'resit' },
  }, teacherTok);
  assert.equal(set.status, 200);
  assert.equal(set.body.override.problemId, null);

  const matrix = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  const row = matrix.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(row.total, 75, 'final total override wins');
  assert.equal(row.grade, 4);
  assert.equal(row.finalOverride.points, 75);
  assert.equal(row.overridden, true);

  const del = await h.api(`/api/contests/${cid}/grade/overrides/${set.body.override.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, set.body.override.id);
  const after = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  const row2 = after.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(row2.total, 40, 'problem override (80) survives removing the final row');
  assert.equal(row2.finalOverride, undefined);

  const gone = await h.api(`/api/contests/${cid}/grade/overrides/${set.body.override.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error.code, 'NO_OVERRIDE');

  // A student with no submits can still be overridden (cell was "—").
  const noSubmit = await h.api(`/api/contests/${cid}/grade/overrides`, {
    method: 'POST',
    body: { login: 'low_student', problemId: pB.id, points: 100, reason: 'oral exam' },
  }, teacherTok);
  assert.equal(noSubmit.status, 200);
  const lm = await h.api(`/api/contests/${cid}/grade/matrix`, {}, teacherTok);
  const low = lm.body.rows.find((r) => r.login === 'low_student');
  assert.equal(low.total, 50);
  assert.equal(low.attempts, 0);
  assert.equal(low.cells[pB.id].overridden, true);
  assert.equal(low.cells[pB.id].points, 100);
});

test('D2 negative: auth, points, member, problem, contest and delete paths', async () => {
  const body = { userId: studentId, problemId: pA.id, points: 10 };
  const anon = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error.code, 'AUTH');

  const student = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body }, studentTok);
  assert.equal(student.status, 403);
  assert.equal(student.body.error.code, 'FORBIDDEN');

  const missing = await h.api('/api/contests/999999/grade/overrides', { method: 'POST', body }, teacherTok);
  assert.equal(missing.status, 404);

  const tooHigh = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { ...body, points: 101 } }, teacherTok);
  assert.equal(tooHigh.status, 422);
  assert.equal(tooHigh.body.error.code, 'POINTS');

  const negative = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { ...body, points: -1 } }, teacherTok);
  assert.equal(negative.status, 422);

  const noPoints = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { userId: studentId, problemId: pA.id } }, teacherTok);
  assert.equal(noPoints.status, 422);
  assert.equal(noPoints.body.error.code, 'POINTS');

  const noUser = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { login: 'ghost_user', problemId: pA.id, points: 10 } }, teacherTok);
  assert.equal(noUser.status, 422);
  assert.equal(noUser.body.error.code, 'USER');

  // g_herman is an admin, not a member, so cannot receive a grade override.
  const teacher = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { userId: (await h.api('/api/me', {}, teacherTok)).body.id, problemId: pA.id, points: 10 } }, teacherTok);
  assert.equal(teacher.status, 422);
  assert.equal(teacher.body.error.code, 'USER');

  const otherProblem = await h.createProblem(emptyCid, teacherTok, { code: 'ZZ', name: 'Elsewhere' });
  const wrongProblem = await h.api(`/api/contests/${cid}/grade/overrides`, { method: 'POST', body: { userId: studentId, problemId: otherProblem.id, points: 10 } }, teacherTok);
  assert.equal(wrongProblem.status, 422);
  assert.equal(wrongProblem.body.error.code, 'PROBLEM');

  const studentDel = await h.api(`/api/contests/${cid}/grade/overrides/1`, { method: 'DELETE' }, studentTok);
  assert.equal(studentDel.status, 403);
  const anonDel = await h.api(`/api/contests/${cid}/grade/overrides/1`, { method: 'DELETE' });
  assert.equal(anonDel.status, 401);
});

test('D3 extension removes the late penalty in matrix, preview and CSV', async () => {
  const before = await h.api(`/api/contests/${extCid}/grade/matrix`, {}, teacherTok);
  const lateRow = before.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(lateRow.total, 40, 'late unit: 100 - 60');
  assert.equal(lateRow.cells[pExt.id].lateUnits, 1);
  assert.equal(lateRow.cells[pExt.id].late, true);

  const noExt = await h.api(`/api/contests/${extCid}/grade/preview`, { method: 'POST', body: { student: 'jan_kowalski' } }, teacherTok);
  assert.equal(noExt.body.student.total, 40);

  const ext = await h.api(`/api/contests/${extCid}/grade/extend-selected`, {
    method: 'POST',
    body: { userIds: [studentId], days: 3 },
  }, teacherTok);
  assert.equal(ext.status, 200);
  assert.equal(ext.body.updated, 1);
  assert.equal(ext.body.days, 3);

  const after = await h.api(`/api/contests/${extCid}/grade/matrix`, {}, teacherTok);
  const row = after.body.rows.find((r) => r.login === 'jan_kowalski');
  assert.equal(row.total, 100, 'extension clears the late unit');
  assert.equal(row.cells[pExt.id].late, false);
  assert.ok(row.cells[pExt.id].extension, 'cell reports the extension');
  assert.ok(row.extension, 'row reports the contest-wide extension');
  assert.equal(after.body.extensions.length, 1);
  assert.equal(after.body.extensions[0].login, 'jan_kowalski');
  assert.equal(after.body.extensions[0].byLogin, 'g_herman');

  const preview = await h.api(`/api/contests/${extCid}/grade/preview`, { method: 'POST', body: { student: 'jan_kowalski' } }, teacherTok);
  assert.equal(preview.body.student.total, 100, 'preview applies extensions');

  const csv = await csvRows(extCid);
  const cols = csv.rows.find((l) => l.startsWith('jan_kowalski,')).split(',');
  assert.equal(Number(cols[5]), 100, 'CSV applies extensions');

  const audit = h.store.query('audit', (a) => a.action === 'contest.grade.extend' && String(a.target) === `contest:${extCid}`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].meta.updated, 1);

  // Per-problem extension upserts the same (user, problem) row.
  const per = await h.api(`/api/contests/${extCid}/grade/extend-selected`, {
    method: 'POST',
    body: { userIds: [studentId], problemId: pExt.id, until: hoursAhead(48) },
  }, teacherTok);
  assert.equal(per.status, 200);
  assert.equal(per.body.updated, 1);
  const m2 = await h.api(`/api/contests/${extCid}/grade/matrix`, {}, teacherTok);
  assert.equal(m2.body.extensions.length, 1, 'still one row for the same user+problem');
  assert.equal(m2.body.extensions[0].problemId, pExt.id);
});

test('D3 negative: unknown member, empty selection, bad days/until, auth', async () => {
  const empty = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [] } }, teacherTok);
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error.code, 'USER');

  const teacherId = (await h.api('/api/me', {}, teacherTok)).body.id;
  const notMember = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [teacherId], days: 1 } }, teacherTok);
  assert.equal(notMember.status, 422);
  assert.equal(notMember.body.error.code, 'NOT_MEMBER');

  const ghost = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: ['ghost_user'], days: 1 } }, teacherTok);
  assert.equal(ghost.status, 422);
  assert.equal(ghost.body.error.code, 'USER');

  const zeroDays = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [studentId], days: 0 } }, teacherTok);
  assert.equal(zeroDays.status, 422);
  assert.equal(zeroDays.body.error.code, 'DAYS');

  const badUntil = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [studentId], until: 'not-a-date' } }, teacherTok);
  assert.equal(badUntil.status, 422);
  assert.equal(badUntil.body.error.code, 'UNTIL');

  const anon = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [studentId], days: 1 } });
  assert.equal(anon.status, 401);
  const student = await h.api(`/api/contests/${extCid}/grade/extend-selected`, { method: 'POST', body: { userIds: [studentId], days: 1 } }, studentTok);
  assert.equal(student.status, 403);
  const missing = await h.api('/api/contests/999999/grade/extend-selected', { method: 'POST', body: { userIds: [studentId], days: 1 } }, teacherTok);
  assert.equal(missing.status, 404);
});

test('D4 release endpoint, persistence and matrix/export unaffected', async () => {
  const anon = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { released: true } });
  assert.equal(anon.status, 401);
  const student = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { released: true } }, studentTok);
  assert.equal(student.status, 403);
  const badAt = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { at: 'not-a-date' } }, teacherTok);
  assert.equal(badAt.status, 422);
  assert.equal(badAt.body.error.code, 'AT');
  const missing = await h.api('/api/contests/999999/grade/release', { method: 'POST', body: { released: true } }, teacherTok);
  assert.equal(missing.status, 404);

  const on = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { released: true } }, teacherTok);
  assert.equal(on.status, 200);
  assert.equal(on.body.released, true);
  assert.ok(on.body.at, 'release timestamp stored');

  const contest = await h.api(`/api/contests/${extCid}`, {}, teacherTok);
  assert.equal(contest.body.settings.gradeReleased, true);
  assert.ok(contest.body.settings.gradeReleaseAt);

  const matrix = await h.api(`/api/contests/${extCid}/grade/matrix`, {}, teacherTok);
  assert.equal(matrix.status, 200, 'admin matrix unaffected by release');
  assert.equal(matrix.body.release.released, true);
  const csv = await h.api(`/api/contests/${extCid}/grade/export.csv`, {}, teacherTok);
  assert.equal(csv.status, 200, 'admin export unaffected by release');

  // Scheduled release stays closed until the timestamp; a past timestamp releases now.
  const scheduled = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { at: hoursAhead(48) } }, teacherTok);
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.body.released, false);
  assert.ok(new Date(scheduled.body.at).getTime() > Date.now());

  const past = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { at: hoursAgo(1) } }, teacherTok);
  assert.equal(past.status, 200);
  assert.equal(past.body.released, true, 'a past timestamp publishes immediately');

  const off = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { released: false } }, teacherTok);
  assert.equal(off.status, 200);
  assert.equal(off.body.released, false);
  assert.equal(off.body.at, null);

  const audit = h.store.query('audit', (a) => a.action === 'contest.grade.release' && String(a.target) === `contest:${extCid}`);
  assert.equal(audit.length, 4);
});

test('D4 student /grade release gate (activates when the contests.js handoff lands)', async (t) => {
  // HANDOFF: the student /grade route lives in routes/contests.js, outside this
  // lane's file ownership. While the gate is absent the test skips; once the route
  // mentions NOT_RELEASED it asserts the full contract, so a broken wiring fails.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../apps/api/src/routes/contests.js'), 'utf8');
  if (!source.includes('NOT_RELEASED')) {
    t.skip('handoff pending: routes/contests.js does not gate student /grade on release yet');
    return;
  }
  const pre = await h.api(`/api/contests/${extCid}/grade`, {}, studentTok);
  assert.equal(pre.status, 403);
  assert.equal(pre.body.error.code, 'NOT_RELEASED');
  const open = await h.api(`/api/contests/${extCid}/grade/release`, { method: 'POST', body: { released: true } }, teacherTok);
  assert.equal(open.status, 200);
  const post = await h.api(`/api/contests/${extCid}/grade`, {}, studentTok);
  assert.equal(post.status, 200, 'released grades are readable by the student');
});

test('D6 codes.zip contains every member best/latest code per problem', async () => {
  const res = await fetch(`${h.base}/api/contests/${zipCid}/grade/codes.zip`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/zip/);
  assert.match(String(res.headers.get('content-disposition')), /codes-contest-/);
  const entries = zipEntries(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(entries.map((e) => e.name).sort(), [
    'jan_kowalski/A.py',
    'jan_kowalski/B.py',
    'low_student/B.py',
  ]);
  assert.ok(entries.every((e) => e.method === 0), 'store-only ZIP');
  assert.equal(entries.find((e) => e.name === 'jan_kowalski/A.py').data, 'print(60)', 'accepted higher-point submit wins over the later WA');
  assert.equal(entries.find((e) => e.name === 'jan_kowalski/B.py').data, 'print("bad")');
  assert.equal(entries.find((e) => e.name === 'low_student/B.py').data, 'print("low")');

  const audit = h.store.query('audit', (a) => a.action === 'contest.grade.codes-zip');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].meta.files, 3);

  const anon = await h.api(`/api/contests/${zipCid}/grade/codes.zip`);
  assert.equal(anon.status, 401);
  const student = await h.api(`/api/contests/${zipCid}/grade/codes.zip`, {}, studentTok);
  assert.equal(student.status, 403);
  const empty = await h.api(`/api/contests/${emptyCid}/grade/codes.zip`, {}, teacherTok);
  assert.equal(empty.status, 404);
  assert.equal(empty.body.error.code, 'NO_CODES');
  const missing = await h.api('/api/contests/999999/grade/codes.zip', {}, teacherTok);
  assert.equal(missing.status, 404);
});

test('D6 bulk rejudge requeues only the filtered submits', async () => {
  const bBefore = h.store.query('submits', (s) => String(s.contestId) === String(rjCid) && s.status === 'WA');
  const target = bBefore.find((s) => String(s.problemId) === String(rjA.id));
  assert.ok(target, 'problem A submit found');
  const other = bBefore.find((s) => String(s.id) !== String(target.id));
  assert.ok(other, 'problem B submit found');
  const otherJudgedAt = other.judgedAt;

  const empty = await h.api(`/api/contests/${rjCid}/grade/rejudge`, { method: 'POST', body: {} }, teacherTok);
  assert.equal(empty.status, 422);
  assert.equal(empty.body.error.code, 'FILTER');

  const badProblem = await h.api(`/api/contests/${rjCid}/grade/rejudge`, { method: 'POST', body: { filter: { problem: 'ZZZ' } } }, teacherTok);
  assert.equal(badProblem.status, 422);
  assert.equal(badProblem.body.error.code, 'PROBLEM');

  const badUser = await h.api(`/api/contests/${rjCid}/grade/rejudge`, { method: 'POST', body: { filter: { userIds: ['ghost_user'] } } }, teacherTok);
  assert.equal(badUser.status, 422);
  assert.equal(badUser.body.error.code, 'USER');

  const anon = await h.api(`/api/contests/${rjCid}/grade/rejudge`, { method: 'POST', body: { filter: { verdict: 'WA' } } });
  assert.equal(anon.status, 401);
  const student = await h.api(`/api/contests/${rjCid}/grade/rejudge`, { method: 'POST', body: { filter: { verdict: 'WA' } } }, studentTok);
  assert.equal(student.status, 403);

  const r = await h.api(`/api/contests/${rjCid}/grade/rejudge`, {
    method: 'POST',
    body: { filter: { problem: 'A', verdict: 'WA', userIds: [studentId] } },
  }, teacherTok);
  assert.equal(r.status, 200);
  assert.equal(r.body.requeued, 1, 'only problem A for that user');
  assert.deepEqual(r.body.submitIds, [target.id]);

  const untouched = h.store.get('submits', other.id);
  assert.equal(untouched.status, 'WA', 'filtered-out submit keeps its verdict');
  assert.equal(untouched.judgedAt, otherJudgedAt, 'filtered-out submit keeps its judgedAt');

  const judged = await h.waitJudged(target.id, teacherTok);
  assert.ok(judged, 'requeued submit is judged again');
  assert.ok(!['QUE', 'CMP', 'TST'].includes(judged.status));
  assert.ok(judged.judgedAt, 'judgedAt refreshed');

  const audit = h.store.query('audit', (a) => a.action === 'contest.grade.rejudge');
  assert.equal(audit.length, 1, 'only the successful call is audited; rejects return before audit');
  assert.equal(audit[0].meta.requeued, 1);
});
