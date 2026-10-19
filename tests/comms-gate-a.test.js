// Lane F — comms & exam: integrity helpers, appeals, violations detail, exam shape.
// Uses tests/helpers.js (dynamic port, isolated DATA_DIR). Do not hardcode ports.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');
const { similarityGraph, timelineFlags } = require('../apps/api/src/lib/integrity');

let h;
let teacherTok;
let studentTok;
let otherTok;
let studentId;
let contestId;
let problemId;

before(async () => {
  h = await startServer({ prefix: 'satori-lane-f-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');
  studentId = (await h.api('/api/me', {}, studentTok)).body.id;
  const login = `lane_f_other_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', { method: 'POST', ...json({ login, email: `${login}@uj.edu.pl`, password: 'secret12' }) });
  assert.equal(reg.status, 201, `register other: ${JSON.stringify(reg.body)}`);
  otherTok = await h.loginAs(login, 'secret12');

  const c = await h.createContest(teacherTok, {
    name: 'Lane F Exam',
    mode: 'EXAM',
    startAt: '2020-01-01T00:00:00Z',
    endAt: '2030-01-01T00:00:00Z',
  });
  contestId = c.id;
  const p = await h.createProblem(contestId, teacherTok, { code: 'A', name: 'Exam A' });
  problemId = p.id;
  const added = await h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login: 'jan_kowalski' }) }, teacherTok);
  assert.equal(added.status, 201, JSON.stringify(added.body));
});

after(async () => {
  if (h) await h.close();
});

test('F7: similarity compares only the same problem and excludes the same user', () => {
  const base = 'int main(){ int alpha = 1; return alpha; }';
  const renamed = 'int main(){ int beta = 1; return beta; }';
  const subs = [
    { id: 1, userId: 1, problemId: 10, code: base },
    { id: 2, userId: 2, problemId: 10, code: renamed },
    { id: 3, userId: 1, problemId: 10, code: base },
    { id: 4, userId: 3, problemId: 11, code: base },
  ];
  const pairs = similarityGraph(subs);
  assert.ok(pairs.length > 0, 'renamed identifiers still match');
  assert.ok(pairs.some((p) => String(p.a) === '1' && String(p.b) === '2'), 'same problem, different users');
  assert.ok(!pairs.some((p) => [p.a, p.b].map(String).sort().join('-') === '1-3'), 'same user excluded');
  assert.ok(!pairs.some((p) => String(p.a) === '4' || String(p.b) === '4'), 'other problem excluded');
  for (const p of pairs) assert.equal(String(p.problemId), '10', 'pair carries the problem id');
});

test('F7: timeline flags are per problem and carry problemId', () => {
  const t0 = Date.now();
  const at = (ms) => new Date(t0 + ms).toISOString();
  const flags = timelineFlags([
    { id: 1, userId: 1, problemId: 10, createdAt: at(0) },
    { id: 5, userId: 1, problemId: 10, createdAt: at(1000) },
    { id: 2, userId: 3, problemId: 11, createdAt: at(1500) },
    { id: 3, userId: 2, problemId: 10, createdAt: at(2000) },
  ]);
  assert.ok(flags.some((f) => String(f.submitId) === '3' && String(f.problemId) === '10'), 'same problem, different users flagged');
  assert.ok(!flags.some((f) => String(f.submitId) === '2'), 'different problem is never compared');
  assert.ok(!flags.some((f) => String(f.submitId) === '5'), 'same user is not flagged');
});

test('F3: exam settings have the canonical shape; member reads, admin writes, non-member 403', async () => {
  const shape = ['fullscreen', 'ipAllow', 'pasteBlock', 'shuffle', 'timeWindow'];
  const read = await h.api(`/api/contests/${contestId}/exam`, {}, studentTok);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(Object.keys(read.body.settings).sort(), shape);
  assert.equal(read.body.exam, true, 'EXAM mode is flagged for the client guard');
  assert.ok('endAt' in read.body, 'endAt is exposed for the exam timer/auto-submit hook');

  const deniedPatch = await h.api(`/api/contests/${contestId}/exam`, { method: 'PATCH', ...json({ settings: { pasteBlock: true } }) }, studentTok);
  assert.equal(deniedPatch.status, 403);

  const nonMemberRead = await h.api(`/api/contests/${contestId}/exam`, {}, otherTok);
  assert.equal(nonMemberRead.status, 403);

  const patch = await h.api(`/api/contests/${contestId}/exam`, {
    method: 'PATCH',
    ...json({ settings: { fullscreen: true, pasteBlock: true, shuffle: true, ipAllow: '127.0.0.1', timeWindow: '09:00-11:00', evil: 'x' } }),
  }, teacherTok);
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.deepEqual(Object.keys(patch.body.settings).sort(), shape, 'unknown keys are dropped');
  assert.equal(patch.body.settings.fullscreen, true);
  assert.equal(patch.body.settings.pasteBlock, true);
  assert.equal(patch.body.settings.shuffle, true);
  assert.equal(patch.body.settings.ipAllow, '127.0.0.1');
  assert.equal(patch.body.settings.timeWindow, '09:00-11:00');

  const after = await h.api(`/api/contests/${contestId}/exam`, {}, studentTok);
  assert.equal(after.body.settings.pasteBlock, true);
});

test('F5: violations detail is admin-only and includes who/type/detail/at', async () => {
  const post = await h.api(`/api/contests/${contestId}/exam/violations`, {
    method: 'POST', ...json({ type: 'paste', detail: 'target=textarea' }),
  }, studentTok);
  assert.equal(post.status, 201, JSON.stringify(post.body));

  const nonMemberPost = await h.api(`/api/contests/${contestId}/exam/violations`, {
    method: 'POST', ...json({ type: 'paste', detail: 'target=textarea' }),
  }, otherTok);
  assert.equal(nonMemberPost.status, 403);

  const anon = await h.api(`/api/contests/${contestId}/exam/violations`);
  assert.equal(anon.status, 401);

  const denied = await h.api(`/api/contests/${contestId}/exam/violations`, {}, studentTok);
  assert.equal(denied.status, 403, 'students cannot read the violation log');

  const list = await h.api(`/api/contests/${contestId}/exam/violations`, {}, teacherTok);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.count, list.body.items.length);
  const row = list.body.items.find((v) => v.type === 'paste' && v.detail === 'target=textarea');
  assert.ok(row, 'violation row returned');
  assert.equal(row.who, 'jan_kowalski');
  assert.equal(row.userId, studentId);
  assert.ok(row.at, 'timestamp present');
  assert.equal(typeof row.ip, 'string', 'ip captured for the jury');
});

test('F6: appeal create/list own/admin resolve, ownership and status gates', async () => {
  const now = new Date().toISOString();
  const failed = h.store.insert('submits', {
    contestId, problemId, userId: studentId, lang: 'C++17', filename: 'a.cpp', status: 'WA',
    points: 0, perTest: [], sampleOnly: false, createdAt: now, judgedAt: now,
  });
  const ok = h.store.insert('submits', {
    contestId, problemId, userId: studentId, lang: 'C++17', filename: 'b.cpp', status: 'OK',
    points: 100, perTest: [], sampleOnly: false, createdAt: now, judgedAt: now,
  });

  const created = await h.api(`/api/contests/${contestId}/integrity/appeals`, {
    method: 'POST', ...json({ submitId: failed.id, text: 'Please re-check test 3.' }),
  }, studentTok);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'open');
  assert.equal(String(created.body.submitId), String(failed.id));

  const duplicate = await h.api(`/api/contests/${contestId}/integrity/appeals`, {
    method: 'POST', ...json({ submitId: failed.id, text: 'Again.' }),
  }, studentTok);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'APPEAL_EXISTS');

  const notMine = await h.api(`/api/contests/${contestId}/integrity/appeals`, {
    method: 'POST', ...json({ submitId: failed.id, text: 'Teacher appeal.' }),
  }, teacherTok);
  assert.equal(notMine.status, 403);
  assert.equal(notMine.body.error.code, 'NOT_OWNER');

  const notAppealable = await h.api(`/api/contests/${contestId}/integrity/appeals`, {
    method: 'POST', ...json({ submitId: ok.id, text: 'It passed.' }),
  }, studentTok);
  assert.equal(notAppealable.status, 422);
  assert.equal(notAppealable.body.error.code, 'NOT_APPEALABLE');

  const nonMember = await h.api(`/api/contests/${contestId}/integrity/appeals`, {
    method: 'POST', ...json({ submitId: failed.id, text: 'Outside.' }),
  }, otherTok);
  assert.equal(nonMember.status, 403);
  assert.equal(nonMember.body.error.code, 'NOT_MEMBER');

  const mine = await h.api(`/api/contests/${contestId}/integrity/appeals/mine`, {}, studentTok);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.ok(mine.body.items.some((a) => String(a.id) === String(created.body.id) && a.status === 'open'));
  assert.ok(mine.body.items.every((a) => a.submitId != null), 'mine only');

  const mineDenied = await h.api(`/api/contests/${contestId}/integrity/appeals/mine`, {}, otherTok);
  assert.equal(mineDenied.status, 403);

  const adminListDenied = await h.api(`/api/contests/${contestId}/integrity/appeals`, {}, studentTok);
  assert.equal(adminListDenied.status, 403);

  const adminList = await h.api(`/api/contests/${contestId}/integrity/appeals`, {}, teacherTok);
  assert.equal(adminList.status, 200);
  assert.ok(adminList.body.items.some((a) => String(a.id) === String(created.body.id) && a.student === 'jan_kowalski'));

  const resolveDenied = await h.api(`/api/contests/${contestId}/integrity/appeals/${created.body.id}`, {
    method: 'POST', ...json({ verdict: 'upheld' }),
  }, studentTok);
  assert.equal(resolveDenied.status, 403);

  const resolve = await h.api(`/api/contests/${contestId}/integrity/appeals/${created.body.id}`, {
    method: 'POST', ...json({ verdict: 'upheld' }),
  }, teacherTok);
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.verdict, 'upheld');
  assert.equal(resolve.body.item.status, 'resolved');

  const mineAfter = await h.api(`/api/contests/${contestId}/integrity/appeals/mine`, {}, studentTok);
  const row = mineAfter.body.items.find((a) => String(a.id) === String(created.body.id));
  assert.equal(row.status, 'resolved');
  assert.equal(row.verdict, 'upheld');
  assert.ok(row.resolvedAt, 'resolution timestamp');

  const notifications = await h.api('/api/notifications', {}, studentTok);
  assert.ok(notifications.body.items.some((n) => n.type === 'appeal.resolved'), 'student notified');
});
