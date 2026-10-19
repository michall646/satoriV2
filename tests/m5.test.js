// M5: S2-7 real webhook delivery (POST + retries + delivery log + ping) and
// S3-1 contract sweep (score/alias/setter, submit limits + expected/got,
// teammate visibility, ranking me/penaltyMin/unfreezeAt, hidden board gate).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m5-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3138';
process.env.SATORI_WEBHOOK_DELAY_MS = '20';
const BASE = 'http://localhost:3138';

let server;
let teacherTok;
let janTok;
let janId;
let receiver;
let receiverPort;
const received = [];

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
async function addMember(cid, login) {
  const r = await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: login }) }, teacherTok);
  assert.equal(r.status, 200, `members csv: ${JSON.stringify(r.body)}`);
}

async function waitDeliveries(cid, pred, timeoutMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    const r = await api(`/api/contests/${cid}/webhooks/deliveries`, {}, teacherTok);
    const hit = (r.body.items || []).find(pred);
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r2) => setTimeout(r2, 60));
  }
}

before(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (ch) => { body += ch; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* keep null */ }
      received.push({ event: req.headers['x-satori-event'] || null, body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  receiverPort = receiver.address().port;

  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3138, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  janTok = await loginAs('jan_kowalski', 'student123');
  janId = (await api('/api/me', {}, janTok)).body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (receiver.closeAllConnections) receiver.closeAllConnections();
  await new Promise((r) => receiver.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('webhook delivery: real POST, retries, delivery log, ping (S2-7)', async () => {
  const cid = await mkContest('Hooks');
  const pid = await mkProblem(cid, 'A');

  const good = await api(`/api/contests/${cid}/webhooks`, { method: 'POST', ...json({ url: `http://127.0.0.1:${receiverPort}/hook`, events: ['limit.changed', 'rejudge.done'] }) }, teacherTok);
  assert.equal(good.status, 201);

  await api(`/api/problems/${pid}`, { method: 'PATCH', ...json({ limits: { timeMs: 2000, memoryMb: 256, stackMb: 64, perLang: {} } }) }, teacherTok);
  const okRow = await waitDeliveries(cid, (d) => d.event === 'limit.changed' && d.ok);
  assert.ok(okRow, 'successful delivery recorded');
  assert.equal(okRow.httpStatus, 200);
  assert.equal(okRow.attempts, 1, 'no retries needed on success');
  const got = received.find((r) => r.event === 'limit.changed');
  assert.ok(got, 'receiver saw the POST');
  assert.equal(got.body.payload.problemId, pid, 'payload carries problemId');
  assert.equal(got.body.payload.contestId, cid, 'payload carries contestId');

  const bad = await api(`/api/contests/${cid}/webhooks`, { method: 'POST', ...json({ url: 'http://127.0.0.1:1/nope', events: ['limit.changed'] }) }, teacherTok);
  assert.equal(bad.status, 201);
  await api(`/api/problems/${pid}`, { method: 'PATCH', ...json({ limits: { timeMs: 3000, memoryMb: 256, stackMb: 64, perLang: {} } }) }, teacherTok);
  const failRow = await waitDeliveries(cid, (d) => d.event === 'limit.changed' && !d.ok && d.hookId === bad.body.id);
  assert.ok(failRow, 'failed delivery recorded');
  assert.equal(failRow.attempts, 4, 'initial + 3 retries');
  assert.ok(failRow.error, 'error reason stored');

  const ping = await api(`/api/contests/${cid}/webhooks/${good.body.id}/ping`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(ping.status, 200);
  assert.equal(ping.body.delivered, true, 'ping performs a real request');
  assert.match(ping.body.message, /Delivered/);

  const denied = await api(`/api/contests/${cid}/webhooks/deliveries`, {}, janTok);
  assert.equal(denied.status, 403, 'delivery log is admin-only');
});

test('submit.judged + rejudge.done delivered after queue drains (S2-7)', async () => {
  const cid = await mkContest('Hooks judged');
  const pid = await mkProblem(cid, 'A');
  const reg = await api(`/api/contests/${cid}/webhooks`, { method: 'POST', ...json({ url: `http://127.0.0.1:${receiverPort}/judged`, events: ['submit.judged', 'rejudge.done'] }) }, teacherTok);
  assert.equal(reg.status, 201);

  const { store } = require('../apps/api/src/lib/store');
  const s = store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'CE-TRIGGER', status: 'OK', filename: 'a.cpp', lang: 'C++17', createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 0 });
  const rj = await api(`/api/submits/${s.id}/rejudge`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(rj.status, 200);

  const judgedRow = await waitDeliveries(cid, (d) => d.event === 'submit.judged' && d.ok);
  assert.ok(judgedRow, 'submit.judged delivered');
  const doneRow = await waitDeliveries(cid, (d) => d.event === 'rejudge.done' && d.ok);
  assert.ok(doneRow, 'rejudge.done delivered');
  assert.equal(store.get('submits', s.id).status, 'CE', 'queue drained before rejudge.done fired');
  const payload = received.find((r) => r.event === 'rejudge.done');
  assert.equal(payload.body.payload.submitId, s.id, 'rejudge payload carries the submit');
});

test('contract: problems carry _score/alias/setter, submits carry limits + expected/got (S3-1)', async () => {
  const cid = await mkContest('Contract');
  const pid = await mkProblem(cid, 'A');
  await addMember(cid, 'jan_kowalski');
  const { store } = require('../apps/api/src/lib/store');
  const at = new Date().toISOString();
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'x', status: 'WA', filename: 'a.cpp', lang: 'C++17', createdAt: at, sampleOnly: false, perTest: [{ n: 1, verdict: 'WA', expected: '5', got: '4' }], perTestFull: [{ n: 1, verdict: 'WA', expected: '5', got: '4' }], points: 0 });
  const okSub = store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'int main(){}', status: 'OK', filename: 'b.cpp', lang: 'C++17', createdAt: at, sampleOnly: false, perTest: [{ n: 1, verdict: 'OK' }], perTestFull: [{ n: 1, verdict: 'OK' }], points: 100 });

  const probs = await api(`/api/contests/${cid}/problems`, {}, janTok);
  assert.equal(probs.status, 200);
  const pA = probs.body.items.find((x) => x.id === pid);
  assert.equal(pA._score, 100, '_score = caller best points');
  assert.equal(pA.alias, 'A', 'alias resolved');
  assert.equal(pA.setter, 'g_herman', 'setter resolves to creator login');
  assert.equal(pA.solvesPct, 100, 'solvesPct present');
  assert.ok('group' in pA, 'group key present');

  const det = await api(`/api/submits/${okSub.id}`, {}, janTok);
  assert.equal(det.body.limitMs, 1000, 'limitMs on submit');
  assert.equal(det.body.limitMb, 256, 'limitMb on submit');

  const list = await api(`/api/submits?contest=${cid}&me=1`, {}, janTok);
  const wa = list.body.items.find((x) => x.status === 'WA');
  const detWa = await api(`/api/submits/${wa.id}`, {}, janTok);
  assert.equal(detWa.body.expected, '5', 'expected from first failing test');
  assert.equal(detWa.body.got, '4', 'got from first failing test');
});

