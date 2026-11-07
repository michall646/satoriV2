// D4: contest visibility matrix. New contests are members-only by default; a
// non-member never reads problems, ranking, results or comms until approved.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');

let h;
let teacher;
let student;
let other;
let studentId;

async function member(cid, login) {
  return h.api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login }) }, teacher);
}

before(async () => {
  h = await startServer({ prefix: 'satori-access-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  student = await h.loginAs('jan_kowalski', 'student123');
  studentId = (await h.api('/api/me', {}, student)).body.id;
  const login = `access_other_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', {
    method: 'POST', ...json({ login, email: `${login}@uj.edu.pl`, password: 'secret12', firstName: 'A', lastName: 'B' }),
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  other = await h.loginAs(login, 'secret12');
});

after(async () => { if (h) await h.close(); });

test('new contests are members-only by default', async () => {
  const c = await h.createContest(teacher, { name: 'Default members', mode: 'ICPC' });
  assert.equal(c.visibility, 'members');

  const anon = await h.api(`/api/contests/${c.id}`);
  assert.equal(anon.status, 200);
  assert.equal(anon.body.access, 'locked');
  assert.equal(anon.body.membership, 'other');
  assert.equal(anon.body.settings, undefined, 'contest config is behind membership');

  const anonProblems = await h.api(`/api/contests/${c.id}/problems`);
  assert.equal(anonProblems.status, 403);
  assert.equal(anonProblems.body.error.code, 'NOT_MEMBER');

  const stranger = await h.api(`/api/contests/${c.id}/problems`, {}, other);
  assert.equal(stranger.status, 403);

  const ranking = await h.api(`/api/contests/${c.id}/ranking`, {}, other);
  assert.equal(ranking.status, 403);

  const submits = await h.api(`/api/submits?contest=${c.id}`, {}, other);
  assert.equal(submits.status, 403);

  const news = await h.api(`/api/contests/${c.id}/news`, {}, other);
  assert.equal(news.status, 403);

  const csv = await h.api(`/api/contests/${c.id}/ranking.csv`, {}, other);
  assert.equal(csv.status, 403);
});

test('approved members read the contest; pending applicants stay locked', async () => {
  const c = await h.createContest(teacher, { name: 'Approval flow', mode: 'ICPC', registration: 'approval' });

  const applied = await h.api(`/api/contests/${c.id}/apply`, { method: 'POST', ...json({}) }, student);
  assert.equal(applied.status, 200);
  assert.equal(applied.body.state, 'pending');

  const pending = await h.api(`/api/contests/${c.id}`, {}, student);
  assert.equal(pending.body.access, 'locked');
  assert.equal(pending.body.membership, 'pending');

  const stillBlocked = await h.api(`/api/contests/${c.id}/problems`, {}, student);
  assert.equal(stillBlocked.status, 403);

  const approve = await h.api(`/api/contests/${c.id}/members/approve`, {
    method: 'POST', ...json({ userIds: [studentId] }),
  }, teacher);
  assert.equal(approve.status, 200);

  const open = await h.api(`/api/contests/${c.id}`, {}, student);
  assert.equal(open.body.access, 'open');
  assert.equal(open.body.membership, 'joined');

  const problems = await h.api(`/api/contests/${c.id}/problems`, {}, student);
  assert.equal(problems.status, 200);
  const ranking = await h.api(`/api/contests/${c.id}/ranking`, {}, student);
  assert.equal(ranking.status, 200);
});

test('invite-only contests refuse self-service apply', async () => {
  const c = await h.createContest(teacher, { name: 'Invite only', mode: 'ICPC', registration: 'invite' });
  const applied = await h.api(`/api/contests/${c.id}/apply`, { method: 'POST', ...json({}) }, student);
  assert.equal(applied.status, 403);
  assert.equal(applied.body.error.code, 'INVITE_ONLY');
});

test('hidden contests are absent from discovery and 404 outside the member set', async () => {
  const c = await h.createContest(teacher, { name: `Hidden ${Date.now()}`, mode: 'ICPC', visibility: 'hidden' });

  const list = await h.api('/api/contests?role=other', {}, student);
  assert.ok(!list.body.items.some((x) => String(x.id) === String(c.id)), 'hidden contest not listed');

  const anon = await h.api(`/api/contests/${c.id}`);
  assert.equal(anon.status, 404);

  const outsider = await h.api(`/api/contests/${c.id}`, {}, other);
  assert.equal(outsider.status, 404);

  const own = await h.api(`/api/contests/${c.id}`, {}, teacher);
  assert.equal(own.status, 200);
  assert.equal(own.body.access, 'open');
});

test('public contests stay readable without membership; EXAM mode stays members-only', async () => {
  const pub = await h.createContest(teacher, { name: 'Public board', mode: 'ICPC', visibility: 'public' });
  const problems = await h.api(`/api/contests/${pub.id}/problems`);
  assert.equal(problems.status, 200);
  const ranking = await h.api(`/api/contests/${pub.id}/ranking`);
  assert.equal(ranking.status, 200);
  const detail = await h.api(`/api/contests/${pub.id}`);
  assert.equal(detail.body.access, 'open');

  const exam = await h.createContest(teacher, { name: 'Exam must gate', mode: 'EXAM', visibility: 'public' });
  const examDetail = await h.api(`/api/contests/${exam.id}`);
  assert.equal(examDetail.body.visibility, 'members');
  const examProblems = await h.api(`/api/contests/${exam.id}/problems`);
  assert.equal(examProblems.status, 403);
});

test('visibility is validated and can be changed later', async () => {
  const bad = await h.api('/api/contests', { method: 'POST', ...json({ name: 'Bad visibility', visibility: 'everyone' }) }, teacher);
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'INVALID_VISIBILITY');

  const c = await h.createContest(teacher, { name: 'Toggle me', mode: 'ICPC' });
  const open = await h.api(`/api/contests/${c.id}`, { method: 'PATCH', ...json({ visibility: 'public' }) }, teacher);
  assert.equal(open.status, 200);
  assert.equal(open.body.visibility, 'public');

  const legacy = await h.api(`/api/contests/${c.id}`, { method: 'PATCH', ...json({ visibility: 'private' }) }, teacher);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.visibility, 'members');

  const invalid = await h.api(`/api/contests/${c.id}`, { method: 'PATCH', ...json({ visibility: 'nope' }) }, teacher);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'INVALID_VISIBILITY');
});

test('non-members cannot submit to a members-only contest', async () => {
  const c = await h.createContest(teacher, { name: 'Submit gate', mode: 'ICPC' });
  const p = await h.createProblem(c.id, teacher, { code: 'A', name: 'Gated', visibility: 'visible' });
  await h.api(`/api/contests/${c.id}`, { method: 'PATCH', ...json({ lifecycle: 'running' }) }, teacher);
  const denied = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: c.id, problemId: p.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, other);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'NOT_MEMBER');

  const added = await member(c.id, 'jan_kowalski');
  assert.equal(added.status, 201);
  const allowed = await h.api('/api/submits', {
    method: 'POST',
    ...json({ contestId: c.id, problemId: p.id, filename: 'solution.cpp', code: 'int main(){}' }),
  }, student);
  assert.notEqual(allowed.status, 403);
});
