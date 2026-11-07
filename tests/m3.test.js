// M3 quick wins: contests list filters + ranking.csv (S2-8), results truth incl. team filter
// and server-side code ZIP (S3-2), bulk-extend shifting real deadlines (S3-3),
// ICS useful with or without late policy (S3-4), honest status (S3-5).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m3-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3136';
const BASE = 'http://localhost:3136';

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
async function addMember(cid, login) {
  const r = await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: login }) }, teacherTok);
  assert.equal(r.status, 200, `members csv: ${JSON.stringify(r.body)}`);
}

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3136, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  janTok = await loginAs('jan_kowalski', 'student123');
  janId = (await api('/api/me', {}, janTok)).body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('contests list: archived toggle + role=other (S2-8)', async () => {
  const c1 = await mkContest('Archived one');
  const c2 = await mkContest('Joined one');
  const c4 = await mkContest('Other one');

  const del = await api(`/api/contests/${c1}`, { method: 'DELETE' }, teacherTok);
  assert.equal(del.status, 200);
  assert.equal(del.body.archived, true, 'first DELETE archives');

  const plain = await api('/api/contests', {}, teacherTok);
  assert.ok(!plain.body.items.some((c) => String(c.id) === String(c1)), 'archived hidden by default');
  const yes = await api('/api/contests?archived=yes', {}, teacherTok);
  assert.ok(yes.body.items.some((c) => String(c.id) === String(c1)), 'archived=yes shows it (lowercase accepted)');
  const caps = await api('/api/contests?archived=Yes', {}, teacherTok);
  assert.ok(caps.body.items.some((c) => String(c.id) === String(c1)), 'archived=Yes still accepted');

  await addMember(c2, 'jan_kowalski');
  // B10: drafts are hidden from non-admins; open registration so c4 is discoverable.
  const open = await api(`/api/contests/${c4}`, { method: 'PATCH', ...json({ lifecycle: 'registration' }) }, teacherTok);
  assert.equal(open.status, 200);
  const other = await api('/api/contests?role=other', {}, janTok);
  assert.ok(!other.body.items.some((c) => String(c.id) === String(c2)), 'joined contest not in other');
  assert.ok(other.body.items.some((c) => String(c.id) === String(c4)), 'unjoined contest listed in other');
  const joined = await api('/api/contests?role=joined', {}, janTok);
  assert.ok(joined.body.items.some((c) => String(c.id) === String(c2)), 'joined tab shows it');
});

test('ranking.csv downloads the real scoreboard (S2-8)', async () => {
  const cid = await mkContest('Ranking csv');
  const pid = await mkProblem(cid, 'A');
  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ visibility: 'public' }) }, teacherTok);
  await addMember(cid, 'jan_kowalski');
  const { store } = require('../apps/api/src/lib/store');
  const at = new Date().toISOString();
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'x', status: 'WA', filename: 'b.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'int main(){}', status: 'OK', filename: 'a.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });

  const rank = await api(`/api/contests/${cid}/ranking`, {}, teacherTok);
  assert.equal(rank.status, 200);
  assert.ok((rank.body.rows || []).length >= 1, 'JSON ranking still works after refactor');

  const res = await fetch(`${BASE}/api/contests/${cid}/ranking.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const lines = (await res.text()).split('\n');
  assert.equal(lines[0], 'rank,contestant,A,total');
  const janLine = lines.find((l) => l.includes('jan_kowalski'));
  assert.ok(janLine, 'contestant row present');
  assert.equal(janLine.split(',').length, 4, 'one cell per problem + total');
  assert.match(janLine.split(',')[2], /\(/, 'solved cell carries time text');
  assert.ok(Number(janLine.split(',')[3]) >= 1, 'total counts the solve');
});

test('grade.ics is useful with or without late policy (S3-4)', async () => {
  const cid = await mkContest('ICS, test');
  const pid = await mkProblem(cid, 'A');
  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ visibility: 'public' }) }, teacherTok);
  const { store } = require('../apps/api/src/lib/store');
  store.update('contests', cid, { startAt: new Date().toISOString(), endAt: new Date(Date.now() + 86400000).toISOString() });

  const res = await fetch(`${BASE}/api/contests/${cid}/grade.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/calendar/);
  const body = await res.text();
  assert.ok(body.includes('BEGIN:VCALENDAR'));
  assert.ok(body.includes('contest-start@satori'), 'start event present');
  assert.ok(body.includes('contest-end@satori'), 'end event present');
  assert.ok(body.includes(`problem-${pid}@satori`), 'problem deadline event present with default policy off');
  assert.ok(body.includes('SUMMARY:ICS\\, test'), 'comma escaped in summary');
});