test('contract: hidden verdict detail strips expected/got (negative)', async () => {
  const cid = await mkContest('Hidden detail');
  const pid = await mkProblem(cid, 'A');
  const { store } = require('../apps/api/src/lib/store');
  const s = store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'x', status: 'WA', filename: 'a.cpp', lang: 'C++17', createdAt: new Date().toISOString(), sampleOnly: false, perTest: [{ n: 1, verdict: 'WA', expected: '5', got: '4' }], perTestFull: [{ n: 1, verdict: 'WA', expected: '5', got: '4' }], points: 0 });
  store.update('contests', cid, { lifecycle: 'running', settings: { ...(store.get('contests', cid).settings || {}), verdictVisibility: 'none' }, members: [janId] });
  const det = await api(`/api/submits/${s.id}`, {}, janTok);
  assert.equal(det.status, 200);
  assert.equal(det.body.perTestFull, undefined, 'full test data hidden while running');
  assert.equal(det.body.expected, undefined, 'expected hidden while running');
});

test('contract: ranking me row, canonical penaltyMin, unfreezeAt, hidden board gate (S3-1)', async () => {
  const cid = await mkContest('Rank contract');
  const pid = await mkProblem(cid, 'A');
  await addMember(cid, 'jan_kowalski');
  const { store } = require('../apps/api/src/lib/store');
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'x', status: 'OK', filename: 'a.cpp', lang: 'C++17', createdAt: new Date().toISOString(), sampleOnly: false, points: 100 });

  const rank = await api(`/api/contests/${cid}/ranking`, {}, janTok);
  assert.equal(rank.status, 200);
  assert.equal(rank.body.me.rank, 1, 'caller standing in payload');
  assert.equal(rank.body.penaltyMin, 20, 'penaltyMin surfaced');

  const cRow = store.get('contests', cid);
  store.update('contests', cid, { settings: { ...(cRow.settings || {}), penaltyMin: 7, scoring: { wrongTryMin: 99 } } });
  const rank2 = await api(`/api/contests/${cid}/ranking`);
  assert.equal(rank2.body.penaltyMin, 7, 'settings.penaltyMin is canonical');
  assert.equal(rank2.body.me, null, 'anon gets no me row');

  const endAt = new Date(Date.now() + 3600000).toISOString();
  store.update('contests', cid, { freezeAt: new Date().toISOString(), endAt });
  const rank3 = await api(`/api/contests/${cid}/ranking`);
  assert.equal(rank3.body.unfreezeAt, endAt, 'unfreezeAt = contest end while frozen');

  store.update('contests', cid, { settings: { ...store.get('contests', cid).settings, board: { mode: 'hidden' } } });
  const blocked = await api(`/api/contests/${cid}/ranking`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'BOARD_HIDDEN', 'public board hidden');
  const memberBlocked = await api(`/api/contests/${cid}/ranking`, {}, janTok);
  assert.equal(memberBlocked.status, 403, 'students blocked while board hidden');
  const adminOk = await api(`/api/contests/${cid}/ranking`, {}, teacherTok);
  assert.equal(adminOk.status, 200, 'admins still see it');
});

