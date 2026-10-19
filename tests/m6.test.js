// M6: S3-8 i18n — server explainers in request language (Accept-Language / ?lang),
// stored as structured keys at judge time and localized at serve time.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m6-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3139';
const BASE = 'http://localhost:3139';

let server;
let teacherTok;
let janId;
let cid;
let pid;

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

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3139, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  const janTok = await loginAs('jan_kowalski', 'student123');
  janId = (await api('/api/me', {}, janTok)).body.id;
  const c = await api('/api/contests', { method: 'POST', ...json({ name: 'i18n pass', mode: 'ICPC' }) }, teacherTok);
  assert.equal(c.status, 201, `contest create: ${JSON.stringify(c.body)}`);
  cid = c.body.id;
  const p = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code: 'A', name: 'P A', visibility: 'visible' }) }, teacherTok);
  assert.equal(p.status, 201, `problem create: ${JSON.stringify(p.body)}`);
  pid = p.body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function waitStatus(id, want, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const r = await api(`/api/submits/${id}`, {}, teacherTok);
    if (r.body.status === want) return r.body;
    if (Date.now() - t0 > timeoutMs) return r.body;
    await new Promise((r2) => setTimeout(r2, 60));
  }
}

test('judge stores explain keys; GET serves them in request language (S3-8)', async () => {
  const { store } = require('../apps/api/src/lib/store');
  const s = store.insert('submits', {
    contestId: cid, problemId: pid, userId: janId, code: 'TLE-TRIGGER', status: 'QUE',
    filename: 'a.py', lang: 'Python', createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 0,
  });
  const rj = await api(`/api/submits/${s.id}/rejudge`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(rj.status, 200);
  const judged = await waitStatus(s.id, 'TLE');
  assert.equal(judged.status, 'TLE', 'fixture submit judged TLE');

  const stored = store.get('submits', s.id);
  assert.equal(stored.explainKey, 'tleHelp', 'structured key stored at judge time');
  assert.ok(Array.isArray(stored.explainArgs), 'explain args stored');

  const pl = await api(`/api/submits/${s.id}?lang=pl`, {}, teacherTok);
  assert.match(pl.body.explain, /Przekroczono limit czasu/, '?lang=pl explains in Polish');
  assert.equal(pl.body.explainKey, undefined, 'internal key not leaked');

  const plAl = await api(`/api/submits/${s.id}`, { headers: { 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8' } }, teacherTok);
  assert.match(plAl.body.explain, /Przekroczono limit czasu/, 'Accept-Language pl honoured');

  const en = await api(`/api/submits/${s.id}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }, teacherTok);
  assert.match(en.body.explain, /Time limit exceeded/, 'Accept-Language en honoured');

  const dflt = await api(`/api/submits/${s.id}`, {}, teacherTok);
  assert.match(dflt.body.explain, /Time limit exceeded/, 'no language header defaults to EN');

  const bad = await api(`/api/submits/${s.id}?lang=de`, {}, teacherTok);
  assert.match(bad.body.explain, /Time limit exceeded/, 'unknown lang falls back to EN');
});

test('list route localizes explain; rows without keys carry none (S3-8)', async () => {
  const { store } = require('../apps/api/src/lib/store');
  const sim = store.insert('submits', {
    contestId: cid, problemId: pid, userId: janId, code: 'x', status: 'TLE', filename: 'a.py', lang: 'Python',
    createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 0,
    explainKey: 'simulatedRun', explainArgs: [],
  });
  const pl = await api(`/api/submits?contest=${cid}&lang=pl`, {}, teacherTok);
  assert.equal(pl.status, 200);
  const row = (pl.body.items || []).find((x) => x.id === sim.id);
  assert.ok(row, 'row present in localized list');
  assert.match(row.explain, /symulowane/, 'list explains in Polish');
  assert.equal(row.explainKey, undefined, 'internal key stripped from list rows');

  const plain = store.insert('submits', {
    contestId: cid, problemId: pid, userId: janId, code: 'y', status: 'WA', filename: 'b.py', lang: 'Python',
    createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 0,
  });
  const none = await api(`/api/submits/${plain.id}?lang=pl`, {}, teacherTok);
  assert.equal(none.status, 200);
  assert.equal(none.body.explain, undefined, 'row without explainKey carries no explain');

  const weird = store.insert('submits', {
    contestId: cid, problemId: pid, userId: janId, code: 'z', status: 'WA', filename: 'c.py', lang: 'Python',
    createdAt: new Date().toISOString(), sampleOnly: false, perTest: [], points: 0,
    explainKey: 'nope', explainArgs: [],
  });
  const w = await api(`/api/submits/${weird.id}?lang=pl`, {}, teacherTok);
  assert.equal(w.status, 200, 'unknown key does not crash');
  assert.equal(w.body.explain, undefined, 'unknown key resolves to undefined');
});
