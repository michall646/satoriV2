// Tests for ranking replay: GET /api/contests/:id/ranking?at=... and GET /api/contests/:id/ranking/replay
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');

let h;
let teacher;
let student;
let stranger;
let contest;
let probA;
let probB;

before(async () => {
  h = await startServer({ prefix: 'satori-replay-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  student = await h.loginAs('jan_kowalski', 'student123');
  const reg = await h.api('/api/auth/register', {
    method: 'POST',
    ...json({ login: 'stranger_replay', email: 'stranger_replay@uj.edu.pl', password: 'secret12' }),
  });
  stranger = await h.loginAs('stranger_replay', 'secret12');

  // Create contest with freeze active now
  contest = await h.createContest(teacher, {
    name: 'Replay Contest',
    mode: 'ICPC',
    startAt: '2026-11-01T10:00:00Z',
    endAt: '2026-12-01T15:00:00Z',
    freezeAt: '2026-11-01T14:00:00Z',
  });

  // Add student as member
  const me = await h.api('/api/me', {}, student);
  await h.api(`/api/contests/${contest.id}/members`, {
    method: 'POST', ...json({ login: me.body.login }),
  }, teacher);

  // Add problems
  const p1 = await h.api(`/api/contests/${contest.id}/problems`, {
    method: 'POST', ...json({ code: 'A', name: 'Problem A' }),
  }, teacher);
  probA = p1.body;

  const p2 = await h.api(`/api/contests/${contest.id}/problems`, {
    method: 'POST', ...json({ code: 'B', name: 'Problem B' }),
  }, teacher);
  probB = p2.body;

  // Insert mock submits into the contest
  const { store } = require('../apps/api/src/lib/store');
  store.insert('submits', {
    contestId: contest.id,
    problemId: probA.id,
    userId: me.body.id,
    status: 'OK',
    points: 100,
    createdAt: '2026-11-01T11:00:00Z',
  });

  store.insert('submits', {
    contestId: contest.id,
    problemId: probB.id,
    userId: me.body.id,
    status: 'OK',
    points: 100,
    createdAt: '2026-11-01T14:30:00Z', // post-freeze!
  });
});

after(async () => {
  if (h) await h.close();
});

test('ranking?at= returns snapshot at specified time before second submit', async () => {
  const at1 = '2026-11-01T12:00:00Z';
  const res = await h.api(`/api/contests/${contest.id}/ranking?at=${encodeURIComponent(at1)}`, {}, student);
  assert.equal(res.status, 200);
  assert.equal(new Date(res.body.replayAt).getTime(), new Date(at1).getTime());

  const studentRow = (res.body.rows || []).find((r) => r.name === 'jan_kowalski');
  assert.ok(studentRow, 'student row exists');
  assert.equal(studentRow.solved, 1, 'only first submit counted before 12:00');
  assert.equal(studentRow.cells[probA.id].text, '1 (1:00)');
  assert.equal(studentRow.cells[probB.id].text, '-');
});

test('ranking/replay returns timeline, problems, contestants and submission events', async () => {
  const res = await h.api(`/api/contests/${contest.id}/ranking/replay`, {}, student);
  assert.equal(res.status, 200);
  assert.equal(new Date(res.body.startAt).getTime(), new Date('2026-11-01T10:00:00Z').getTime());
  assert.equal(new Date(res.body.endAt).getTime(), new Date('2026-12-01T15:00:00Z').getTime());
  assert.equal(new Date(res.body.freezeAt).getTime(), new Date('2026-11-01T14:00:00Z').getTime());
  assert.ok(Array.isArray(res.body.events));
  assert.equal(res.body.events.length, 2);

  const e1 = res.body.events[0];
  assert.equal(e1.problemId, probA.id);
  assert.equal(e1.status, 'OK');
  assert.equal(e1.frozen, false);

  // During freeze, student cannot see post-freeze verdict
  const e2 = res.body.events[1];
  assert.equal(e2.problemId, probB.id);
  assert.equal(e2.status, '?');
  assert.equal(e2.frozen, true);
});

test('ranking/replay with unfrozen=1 reveals real verdicts', async () => {
  const res = await h.api(`/api/contests/${contest.id}/ranking/replay?unfrozen=1`, {}, student);
  assert.equal(res.status, 200);
  const e2 = res.body.events[1];
  assert.equal(e2.problemId, probB.id);
  assert.equal(e2.status, 'OK');
});

test('non-member gets 403 on ranking/replay', async () => {
  const res = await h.api(`/api/contests/${contest.id}/ranking/replay`, {}, stranger);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'NOT_MEMBER');
});