test('contract: teammate sees the team submission with member list (S3-1)', async () => {
  const cid = await mkContest('Teams m5');
  const pid = await mkProblem(cid, 'A');
  const reg = await api('/api/auth/register', { method: 'POST', ...json({ login: 'm5mate', email: 'm5mate@uj.edu.pl', password: 'secret12', firstName: 'M', lastName: 'Five' }) });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const mateTok = await loginAs('m5mate', 'secret12');
  const mateId = (await api('/api/me', {}, mateTok)).body.id;
  const { store } = require('../apps/api/src/lib/store');
  const team = store.insert('teams', { contestId: cid, scoreboardName: 'M5', members: [janId, mateId] });
  const ts = store.insert('submits', { contestId: cid, problemId: pid, userId: janId, teamId: team.id, code: 'int main(){}', status: 'OK', filename: 't.cpp', lang: 'C++17', createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 100 });

  const mateView = await api(`/api/submits/${ts.id}`, {}, mateTok);
  assert.equal(mateView.status, 200);
  assert.equal(mateView.body.code, 'int main(){}', 'teammate sees the team submission');
  assert.deepEqual((mateView.body.members || []).slice().sort(), ['jan_kowalski', 'm5mate'].sort(), 'member list carried');

  const manager = await api(`/api/submits/${ts.id}`, {}, teacherTok);
  assert.equal((manager.body.members || []).length, 2, 'manager view carries members too');
});
