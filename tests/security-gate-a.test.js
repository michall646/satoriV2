// Lane A — Gate A security & access matrix.
// Uses tests/helpers.js (dynamic port, isolated DATA_DIR). Do not hardcode ports.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, json } = require('./helpers');

process.env.SATORI_LIVE_INTERVAL_MS = '80';

let h;
let adminTok;
let teacherTok;
let studentTok;
let otherTok;
let adminId;
let teacherId;
let studentId;
let otherId;
let otherLogin;
let firstSubmitId;

const playgroundId = 251519;
let playgroundProblemId;

async function patchContest(id, body) {
  return h.api(`/api/contests/${id}`, { method: 'PATCH', ...json(body) }, teacherTok);
}
async function addMember(contestId, login, role = 'participant') {
  return h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login, role }) }, teacherTok);
}
async function makeProblem(contestId, code, body = {}) {
  const p = await h.createProblem(contestId, teacherTok, { code, name: `Problem ${code}`, visibility: 'visible', ...body });
  const g = await h.addGroup(p.id, teacherTok);
  await h.addCase(p.id, teacherTok, { groupId: g.id, input: '1\n', expected: '1\n' });
  return { p, g };
}

before(async () => {
  h = await startServer({ prefix: 'satori-lane-a-' });
  adminTok = await h.loginAs('admin', 'admin123');
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');
  adminId = (await h.api('/api/me', {}, adminTok)).body.id;
  teacherId = (await h.api('/api/me', {}, teacherTok)).body.id;
  studentId = (await h.api('/api/me', {}, studentTok)).body.id;
  otherLogin = `lane_a_other_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', { method: 'POST', ...json({ login: otherLogin, email: `${otherLogin}@uj.edu.pl`, password: 'secret12' }) });
  assert.equal(reg.status, 201, `register other: ${JSON.stringify(reg.body)}`);
  otherTok = await h.loginAs(otherLogin, 'secret12');
  otherId = (await h.api('/api/me', {}, otherTok)).body.id;
  const pl = await h.api(`/api/contests/${playgroundId}/problems`);
  playgroundProblemId = pl.body.items[0].id;
});

after(async () => {
  if (h) await h.close();
});

test('A1: non-owner sees no code/perTest/compileLog/expected; owner keeps full data', async () => {
  const s = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: playgroundId, problemId: playgroundProblemId, filename: 'solution.cpp', code: 'int main(){ return 0; }' }),
  }, studentTok);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  firstSubmitId = s.body.id;
  const judged = await h.waitJudged(s.body.id, studentTok);
  assert.ok(judged, 'submission judged');

  const owner = await h.api(`/api/submits/${s.body.id}`, {}, studentTok);
  assert.equal(owner.status, 200);
  assert.equal(typeof owner.body.code, 'string', 'owner sees code');
  assert.ok(Array.isArray(owner.body.perTestFull), 'owner sees perTestFull');

  const anon = await h.api(`/api/submits/${s.body.id}`);
  assert.equal(anon.status, 200);
  for (const f of ['code', 'perTest', 'perTestFull', 'compileLog', 'expected', 'got']) {
    assert.ok(!(f in anon.body), `anon must not receive ${f}`);
  }
  const other = await h.api(`/api/submits/${s.body.id}`, {}, otherTok);
  assert.equal(other.status, 200);
  for (const f of ['code', 'perTest', 'perTestFull', 'compileLog', 'expected', 'got']) {
    assert.ok(!(f in other.body), `other student must not receive ${f}`);
  }

  const list = await h.api(`/api/submits?problem=${playgroundProblemId}`);
  const row = list.body.items.find((x) => x.id === s.body.id);
  assert.ok(row, 'submission in list');
  for (const f of ['code', 'perTest', 'perTestFull', 'compileLog', 'expected', 'got']) {
    assert.ok(!(f in row), `list must not receive ${f}`);
  }
  assert.equal(typeof row.status, 'string', 'verdict kept');
  assert.notEqual(row.status, 'QUE', 'verdict judged');
  assert.equal(typeof row.points, 'number', 'points kept');
  assert.ok(row.lang, 'lang kept');
  assert.ok(row.createdAt && row.judgedAt, 'timestamps kept');
});

test('A8: private contest membership, endAt, contest/problem/team checks, hidden problems', async () => {
  const priv = await h.createContest(teacherTok, {
    name: 'Lane A Private', mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z', endAt: '2030-01-01T00:00:00Z',
  });
  const pv = await patchContest(priv.id, { visibility: 'private' });
  assert.equal(pv.status, 200);
  const running = await patchContest(priv.id, { lifecycle: 'running' });
  assert.equal(running.status, 200);
  const { p } = await makeProblem(priv.id, 'P');

  const nonMember = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: priv.id, problemId: p.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, otherTok);
  assert.equal(nonMember.status, 403);
  assert.equal(nonMember.body.error.code, 'NOT_MEMBER');
  const listDenied = await h.api(`/api/contests/${priv.id}/problems`, {}, otherTok);
  assert.equal(listDenied.status, 403);
  assert.equal(listDenied.body.error.code, 'NOT_MEMBER');
  const readDenied = await h.api(`/api/problems/${p.id}`, {}, otherTok);
  assert.equal(readDenied.status, 403);

  const added = await addMember(priv.id, 'jan_kowalski');
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const listAllowed = await h.api(`/api/contests/${priv.id}/problems`, {}, studentTok);
  assert.equal(listAllowed.status, 200);

  const member = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: priv.id, problemId: p.id, filename: 'solution.cpp', code: 'int main(){ return 0; }' }),
  }, studentTok);
  assert.equal(member.status, 201, JSON.stringify(member.body));

  const wrongContest = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: playgroundId, problemId: p.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, studentTok);
  assert.equal(wrongContest.status, 403);
  assert.equal(wrongContest.body.error.code, 'CONTEST_MISMATCH');

  const badTeam = await h.api(`/api/contests/${priv.id}/teams`, { method: 'POST', ...json({ name: 'Other Team', memberIds: [otherId] }) }, teacherTok);
  assert.equal(badTeam.status, 201);
  const badTeamSubmit = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: priv.id, problemId: p.id, teamId: badTeam.body.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, studentTok);
  assert.equal(badTeamSubmit.status, 403);
  assert.equal(badTeamSubmit.body.error.code, 'TEAM_MEMBERSHIP');

  const goodTeam = await h.api(`/api/contests/${priv.id}/teams`, { method: 'POST', ...json({ name: 'Good Team', memberIds: [studentId] }) }, teacherTok);
  assert.equal(goodTeam.status, 201);
  const goodTeamSubmit = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: priv.id, problemId: p.id, teamId: goodTeam.body.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, studentTok);
  assert.equal(goodTeamSubmit.status, 201, JSON.stringify(goodTeamSubmit.body));

  const draft = await h.createProblem(priv.id, teacherTok, { code: 'D', name: 'Draft P', visibility: 'draft' });
  const dg = await h.addGroup(draft.id, teacherTok);
  await h.addCase(draft.id, teacherTok, { groupId: dg.id, input: '1\n', expected: '1\n' });
  for (const vis of ['draft', 'hidden', 'quarantined']) {
    if (vis !== 'draft') {
      const upd = await h.api(`/api/problems/${draft.id}`, { method: 'PATCH', ...json({ visibility: vis }) }, teacherTok);
      assert.equal(upd.status, 200);
    }
    const r = await h.api('/api/submits', {
      method: 'POST',
      ...json({ contestId: priv.id, problemId: draft.id, filename: 'solution.cpp', code: 'int main(){}' }),
    }, studentTok);
    assert.equal(r.status, 403, `${vis} problem must reject`);
    assert.equal(r.body.error.code, 'HIDDEN');
  }

  const ended = await patchContest(priv.id, { endAt: '2020-01-02T00:00:00Z' });
  assert.equal(ended.status, 200);
  const late = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: priv.id, problemId: p.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, studentTok);
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'ENDED');
});

test('A9: only contest admins may rejudge a single submit; judge output resets', async () => {
  const denied = await h.api(`/api/submits/${firstSubmitId}/rejudge`, { method: 'POST', ...json({}) }, studentTok);
  assert.equal(denied.status, 403);

  const ok = await h.api(`/api/submits/${firstSubmitId}/rejudge`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(ok.status, 200);
  const row = h.store.get('submits', firstSubmitId);
  assert.deepEqual(row.perTest, [], 'perTest reset');
  assert.equal(row.judgedAt, null, 'judgedAt reset');
  await h.waitJudged(firstSubmitId, studentTok);
});

test('A4: webhook SSRF rejection (loopback/private/link-local/protocol) and HMAC signature', async () => {
  const priv = await h.createContest(teacherTok, { name: 'Lane A Hook', mode: 'ICPC' });
  const cases = [
    ['http://127.0.0.1:9/hook', 'URL_BLOCKED'],
    ['http://localhost/hook', 'URL_BLOCKED'],
    ['http://169.254.169.254/latest/meta-data', 'URL_BLOCKED'],
    ['http://10.0.0.5/hook', 'URL_BLOCKED'],
    ['http://[::1]/hook', 'URL_BLOCKED'],
    ['ftp://example.com/hook', 'URL_PROTOCOL'],
  ];
  for (const [url, code] of cases) {
    const r = await h.api(`/api/contests/${priv.id}/webhooks`, { method: 'POST', ...json({ url }) }, teacherTok);
    assert.equal(r.status, 422, `${url} must be rejected`);
    assert.equal(r.body.error.code, code, `${url} code`);
  }
  process.env.SATORI_WEBHOOK_SECRET = 'lane-a-secret';
  const { signWebhook } = require('../apps/api/src/lib/http');
  const body = JSON.stringify({ event: 'ping' });
  const expected = `sha256=${nodeCrypto.createHmac('sha256', 'lane-a-secret').update(body).digest('hex')}`;
  assert.equal(signWebhook(body), expected);
  delete process.env.SATORI_WEBHOOK_SECRET;
});

test('A5: global webhook listing is authenticated and scoped; global POST is superadmin-only', async () => {
  const priv = await h.createContest(teacherTok, { name: 'Lane A Hook Scope', mode: 'ICPC' });
  const otherContest = await h.createContest(adminTok, { name: 'Lane A Hook Admin Contest', mode: 'ICPC' });
  const anon = await h.api('/api/webhooks');
  assert.equal(anon.status, 401);

  const mine = h.store.insert('webhooks', { contestId: priv.id, url: 'https://example.com/a', events: ['submit.judged'] });
  const foreign = h.store.insert('webhooks', { contestId: otherContest.id, url: 'https://example.com/b', events: ['submit.judged'] });
  const global = h.store.insert('webhooks', { contestId: null, url: 'https://example.com/c', events: ['submit.judged'] });

  const teacher = await h.api('/api/webhooks', {}, teacherTok);
  assert.equal(teacher.status, 200);
  const teacherIdsSeen = teacher.body.items.map((x) => x.id);
  assert.ok(teacherIdsSeen.includes(mine.id), 'own contest hook visible');
  assert.ok(!teacherIdsSeen.includes(foreign.id), 'foreign contest hook hidden');
  assert.ok(!teacherIdsSeen.includes(global.id), 'global hook hidden from contest admin');

  const admin = await h.api('/api/webhooks', {}, adminTok);
  const adminIdsSeen = admin.body.items.map((x) => x.id);
  assert.ok(adminIdsSeen.includes(foreign.id) && adminIdsSeen.includes(global.id), 'superadmin sees all');

  const globalDenied = await h.api('/api/webhooks', { method: 'POST', ...json({ url: 'https://example.com/new' }) }, teacherTok);
  assert.equal(globalDenied.status, 403);
  const foreignDenied = await h.api('/api/webhooks', { method: 'POST', ...json({ contestId: otherContest.id, url: 'https://example.com/new' }) }, teacherTok);
  assert.equal(foreignDenied.status, 403);
  const internal = await h.api('/api/webhooks', { method: 'POST', ...json({ url: 'http://127.0.0.1/x' }) }, adminTok);
  assert.equal(internal.status, 422);
  assert.equal(internal.body.error.code, 'URL_BLOCKED');
});

test('A13: test routes reject cross-problem groups/cases and whitelist fields', async () => {
  const c = await h.createContest(teacherTok, { name: 'Lane A Tests', mode: 'ICPC' });
  const a = await makeProblem(c.id, 'A');
  const b = await makeProblem(c.id, 'B');

  const caseIntoB = await h.api(`/api/problems/${a.p.id}/tests`, {
    method: 'POST', ...json({ case: { groupId: b.g.id, input: '1', expected: '1' } }),
  }, teacherTok);
  assert.equal(caseIntoB.status, 403);
  assert.equal(caseIntoB.body.error.code, 'GROUP_MISMATCH');

  const groupWithB = await h.api(`/api/problems/${a.p.id}/tests`, {
    method: 'POST', ...json({ group: { name: 'x', points: 10, problemId: b.p.id } }),
  }, teacherTok);
  assert.equal(groupWithB.status, 403);

  const caseWithB = await h.api(`/api/problems/${a.p.id}/tests`, {
    method: 'POST', ...json({ case: { groupId: a.g.id, problemId: b.p.id, input: '1', expected: '1' } }),
  }, teacherTok);
  assert.equal(caseWithB.status, 403);

  const cleanGroup = await h.api(`/api/problems/${a.p.id}/tests`, {
    method: 'POST', ...json({ group: { name: 'clean', points: 25, evil: 'x', contestId: b.p.contestId } }),
  }, teacherTok);
  assert.equal(cleanGroup.status, 201);
  assert.ok(!('evil' in cleanGroup.body));
  assert.equal(cleanGroup.body.problemId, a.p.id);

  const cleanCase = await h.api(`/api/problems/${a.p.id}/tests`, {
    method: 'POST', ...json({ case: { groupId: cleanGroup.body.id, input: '2', expected: '2', id: 999999, evil: true } }),
  }, teacherTok);
  assert.equal(cleanCase.status, 201);
  assert.notEqual(cleanCase.body.id, 999999);
  assert.ok(!('evil' in cleanCase.body));
  assert.equal(String(cleanCase.body.groupId), String(cleanGroup.body.id));
});

test('A2/A3: clarification membership + whitelist, jury answer, news/subpage ownership', async () => {
  const priv = await h.createContest(teacherTok, {
    name: 'Lane A Comms', mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z', endAt: '2030-01-01T00:00:00Z',
  });
  await patchContest(priv.id, { visibility: 'private' });
  const { p } = await makeProblem(priv.id, 'C');
  await addMember(priv.id, 'jan_kowalski');
  const bContest = await h.createContest(adminTok, { name: 'Lane A Comms Other', mode: 'ICPC' });

  const nonMember = await h.api(`/api/contests/${priv.id}/clarifications`, {
    method: 'POST', ...json({ question: 'Can I ask?' }),
  }, otherTok);
  assert.equal(nonMember.status, 403);
  assert.equal(nonMember.body.error.code, 'NOT_MEMBER');

  const ask = await h.api(`/api/contests/${priv.id}/clarifications`, {
    method: 'POST',
    ...json({ question: 'What is the limit?', problem: p.id, authorId: otherId, contestId: bContest.id, answer: 'fake answer' }),
  }, studentTok);
  assert.equal(ask.status, 201, JSON.stringify(ask.body));
  assert.equal(ask.body.authorId, studentId, 'authorId is server-owned');
  assert.equal(ask.body.contestId, priv.id, 'contestId is server-owned');
  assert.ok(!ask.body.answer, 'answer cannot be set while asking');
  const clarId = ask.body.id;

  const mine = await h.api(`/api/contests/${priv.id}/clarifications`, {}, studentTok);
  const mineRow = mine.body.items.find((x) => x.id === clarId);
  assert.equal(mineRow.mine, true);
  const notMine = await h.api(`/api/contests/${priv.id}/clarifications`, {}, otherTok);
  assert.equal(notMine.status, 403, 'non-members cannot read clarifications of a members-only contest');
  assert.equal(notMine.body.error.code, 'NOT_MEMBER');

  const answerDenied = await h.api(`/api/contests/${priv.id}/clarifications/${clarId}/answer`, { method: 'POST', ...json({ answer: 'no' }) }, studentTok);
  assert.equal(answerDenied.status, 403);
  const answerOk = await h.api(`/api/contests/${priv.id}/clarifications/${clarId}/answer`, { method: 'POST', ...json({ answer: '1 second' }) }, teacherTok);
  assert.equal(answerOk.status, 200);
  assert.equal(answerOk.body.answer, '1 second');
  assert.equal(answerOk.body.answeredBy, teacherId);
  assert.ok(answerOk.body.answeredAt);

  const foreignNews = await h.api(`/api/contests/${bContest.id}/news`, { method: 'POST', ...json({ title: 'Nope', bodyMd: 'x' }) }, teacherTok);
  assert.equal(foreignNews.status, 403, 'admin of A cannot post to B');

  const news = await h.api(`/api/contests/${priv.id}/news`, {
    method: 'POST',
    ...json({ title: 'Announcement', bodyMd: 'Body', contestId: bContest.id, authorId: adminId, evil: 'x', scheduledAt: '2026-01-01T10:00:00Z' }),
  }, teacherTok);
  assert.equal(news.status, 201);
  assert.equal(news.body.contestId, priv.id, 'news contestId is server-owned');
  assert.equal(news.body.authorId, teacherId, 'news authorId is server-owned');
  assert.ok(!('evil' in news.body));

  const subpage = await h.api(`/api/contests/${priv.id}/subpages`, {
    method: 'POST', ...json({ title: 'FAQ', bodyMd: 'Answers', contestId: bContest.id, authorId: adminId, evil: 1 }),
  }, teacherTok);
  assert.equal(subpage.status, 201);
  assert.equal(subpage.body.contestId, priv.id);
  assert.equal(subpage.body.authorId, teacherId);
  assert.ok(!('evil' in subpage.body));

  const oldNewsPath = await h.api(`/api/contests/${priv.id}/news`, {}, studentTok);
  assert.equal(oldNewsPath.status, 200);
  assert.ok(oldNewsPath.body.items.some((x) => x.id === news.body.id));

  const deleteDenied = await h.api(`/api/contests/${priv.id}/news/${news.body.id}`, { method: 'DELETE' }, studentTok);
  assert.equal(deleteDenied.status, 403);
  const deleteNews = await h.api(`/api/contests/${priv.id}/news/${news.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(deleteNews.status, 200);
  const deleteSubpage = await h.api(`/api/contests/${priv.id}/subpages/${subpage.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(deleteSubpage.status, 200);
  const deleteClar = await h.api(`/api/contests/${priv.id}/clarifications/${clarId}`, { method: 'DELETE' }, teacherTok);
  assert.equal(deleteClar.status, 200);
});

test('A10/A11/A12: board gates, public projection, member roles, teachers excluded', async () => {
  const c = await h.createContest(teacherTok, {
    name: 'Lane A Board', mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z', endAt: '2030-01-01T00:00:00Z',
  });
  await addMember(c.id, 'jan_kowalski');
  await addMember(c.id, otherLogin);
  const { p } = await makeProblem(c.id, 'B');
  const now = Date.now();
  const mkSubmit = (userId, points, ago) => h.store.insert('submits', {
    contestId: c.id, problemId: p.id, userId, lang: 'C++17', filename: 'a.cpp', status: 'OK',
    points, perTest: [], sampleOnly: false,
    createdAt: new Date(now - ago).toISOString(), judgedAt: new Date(now - ago + 1000).toISOString(),
  });
  mkSubmit(studentId, 100, 30000);
  mkSubmit(otherId, 50, 20000);
  mkSubmit(teacherId, 100, 10000);

  const hidden = await patchContest(c.id, { settings: { board: { mode: 'hidden' } } });
  assert.equal(hidden.status, 200);
  assert.equal((await h.api(`/api/contests/${c.id}/ranking`)).status, 403);
  assert.equal((await h.api(`/api/contests/${c.id}/ranking`, {}, studentTok)).status, 403);
  assert.equal((await h.api(`/api/contests/${c.id}/ranking.csv`, {}, studentTok)).status, 403);
  assert.equal((await h.api(`/api/submits?contest=${c.id}`)).status, 403);
  assert.equal((await h.api(`/api/submits?contest=${c.id}`, {}, studentTok)).status, 403);
  assert.equal((await h.api(`/api/contests/${c.id}/ranking`, {}, teacherTok)).status, 200);
  assert.equal((await h.api(`/api/submits?contest=${c.id}`, {}, teacherTok)).status, 200);

  await patchContest(c.id, { settings: { board: { mode: 'me-only' } } });
  const studentBoard = await h.api(`/api/contests/${c.id}/ranking`, {}, studentTok);
  assert.equal(studentBoard.status, 200);
  assert.equal(studentBoard.body.rows.length, 1, 'me-only student sees only self');
  assert.equal(studentBoard.body.rows[0].contestantId, `u:${studentId}`);
  const studentSubs = await h.api(`/api/submits?contest=${c.id}`, {}, studentTok);
  assert.equal(studentSubs.status, 200);
  assert.ok(studentSubs.body.items.length > 0);
  assert.ok(studentSubs.body.items.every((s) => s.userId === studentId), 'me-only submit list filters rows');

  // Other is promoted to teacher: role is visible, row disappears from the board.
  const promote = await addMember(c.id, otherLogin, 'teacher');
  assert.equal(promote.status, 201, JSON.stringify(promote.body));
  const members = await h.api(`/api/contests/${c.id}/members`, {}, teacherTok);
  assert.equal(members.status, 200);
  assert.equal(members.body.members.find((m) => m.id === otherId).role, 'teacher');

  const teacherBoard = await h.api(`/api/contests/${c.id}/ranking`, {}, teacherTok);
  assert.equal(teacherBoard.status, 200);
  assert.ok(!teacherBoard.body.rows.some((r) => String(r.name) === otherLogin), 'teacher not ranked');
  assert.ok(teacherBoard.body.rows.some((r) => r.contestantId === `u:${studentId}`));

  const problems = await h.api(`/api/contests/${c.id}/problems`, {}, teacherTok);
  const pb = problems.body.items.find((x) => x.id === p.id);
  assert.equal(pb.solvesPct, 100, 'teacher excluded from solvesPct denominator and accepted count');

  // Live SSE applies me-only on its first snapshot and drops mid-stream on hide.
  const ac = new AbortController();
  const live = await fetch(`${h.base}/api/contests/${c.id}/rankings/live`, {
    headers: { Authorization: `Bearer ${studentTok}` }, signal: ac.signal,
  });
  assert.equal(live.status, 200);
  const reader = live.body.getReader();
  const parseChunks = (value) => Buffer.from(value || []).toString('utf8')
    .split('\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
  const first = parseChunks((await reader.read()).value);
  assert.equal(first.length, 1, 'SSE snapshot');
  assert.equal(first[0].rows.length, 1);
  assert.equal(first[0].rows[0].contestantId, `u:${studentId}`);

  await patchContest(c.id, { settings: { board: { mode: 'hidden' } } });
  let sawHidden = false;
  for (let i = 0; i < 20 && !sawHidden; i++) {
    const chunk = await reader.read();
    if (chunk.done) break;
    for (const evt of parseChunks(chunk.value)) if (evt.error && evt.error.code === 'BOARD_HIDDEN') sawHidden = true;
  }
  assert.ok(sawHidden, 'mid-stream hide ends the stream with BOARD_HIDDEN');
  ac.abort();
  try { await reader.cancel(); } catch { /* aborted */ }

  // Public contest projection: no member IDs, pending, admins, or exam IP/time.
  await patchContest(c.id, { settings: { board: { mode: 'everyone' }, exam: { ipAllow: '10.0.0.0/8', timeWindow: '09:00-10:00' } } });
  const anonContest = await h.api(`/api/contests/${c.id}`);
  assert.equal(anonContest.status, 200);
  assert.ok(!('members' in anonContest.body));
  assert.ok(!('pending' in anonContest.body));
  assert.ok(!('admins' in anonContest.body));
  assert.ok(!('exam' in (anonContest.body.settings || {})), 'exam settings hidden');
  const adminContest = await h.api(`/api/contests/${c.id}`, {}, teacherTok);
  assert.ok(Array.isArray(adminContest.body.members));
  assert.ok(adminContest.body.settings.exam, 'admins see exam settings');
  const anonList = await h.api('/api/contests');
  assert.ok(anonList.body.items.every((x) => !('admins' in x) && !('members' in x)), 'list projection hides IDs');

  // Deleting a teacher revokes contest admin and the role.
  const remove = await h.api(`/api/contests/${c.id}/members/${otherId}`, { method: 'DELETE' }, teacherTok);
  assert.equal(remove.status, 200);
  assert.equal(remove.body.revokedAdmin, true);
  const revoked = await h.api(`/api/contests/${c.id}/members`, {}, otherTok);
  assert.equal(revoked.status, 403, 'removed teacher loses admin access');
  assert.equal((h.store.get('contests', c.id).roles || {})[String(otherId)], undefined);
});

test('A14: submit throttle returns 429 with Retry hint; register/violation helpers throttle', async () => {
  const login = `lane_a_flood_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', { method: 'POST', ...json({ login, email: `${login}@uj.edu.pl`, password: 'secret12' }) });
  assert.equal(reg.status, 201);
  const floodTok = await h.loginAs(login, 'secret12');
  const max = Number(process.env.SATORI_SUBMIT_RATE_MAX || 30);
  let last;
  for (let i = 0; i < max + 1; i++) {
    last = await h.api('/api/submits', { method: 'POST', ...json({ problemId: 99999999, filename: 'solution.cpp', code: 'int main(){}' }) }, floodTok);
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'THROTTLE');
  assert.ok(last.body.error.retryAfterSec > 0);
  assert.match(last.body.error.hint, /Retry in \d+s/);
  assert.ok(last.headers.get('retry-after'), 'Retry-After header');

  const httpLib = require('../apps/api/src/lib/http');
  const fakeReq = { headers: {}, socket: { remoteAddress: '203.0.113.7' } };
  let regLimited = false;
  for (let i = 0; i < 20; i++) {
    if (httpLib.registerRate(fakeReq).limited) { regLimited = true; break; }
  }
  assert.equal(regLimited, true, 'register helper throttles per IP');

  let violationLimited = false;
  for (let i = 0; i < 30; i++) {
    if (httpLib.violationRate('exam-1', 'user-1').limited) { violationLimited = true; break; }
  }
  assert.equal(violationLimited, true, 'exam violation helper throttles');
});

test('A7: production auto-seed is off unless SATORI_DEMO_SEED=1', () => {
  const script = `
    const { store } = require('./apps/api/src/lib/store');
    const { autoSeedIfEmpty } = require('./apps/api/src/server');
    autoSeedIfEmpty();
    process.stdout.write('RESULT' + JSON.stringify({ users: store.all('users').length, contests: store.all('contests').length }));
  `;
  const run = (dataDir, extraEnv) => spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SATORI_DATA_DIR: dataDir, NODE_ENV: 'production', ...extraEnv },
    encoding: 'utf8',
  });
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-seed-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-seed-b-'));
  try {
    const blocked = run(dirA, { SATORI_DEMO_SEED: '' });
    assert.equal(blocked.status, 0, blocked.stderr);
    const noSeed = JSON.parse(blocked.stdout.slice(blocked.stdout.lastIndexOf('RESULT') + 6));
    assert.deepEqual(noSeed, { users: 0, contests: 0 }, 'production empty data must not seed');

    const allowed = run(dirB, { SATORI_DEMO_SEED: '1' });
    assert.equal(allowed.status, 0, allowed.stderr);
    const seeded = JSON.parse(allowed.stdout.slice(allowed.stdout.lastIndexOf('RESULT') + 6));
    assert.deepEqual(seeded, { users: 3, contests: 3 }, 'explicit demo seed still works');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('A16/A17: cache is auth-partitioned, auth helpers clear it, default API is same-origin', async () => {
  const apiPath = require.resolve('../apps/web/lib/api');
  const saved = {
    window: global.window,
    localStorage: global.localStorage,
    fetch: global.fetch,
    env: process.env.NEXT_PUBLIC_API,
  };
  const mem = new Map();
  global.window = {};
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  let calls = [];
  let n = 0;
  global.fetch = async (url) => {
    calls.push(String(url));
    n += 1;
    return { ok: true, status: 200, json: async () => ({ n }) };
  };
  try {
    delete process.env.NEXT_PUBLIC_API;
    delete require.cache[apiPath];
    const mod = require('../apps/web/lib/api');
    assert.equal(mod.API, '', 'no env -> same-origin relative base');
    mem.set('SATORI_TOKEN', 'token-a');
    await mod.api('/api/me');
    assert.equal(calls[0], '/api/me', 'relative same-origin request');
    await mod.api('/api/me');
    assert.equal(calls.length, 1, 'cache hit for same token');
    mem.set('SATORI_TOKEN', 'token-b');
    await mod.api('/api/me');
    assert.equal(calls.length, 2, 'token change partitions cache');
    mod.setApiAuth('token-c');
    await mod.api('/api/me');
    assert.equal(calls.length, 3, 'setApiAuth clears cache');
    mod.clearApiAuth();
    await mod.api('/api/me');
    assert.equal(calls.length, 4, 'clearApiAuth clears cache');
    assert.equal(mem.get('SATORI_TOKEN'), undefined);

    delete require.cache[apiPath];
    process.env.NEXT_PUBLIC_API = 'https://api.example.test';
    const absolute = require('../apps/web/lib/api');
    assert.equal(absolute.API, 'https://api.example.test');
  } finally {
    global.window = saved.window;
    global.localStorage = saved.localStorage;
    global.fetch = saved.fetch;
    if (saved.env === undefined) delete process.env.NEXT_PUBLIC_API;
    else process.env.NEXT_PUBLIC_API = saved.env;
    delete require.cache[apiPath];
  }
});
