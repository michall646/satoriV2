// Security & authz: manager gates, reject flow, verdict visibility, sample-run containment,
// login throttle, legacy-hash migration. Isolated DATA_DIR + port. AAA per test.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-sec-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3132';
const BASE = 'http://localhost:3132';

let server;
let studentTok;
let teacherTok;
let studentId;
let teacherId;
const playgroundId = 251519;
let playgroundProblemId;
let uziProblemId;

async function api(p, opts = {}, tok = null) {
  const res = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
const json = (x) => ({ body: JSON.stringify(x) });

async function loginAs(login, password) {
  const r = await api('/api/auth/token', { method: 'POST', ...json({ login, password }) });
  assert.equal(r.status, 200, `login ${login}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function waitJudged(id, tok) {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const d = await api(`/api/submits/${id}`, {}, tok);
    if (!['QUE', 'CMP', 'TST'].includes(d.body.status)) return d.body;
  }
  return null;
}

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3132, r));
  studentTok = await loginAs('jan_kowalski', 'student123');
  teacherTok = await loginAs('g_herman', 'teacher123');
  studentId = (await api('/api/me', {}, studentTok)).body.id;
  teacherId = (await api('/api/me', {}, teacherTok)).body.id;
  playgroundProblemId = (await api(`/api/contests/${playgroundId}/problems`)).body.items[0].id;
  uziProblemId = (await api('/api/contests/10193118/problems', {}, teacherTok)).body.items[0].id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('test data is visible to admins only (negative+positive)', async () => {
  const anon = await api(`/api/problems/${playgroundProblemId}/tests`);
  assert.equal(anon.status, 401);
  const student = await api(`/api/problems/${playgroundProblemId}/tests`, {}, studentTok);
  assert.equal(student.status, 403);
  const teacher = await api(`/api/problems/${playgroundProblemId}/tests`, {}, teacherTok);
  assert.equal(teacher.status, 200);
  assert.ok(Array.isArray(teacher.body.items));
});

test('problem mutations gated for students (negative+positive)', async () => {
  const patch = await api(`/api/problems/${playgroundProblemId}`, { method: 'PATCH', ...json({ difficulty: 2 }) }, studentTok);
  assert.equal(patch.status, 403);
  const rejudge = await api(`/api/problems/${playgroundProblemId}/rejudge`, { method: 'POST', ...json({}) }, studentTok);
  assert.equal(rejudge.status, 403);
  const addTest = await api(`/api/problems/${playgroundProblemId}/tests`, { method: 'POST', ...json({ case: { groupId: 1, input: '1', expected: '1' } }) }, studentTok);
  assert.equal(addTest.status, 403);
  const clone = await api(`/api/problems/${playgroundProblemId}/clone`, { method: 'POST', ...json({ contestId: playgroundId }) }, studentTok);
  assert.equal(clone.status, 403);
  const heatmap = await api(`/api/problems/${playgroundProblemId}/heatmap`, {}, studentTok);
  assert.equal(heatmap.status, 403);
  const ok = await api(`/api/problems/${playgroundProblemId}`, { method: 'PATCH', ...json({ difficulty: 3 }) }, teacherTok);
  assert.equal(ok.status, 200);
});

test('contest admin endpoints gated (negative+positive)', async () => {
  const csv = await api(`/api/contests/${playgroundId}/members/csv`, { method: 'POST', ...json({ csv: 'jan_kowalski' }) }, studentTok);
  assert.equal(csv.status, 403);
  const news = await api(`/api/contests/${playgroundId}/news`, { method: 'POST', ...json({ title: 'x', bodyMd: 'y' }) }, studentTok);
  assert.equal(news.status, 403);
  const dup = await api(`/api/contests/${playgroundId}/duplicate`, { method: 'POST', ...json({}) }, studentTok);
  assert.equal(dup.status, 403);
  const clar = await api(`/api/contests/${playgroundId}/clarifications`, { method: 'POST', ...json({ text: 'Q?' }) }, studentTok);
  assert.equal(clar.status, 201);
  const csvOk = await api(`/api/contests/${playgroundId}/members/csv`, { method: 'POST', ...json({ csv: 'ghost_user_x' }) }, teacherTok);
  assert.equal(csvOk.status, 200);
  assert.deepEqual(csvOk.body.unknown, ['ghost_user_x']);
});

test('reject removes pending only; approveAllByFilter honors q (regression)', async () => {
  const c = await api('/api/contests', { method: 'POST', ...json({ name: 'Reject Probe', mode: 'ICPC' }) }, teacherTok);
  assert.equal(c.status, 201);
  const cid = c.body.id;

  const loginA = `rej_${Date.now().toString(36)}`;
  await api('/api/auth/register', { method: 'POST', ...json({ login: loginA, email: `${loginA}@uj.edu.pl`, password: 'secret12' }) });
  const tokA = await loginAs(loginA, 'secret12');
  const idA = (await api('/api/me', {}, tokA)).body.id;
  const apply = await api(`/api/contests/${cid}/apply`, { method: 'POST', ...json({}) }, tokA);
  assert.equal(apply.body.state, 'pending');

  const rej = await api(`/api/contests/${cid}/members/approve`, { method: 'POST', ...json({ userIds: [idA], approve: false }) }, teacherTok);
  assert.equal(rej.status, 200);
  assert.equal(rej.body.rejected, 1);
  const afterReject = await api(`/api/contests/${cid}/members`, {}, teacherTok);
  assert.equal(afterReject.body.members.length, 0, 'rejected user must not join members');
  assert.equal(afterReject.body.pending.length, 0, 'rejected user leaves pending');

  const loginB = `rej2_${Date.now().toString(36)}`;
  await api('/api/auth/register', { method: 'POST', ...json({ login: loginB, email: `${loginB}@uj.edu.pl`, password: 'secret12' }) });
  const tokB = await loginAs(loginB, 'secret12');
  await api(`/api/contests/${cid}/apply`, { method: 'POST', ...json({}) }, tokB);
  await api(`/api/contests/${cid}/apply`, { method: 'POST', ...json({}) }, tokA);
  const all = await api(`/api/contests/${cid}/members/approve`, { method: 'POST', ...json({ approveAllByFilter: true, q: loginB }) }, teacherTok);
  assert.equal(all.status, 200);
  const final = await api(`/api/contests/${cid}/members`, {}, teacherTok);
  const logins = final.body.members.map((m) => m.login);
  assert.ok(logins.includes(loginB), 'filtered applicant approved');
  assert.ok(!logins.includes(loginA), 'unfiltered applicant stays pending');
  assert.equal(final.body.pending.length, 1);
});

test('grades private: anon 401, other-user 403, self/admin 200', async () => {
  const anon = await api(`/api/contests/${playgroundId}/grade`);
  assert.equal(anon.status, 401);
  const other = await api(`/api/contests/${playgroundId}/grade?user=${teacherId}`, {}, studentTok);
  assert.equal(other.status, 403);
  const self = await api(`/api/contests/${playgroundId}/grade`, {}, studentTok);
  assert.equal(self.status, 200);
  const admin = await api(`/api/contests/${playgroundId}/grade?user=${studentId}`, {}, teacherTok);
  assert.equal(admin.status, 200);
});

test('submit: owner sees code + full per-test; others see neither', async () => {
  const code = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int a,b;if(!(cin>>a>>b))return 0;cout<<a+b;}';
  const s = await api('/api/submits', { method: 'POST', ...json({ contestId: playgroundId, problemId: playgroundProblemId, filename: 'solution.cpp', code }) }, studentTok);
  assert.equal(s.status, 201);
  const judged = await waitJudged(s.body.id, studentTok);
  assert.ok(judged, 'submit judged in time');
  assert.equal(typeof judged.code, 'string', 'owner keeps code');
  assert.ok(Array.isArray(judged.perTestFull), 'owner keeps full per-test (vis=all)');

  const anon = await api(`/api/submits/${s.body.id}`);
  assert.equal(anon.status, 200);
  assert.ok(!('code' in anon.body), 'anon response has no code');
  assert.ok(!('perTestFull' in anon.body), 'anon response has no perTestFull');

  const list = await api(`/api/submits?problem=${playgroundProblemId}`);
  const first = list.body.items[0];
  assert.equal(first.id, s.body.id);
  assert.ok(!('code' in first), 'list strips code');
  assert.ok(!('perTestFull' in first), 'list strips perTestFull');
});

test('sample-run judges samples only; no full per-test; no notification', async () => {
  const s = await api('/api/submits/sample-run', { method: 'POST', ...json({ problemId: playgroundProblemId, filename: 'solution.cpp', code: 'int main(){}' }) }, studentTok);
  assert.equal(s.status, 201);
  const judged = await waitJudged(s.body.id, studentTok);
  assert.ok(judged, 'sample-run judged in time');
  assert.equal(judged.perTest.length, 1, 'seed: 1 sample, 2 hidden tests — only samples run');
  assert.ok(judged.perTestFull == null, 'no full per-test data for sample run');
  const notifications = await api('/api/notifications', {}, studentTok);
  const sampleNotes = notifications.body.items.filter((n) => n.payload && n.payload.submitId === s.body.id);
  assert.equal(sampleNotes.length, 0, 'sample run must not notify');
});

test('sample-run disabled by contest setting (negative)', async () => {
  const r = await api('/api/submits/sample-run', { method: 'POST', ...json({ problemId: uziProblemId, filename: 'solution.cpp', code: 'int main(){}' }) }, teacherTok);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SAMPLE_OFF');
});

test('login throttled after 10 failures (negative)', async () => {
  const login = `thr_${Date.now().toString(36)}`;
  for (let i = 0; i < 10; i++) {
    const r = await api('/api/auth/token', { method: 'POST', ...json({ login, password: 'wrong' }) });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await api('/api/auth/token', { method: 'POST', ...json({ login, password: 'wrong' }) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'THROTTLE');
});

test('legacy sha256 hash still logs in, then upgrades to scrypt (positive)', async () => {
  const { store } = require('../apps/api/src/lib/store');
  const salt = 'legacysalt01';
  const legacy = `sha256$${salt}$${nodeCrypto.createHash('sha256').update(`${salt}:legacy123`).digest('hex')}`;
  const u = store.insert('users', { login: 'legacy_probe', firstName: 'L', lastName: 'P', email: 'l@uj.edu.pl', pass: legacy, rolesGlobal: ['student'], createdAt: new Date().toISOString() });
  const r = await api('/api/auth/token', { method: 'POST', ...json({ login: 'legacy_probe', password: 'legacy123' }) });
  assert.equal(r.status, 200);
  const after = store.get('users', u.id);
  assert.ok(String(after.pass).startsWith('scrypt$'), 'hash upgraded to scrypt on login');
});
