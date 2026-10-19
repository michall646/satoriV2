// M3 smalls: member roles (S2-9), solvesPct on problems list (S3-6), case checker persisted (S3-11).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m4-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3137';
const BASE = 'http://localhost:3137';

let server;
let teacherTok;
let janTok;
let janId;

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

let seq = 0;
async function mkContest(name, mode = 'ICPC') {
  seq += 1;
  const r = await api('/api/contests', { method: 'POST', ...json({ name: `${name} #${seq}`, mode }) }, teacherTok);
  assert.equal(r.status, 201, `contest create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function mkProblem(cid, code) {
  const r = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code, name: `P ${code}`, visibility: 'visible' }) }, teacherTok);
  assert.equal(r.status, 201, `problem create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3137, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  janTok = await loginAs('jan_kowalski', 'student123');
  janId = (await api('/api/me', {}, janTok)).body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('member roles: grant teacher/jury via POST (S2-9)', async () => {
  const cid = await mkContest('Roles');

  const denied = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'jan_kowalski', role: 'teacher' }) }, janTok);
  assert.equal(denied.status, 403, 'students cannot grant roles');
  const unknown = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'no_such_user', role: 'teacher' }) }, teacherTok);
  assert.equal(unknown.status, 404, 'unknown login rejected');
  const badRole = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'jan_kowalski', role: 'wizard' }) }, teacherTok);
  assert.equal(badRole.status, 422, 'unknown role rejected');

  const grant = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'jan_kowalski', role: 'teacher' }) }, teacherTok);
  assert.equal(grant.status, 201);
  assert.equal(grant.body.role, 'teacher');
  const again = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'jan_kowalski', role: 'jury' }) }, teacherTok);
  assert.equal(again.status, 201, 'role change teacher -> jury');
  const same = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'jan_kowalski', role: 'jury' }) }, teacherTok);
  assert.equal(same.status, 200, 'idempotent for the same role');

  const list = await api(`/api/contests/${cid}/members`, {}, teacherTok);
  assert.ok(list.body.members.some((m) => m.login === 'jan_kowalski'), 'granted member visible');

  // proof of power: jan (now contest admin) can seed bank problems / delete-proof action: set exam
  const exam = await api(`/api/contests/${cid}/exam`, { method: 'PATCH', ...json({ settings: { fullscreen: true } }) }, janTok);
  assert.equal(exam.status, 200, 'granted teacher can manage the contest');

  const p = await api(`/api/contests/${cid}/members`, { method: 'POST', ...json({ login: 'admin', role: 'participant' }) }, teacherTok);
  assert.equal(p.status, 201);
  assert.equal(p.body.role, 'participant');
});

test('problems list carries solvesPct (S3-6)', async () => {
  const cid = await mkContest('Pct');
  const a = await mkProblem(cid, 'A');
  const b = await mkProblem(cid, 'B');
  await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: 'jan_kowalski' }) }, teacherTok);
  const { store } = require('../apps/api/src/lib/store');
  const at = new Date().toISOString();
  store.insert('submits', { contestId: cid, problemId: a, userId: janId, code: 'x', status: 'OK', filename: 'a.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });
  store.insert('submits', { contestId: cid, problemId: b, userId: janId, code: 'x', status: 'WA', filename: 'b.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });

  const r = await api(`/api/contests/${cid}/problems`, {}, janTok);
  assert.equal(r.status, 200);
  const pA = r.body.items.find((x) => x.id === a);
  const pB = r.body.items.find((x) => x.id === b);
  assert.equal(pA.solvesPct, 100, 'solved by the only member');
  assert.equal(pB.solvesPct, 0, 'never solved');
});

test('case create persists the group checker (S3-11)', async () => {
  const cid = await mkContest('Checker');
  const pid = await mkProblem(cid, 'A');
  const g = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'all', points: 100, checker: 'float10' } }) }, teacherTok);
  assert.equal(g.status, 201);
  assert.equal(g.body.checker, 'float10', 'group keeps its checker');
  const c = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g.body.id, name: 'c1', input: '1', expected: '1', checker: g.body.checker } }) }, teacherTok);
  assert.equal(c.status, 201);
  const { store } = require('../apps/api/src/lib/store');
  assert.equal(store.get('testCases', c.body.id).checker, 'float10', 'case inherits group checker');
});
