// M1 integration: subtask scoring, visibility/lifecycle submit gates, duplicate deep-copy,
// DELETE batch (problems, test groups, contests, members, news, notes, webhooks), notifications.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m1-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3133';
const BASE = 'http://localhost:3133';

let server;
let studentTok;
let teacherTok;
let studentId;
const playgroundId = 251519;
let playgroundProblemCode;

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
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const d = await api(`/api/submits/${id}`, {}, tok);
    if (!['QUE', 'CMP', 'TST'].includes(d.body.status)) return d.body;
  }
  return null;
}

const SUM_CODE = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int a,b;if(!(cin>>a>>b))return 0;cout<<a+b;}';

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3133, r));
  studentTok = await loginAs('jan_kowalski', 'student123');
  teacherTok = await loginAs('g_herman', 'teacher123');
  studentId = (await api('/api/me', {}, studentTok)).body.id;
  playgroundProblemCode = (await api(`/api/contests/${playgroundId}/problems`)).body.items[0].code;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('IOI-style subtask scoring uses group weights', async () => {
  const c = await api('/api/contests', { method: 'POST', ...json({ name: 'Score Probe', mode: 'IOI' }) }, teacherTok);
  assert.equal(c.status, 201);
  const cid = c.body.id;
  const p = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'A', name: 'Sum', visibility: 'visible' }) }, teacherTok);
  assert.equal(p.status, 201);
  const pid = p.body.id;
  const g1 = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'easy', points: 10 } }) }, teacherTok);
  assert.equal(g1.status, 201);
  const g2 = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'hard', points: 20 } }) }, teacherTok);
  assert.equal(g2.status, 201);
  await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g1.body.id, input: '2 3\n', expected: '5\n' } }) }, teacherTok);
  await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g2.body.id, input: '10 20\n', expected: '999\n' } }) }, teacherTok);

  const run = await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ lifecycle: 'running' }) }, teacherTok);
  assert.equal(run.status, 200);

  const s = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: pid, filename: 'solution.cpp', code: SUM_CODE }) }, studentTok);
  assert.equal(s.status, 201);
  const judged = await waitJudged(s.body.id, studentTok);
  assert.ok(judged, 'judged in time');
  assert.equal(judged.status, 'WA', 'second group fails');
  assert.equal(judged.points, 10, 'passing the 10-point group yields 10/30');
  assert.equal(judged.testsTotal, 2);
});

test('hidden problems and unopened contests block non-admin submits', async () => {
  const c = await api('/api/contests', { method: 'POST', ...json({ name: 'Gate Probe', mode: 'ICPC' }) }, teacherTok);
  const cid = c.body.id;
  const p1 = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'A', name: 'Open later', visibility: 'visible' }) }, teacherTok);
  const p2 = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'B', name: 'Draft', visibility: 'draft' }) }, teacherTok);
  for (const pid of [p1.body.id, p2.body.id]) {
    const g = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'all', points: 100, checker: 'token' } }) }, teacherTok);
    assert.equal(g.status, 201);
    const cse = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g.body.id, input: '2 3\n', expected: '5\n', checker: 'token' } }) }, teacherTok);
    assert.equal(cse.status, 201);
  }

  const draft = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: p1.body.id, filename: 'solution.cpp', code: SUM_CODE }) }, studentTok);
  assert.equal(draft.status, 403);
  assert.equal(draft.body.error.code, 'CONTEST_DRAFT');

  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ lifecycle: 'running' }) }, teacherTok);

  const hidden = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: p2.body.id, filename: 'solution.cpp', code: SUM_CODE }) }, studentTok);
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body.error.code, 'HIDDEN');

  const admin = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: p2.body.id, filename: 'solution.cpp', code: SUM_CODE }) }, teacherTok);
  assert.equal(admin.status, 201, 'admin may submit to draft problem');
  const adminJudged = await waitJudged(admin.body.id, teacherTok);
  assert.equal(adminJudged.status, 'OK');

  const listStudent = await api(`/api/contests/${cid}/problems`, {}, studentTok);
  const codesStudent = listStudent.body.items.map((x) => x.code);
  assert.ok(codesStudent.includes('A'));
  assert.ok(!codesStudent.includes('B'), 'draft problem hidden from list');
  const listTeacher = await api(`/api/contests/${cid}/problems?all=1`, {}, teacherTok);
  assert.equal(listTeacher.body.items.length, 2, 'admin sees all with ?all=1');

  const detailStudent = await api(`/api/problems/${p2.body.id}`, {}, studentTok);
  assert.equal(detailStudent.status, 403);
  const detailTeacher = await api(`/api/problems/${p2.body.id}`, {}, teacherTok);
  assert.equal(detailTeacher.status, 200);

  const future = new Date(Date.now() + 3600000).toISOString();
  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ startAt: future }) }, teacherTok);
  const early = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: p1.body.id, filename: 'solution.cpp', code: SUM_CODE }) }, studentTok);
  assert.equal(early.status, 403);
  assert.equal(early.body.error.code, 'NOT_STARTED');

  const past = new Date(Date.now() - 3600000).toISOString();
  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ startAt: past }) }, teacherTok);
  const ok = await api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: p1.body.id, filename: 'solution.cpp', code: SUM_CODE }) }, studentTok);
  assert.equal(ok.status, 201, 'submit allowed once window open');
  const okJudged = await waitJudged(ok.body.id, studentTok);
  assert.equal(okJudged.status, 'OK');
});