test('bulk-extend shifts contest + explicit deadlines (S3-3)', async () => {
  const cid = await mkContest('Extend me');
  const pid = await mkProblem(cid, 'A');
  const { store } = require('../apps/api/src/lib/store');
  const startAt = new Date().toISOString();
  const endAt = new Date(Date.now() + 86400000).toISOString();
  const defDl = new Date(Date.now() + 43200000).toISOString();
  store.update('contests', cid, { startAt, endAt, settings: { defaultDeadline: defDl } });
  const prDeadline = new Date(Date.now() + 21600000).toISOString();
  store.update('problems', pid, { deadlineAt: prDeadline });
  const set = store.insert('problemSets', { contestId: cid, name: 'S1', deadlineAt: prDeadline });

  const bad = await api(`/api/contests/${cid}/deadlines/bulk-extend`, { method: 'POST', ...json({ days: 0 }) }, teacherTok);
  assert.equal(bad.status, 422, 'zero days rejected');
  const denied = await api(`/api/contests/${cid}/deadlines/bulk-extend`, { method: 'POST', ...json({ days: 7 }) }, janTok);
  assert.equal(denied.status, 403, 'students cannot extend');

  const ok = await api(`/api/contests/${cid}/deadlines/bulk-extend`, { method: 'POST', ...json({ days: 7 }) }, teacherTok);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.shifted >= 2, 'problem + set deadlines shifted');

  const c2 = store.get('contests', cid);
  assert.equal(new Date(c2.endAt).getTime() - new Date(endAt).getTime(), 7 * 86400000, 'endAt +7d');
  assert.equal(new Date(c2.startAt).getTime() - new Date(startAt).getTime(), 7 * 86400000, 'startAt +7d');
  assert.equal(new Date(c2.settings.defaultDeadline).getTime() - new Date(defDl).getTime(), 7 * 86400000, 'defaultDeadline +7d');
  const p2 = store.get('problems', pid);
  assert.equal(new Date(p2.deadlineAt).getTime() - new Date(prDeadline).getTime(), 7 * 86400000, 'explicit problem deadline +7d');
  const s2 = store.get('problemSets', set.id);
  assert.equal(new Date(s2.deadlineAt).getTime() - new Date(prDeadline).getTime(), 7 * 86400000, 'set deadline +7d');
});

test('status tells the truth about the runner (S3-5)', async () => {
  const r = await fetch(`${BASE}/api/status`);
  const s = await r.json();
  assert.equal(s.workers[0], 'worker_thread', 'real worker label');
  assert.equal(s.persistentQueue, true, 'persistent queue stated');
  assert.ok(Array.isArray(s.languages) && s.languages.length >= 1, 'real language availability');
  assert.equal(s.maintenance, null, 'no permanent maintenance banner (web hides it)');
  assert.match(String(s.etaNote || ''), /estimate/, 'ETA labelled as estimate');
  assert.match(String(s.sandbox || ''), /memory/i, 'sandbox gap stated');
});

test('submits team filter + server ZIP of own codes (S3-2)', async () => {
  const cid = await mkContest('Teams zip');
  const pid = await mkProblem(cid, 'A');
  const { store } = require('../apps/api/src/lib/store');
  const at = new Date().toISOString();
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, teamId: 'T1', code: 'int main(){return 0;}', status: 'OK', filename: 'team.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });
  store.insert('submits', { contestId: cid, problemId: pid, userId: janId, code: 'int main(){}', status: 'WA', filename: 'solo.cpp', lang: 'C++17', createdAt: at, sampleOnly: false });

  const t1 = await api(`/api/submits?contest=${cid}&team=T1`, {}, teacherTok);
  assert.equal(t1.body.total, 1, 'team filter applied server-side');
  assert.equal(t1.body.items.length, 1);
  const t9 = await api(`/api/submits?contest=${cid}&team=T9`, {}, teacherTok);
  assert.equal(t9.body.total, 0, 'other team id empty');

  const zres = await fetch(`${BASE}/api/submits/codes.zip?contest=${cid}`, { headers: { Authorization: `Bearer ${janTok}` } });
  assert.equal(zres.status, 200);
  assert.match(zres.headers.get('content-type') || '', /application\/zip/);
  const buf = Buffer.from(await zres.arrayBuffer());
  assert.equal(buf[0], 0x50, 'PK local header');
  assert.equal(buf[1], 0x4b);
  assert.ok(buf.includes(Buffer.from('PK\u0005\u0006')), 'end-of-central-directory present');
  const latin = buf.toString('latin1');
  assert.ok(latin.includes('submit-'), 'entries named submit-<id>-<file>');
  assert.ok(latin.includes('team.cpp') || latin.includes('solo.cpp'), 'source filenames inside zip');

  const denied = await fetch(`${BASE}/api/submits/codes.zip`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  assert.equal(denied.status, 404, 'no own submits -> honest 404');
});