test('duplicate copies test cases and news; clone judges end-to-end', async () => {
  const news = await api(`/api/contests/${playgroundId}/news`, { method: 'POST', ...json({ title: 'Clone probe', bodyMd: 'copied?' }) }, teacherTok);
  assert.equal(news.status, 201);

  const sourceNews = await api(`/api/contests/${playgroundId}/news`);
  const sourceCount = sourceNews.body.items.length;
  assert.ok(sourceCount >= 2, 'seed + probe row present');

  const dup = await api(`/api/contests/${playgroundId}/duplicate`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(dup.status, 201);
  const ncid = dup.body.id;

  const clonedNews = await api(`/api/contests/${ncid}/news`, {}, teacherTok);
  assert.equal(clonedNews.body.items.length, sourceCount, 'all news copied');
  assert.ok(clonedNews.body.items.some((n) => n.title === 'Clone probe'), 'probe announcement copied');

  const clonedProbs = await api(`/api/contests/${ncid}/problems?all=1`, {}, teacherTok);
  const cloned = clonedProbs.body.items.find((x) => x.code === playgroundProblemCode);
  assert.ok(cloned, 'problems copied');

  const tests = await api(`/api/problems/${cloned.id}/tests`, {}, teacherTok);
  assert.ok(tests.body.items.length >= 1, 'test groups copied');
  assert.ok(tests.body.items[0].cases.length >= 1, 'test cases copied');

  const s = await api('/api/submits', { method: 'POST', ...json({ problemId: cloned.id, filename: 'solution.cpp', code: SUM_CODE }) }, teacherTok);
  assert.equal(s.status, 201);
  const judged = await waitJudged(s.body.id, teacherTok);
  assert.equal(judged.testsTotal, 2, 'clone judges against copied cases');
});

test('delete batch: problems, test groups, contest, member, news, note, webhook', async () => {
  // fixtures: problem with a group/case to delete + a contest for archive-first delete
  const c = await api('/api/contests', { method: 'POST', ...json({ name: 'Delete Probe', mode: 'ICPC' }) }, teacherTok);
  const cid = c.body.id;
  const p = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'A', name: 'Victim', visibility: 'visible' }) }, teacherTok);
  const pid = p.body.id;
  const g = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'all', points: 100 } }) }, teacherTok);
  await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g.body.id, input: '2 3\n', expected: '5\n' } }) }, teacherTok);

  const studentDel = await api(`/api/problems/${pid}`, { method: 'DELETE' }, studentTok);
  assert.equal(studentDel.status, 403);
  const teacherDel = await api(`/api/problems/${pid}`, { method: 'DELETE' }, teacherTok);
  assert.equal(teacherDel.status, 200);
  const gone = await api(`/api/problems/${pid}`, {}, teacherTok);
  assert.equal(gone.status, 404);

  // test group delete on a fresh problem
  const p2 = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'B', name: 'GroupVictim', visibility: 'visible' }) }, teacherTok);
  const g2 = await api(`/api/problems/${p2.body.id}/tests`, { method: 'POST', ...json({ group: { name: 'trash', points: 50 } }) }, teacherTok);
  await api(`/api/problems/${p2.body.id}/tests`, { method: 'POST', ...json({ case: { groupId: g2.body.id, input: '1 1\n', expected: '2\n' } }) }, teacherTok);
  const gDel403 = await api(`/api/problems/${p2.body.id}/tests/${g2.body.id}`, { method: 'DELETE' }, studentTok);
  assert.equal(gDel403.status, 403);
  const gDel = await api(`/api/problems/${p2.body.id}/tests/${g2.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(gDel.status, 200);
  const testsLeft = await api(`/api/problems/${p2.body.id}/tests`, {}, teacherTok);
  assert.equal(testsLeft.body.items.length, 0);

  // contest: archive-first, then purge
  const c2 = await api('/api/contests', { method: 'POST', ...json({ name: 'Archive Probe', mode: 'ICPC' }) }, teacherTok);
  const cid2 = c2.body.id;
  const del403 = await api(`/api/contests/${cid2}`, { method: 'DELETE' }, studentTok);
  assert.equal(del403.status, 403);
  const arch = await api(`/api/contests/${cid2}`, { method: 'DELETE' }, teacherTok);
  assert.equal(arch.body.archived, true, 'first DELETE archives');
  const still = await api(`/api/contests/${cid2}`, {}, teacherTok);
  assert.equal(still.status, 200);
  assert.equal(still.body.archived, true);
  const purge = await api(`/api/contests/${cid2}`, { method: 'DELETE' }, teacherTok);
  assert.equal(purge.body.deleted, true, 'second DELETE purges');
  const goneC = await api(`/api/contests/${cid2}`, {}, teacherTok);
  assert.equal(goneC.status, 404);

  // member remove
  const csv = await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: 'jan_kowalski' }) }, teacherTok);
  assert.equal(csv.body.added, 1);
  const mDel403 = await api(`/api/contests/${cid}/members/${studentId}`, { method: 'DELETE' }, studentTok);
  assert.equal(mDel403.status, 403);
  const mDel = await api(`/api/contests/${cid}/members/${studentId}`, { method: 'DELETE' }, teacherTok);
  assert.equal(mDel.status, 200);
  const members = await api(`/api/contests/${cid}/members`, {}, teacherTok);
  assert.ok(!members.body.members.some((m) => m.id === studentId), 'member removed');

  // notes
  const note = await api('/api/notes', { method: 'POST', ...json({ problem: p2.body.id, text: 'stash' }) }, studentTok);
  assert.equal(note.status, 201);
  const nDel403 = await api(`/api/notes/${note.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(nDel403.status, 403, 'only owner or superadmin');
  const nDel = await api(`/api/notes/${note.body.id}`, { method: 'DELETE' }, studentTok);
  assert.equal(nDel.status, 200);
  const notesLeft = await api(`/api/notes?problem=${p2.body.id}`, {}, studentTok);
  assert.ok(!notesLeft.body.items.some((n) => n.id === note.body.id));

  // webhooks registration/ping/delete
  const hook = await api(`/api/contests/${cid}/webhooks`, { method: 'POST', ...json({ url: 'https://example.com/hook' }) }, teacherTok);
  assert.equal(hook.status, 201);
  const hDel403 = await api(`/api/contests/${cid}/webhooks/${hook.body.id}`, { method: 'DELETE' }, studentTok);
  assert.equal(hDel403.status, 403);
  const ping = await api(`/api/contests/${cid}/webhooks/${hook.body.id}/ping`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(ping.status, 200);
  const hooks = await api(`/api/contests/${cid}/webhooks`, {}, teacherTok);
  assert.equal(hooks.body.items.length, 1);
  const hDel = await api(`/api/contests/${cid}/webhooks/${hook.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(hDel.status, 200);
  const hooksAfter = await api(`/api/contests/${cid}/webhooks`, {}, teacherTok);
  assert.equal(hooksAfter.body.items.length, 0);

  // news delete
  const nw = await api(`/api/contests/${cid}/news`, { method: 'POST', ...json({ title: 'to remove', bodyMd: 'x' }) }, teacherTok);
  assert.equal(nw.status, 201);
  const nwDel403 = await api(`/api/contests/${cid}/news/${nw.body.id}`, { method: 'DELETE' }, studentTok);
  assert.equal(nwDel403.status, 403);
  const nwDel = await api(`/api/contests/${cid}/news/${nw.body.id}`, { method: 'DELETE' }, teacherTok);
  assert.equal(nwDel.status, 200);
  const newsLeft = await api(`/api/contests/${cid}/news`, {}, teacherTok);
  assert.ok(!newsLeft.body.items.some((n) => n.id === nw.body.id));
});

test('notifications read state and prefs persist', async () => {
  const list = await api('/api/notifications', {}, studentTok);
  assert.ok(list.body.items.length >= 1, 'judged submits produced notifications');
  const unread = list.body.items.find((n) => !n.read);
  assert.ok(unread, 'at least one unread notification');

  const read = await api('/api/notifications/read', { method: 'POST', ...json({ ids: [unread.id] }) }, studentTok);
  assert.equal(read.status, 200);
  assert.ok(read.body.read >= 1);

  const after = await api('/api/notifications', {}, studentTok);
  const again = after.body.items.find((n) => n.id === unread.id);
  assert.equal(again.read, true, 'read state persisted');

  const prefs0 = await api('/api/notifications/prefs', {}, studentTok);
  assert.equal(prefs0.status, 200);
  assert.equal(prefs0.body.prefs.inApp, true);

  const save = await api('/api/notifications/prefs', { method: 'POST', ...json({ inApp: false, webhook: 'https://example.com/inbox' }) }, studentTok);
  assert.equal(save.status, 200);
  const prefs1 = await api('/api/notifications/prefs', {}, studentTok);
  assert.equal(prefs1.body.prefs.inApp, false);
  assert.equal(prefs1.body.prefs.webhook, 'https://example.com/inbox');
});
