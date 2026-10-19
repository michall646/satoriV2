// M2 integration: grade preview/feedback/export (S2-4, S4-1), integrity wiring (S2-5),
// exam schema (S2-6), me: sessions/teams/password (S3-7), submits pagination (S3-9).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-m2-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3135';
const BASE = 'http://localhost:3135';

let server;
let teacherTok;
let janTok;
let janTwo;
let studentId;

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
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const d = await api(`/api/submits/${id}`, {}, tok);
    if (!['QUE', 'CMP', 'TST'].includes(d.body.status)) return d.body;
  }
  return null;
}

const SUM_CODE = '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int a,b;if(!(cin>>a>>b))return 0;cout<<a+b;}';
const FAST_LIMITS = { timeMs: 2000, memoryMb: 256, stackMb: 64, perLang: { Java: 8000, Python: 5000, Rust: 5000, JavaScript: 5000, 'C++17': 5000, C: 5000 } };

let seq = 0;
async function mkContest(name, mode = 'ICPC') {
  seq += 1;
  const r = await api('/api/contests', { method: 'POST', ...json({ name: `${name} #${seq}`, mode }) }, teacherTok);
  assert.equal(r.status, 201, `contest create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function mkProblem(cid, code, limits = null) {
  const r = await api(`/api/contests/${cid}/problems`, { method: 'POST', ...json({ code, name: `P ${code}`, visibility: 'visible', ...(limits ? { limits } : {}) }) }, teacherTok);
  assert.equal(r.status, 201, `problem create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function addCase(pid, input, expected) {
  const g = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ group: { name: 'all', points: 100 } }) }, teacherTok);
  assert.equal(g.status, 201);
  const c = await api(`/api/problems/${pid}/tests`, { method: 'POST', ...json({ case: { groupId: g.body.id, input, expected } }) }, teacherTok);
  assert.equal(c.status, 201);
}
async function submit(tok, pid, filename, code, cid = null) {
  return api('/api/submits', { method: 'POST', ...json({ contestId: cid, problemId: pid, filename, code }) }, tok);
}
async function addMember(cid, login) {
  const r = await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: login }) }, teacherTok);
  assert.equal(r.status, 200, `members csv: ${JSON.stringify(r.body)}`);
}
async function setRunning(cid) {
  const r = await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ lifecycle: 'running' }) }, teacherTok);
  assert.equal(r.status, 200);
}

let parityCid;
let parityTotal;

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3135, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  janTok = await loginAs('jan_kowalski', 'student123');
  studentId = (await api('/api/me', {}, janTok)).body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('grade preview matches /grade on defaults (S2-4)', async () => {
  const cid = await mkContest('Preview parity', 'LABS');
  parityCid = cid;
  const a = await mkProblem(cid, 'A', FAST_LIMITS);
  const b = await mkProblem(cid, 'B', FAST_LIMITS);
  await api(`/api/problems/${a}`, { method: 'PATCH', ...json({ weight: 2 }) }, teacherTok);
  await addCase(a, '2 3\n', '5\n');
  await addCase(b, '2 3\n', '999\n');
  await setRunning(cid);
  await addMember(cid, 'jan_kowalski');

  const ok = await submit(janTok, a, 'sol.cpp', SUM_CODE, cid);
  assert.equal(ok.status, 201);
  assert.equal((await waitJudged(ok.body.id, janTok)).status, 'OK');
  const wa = await submit(janTok, b, 'sol.cpp', SUM_CODE, cid);
  assert.equal(wa.status, 201);
  assert.equal((await waitJudged(wa.body.id, janTok)).status, 'WA');

  const grade = await api(`/api/contests/${cid}/grade?user=${studentId}`, {}, teacherTok);
  assert.equal(grade.status, 200);
  parityTotal = grade.body.total;
  assert.equal(parityTotal, 66.7, 'weighted 2:1 with one WA');

  const prev = await api(`/api/contests/${cid}/grade/preview`, { method: 'POST', ...json({}) }, teacherTok);
  assert.equal(prev.status, 200);
  const row = (prev.body.rows || []).find((x) => x.login === 'jan_kowalski');
  assert.ok(row, 'student present in preview rows');
  assert.equal(row.total, parityTotal, 'preview default == /grade');

  const prevStudent = await api(`/api/contests/${cid}/grade/preview`, { method: 'POST', ...json({ student: 'jan_kowalski' }) }, teacherTok);
  assert.equal(prevStudent.body.student.total, parityTotal);
  assert.equal(prevStudent.body.student.grade, grade.body.grade);

  const denied = await api(`/api/contests/${cid}/grade/preview`, { method: 'POST', ...json({}) }, janTok);
  assert.equal(denied.status, 403, 'student cannot preview');
});

test('bulk feedback notifies students (S2-4)', async () => {
  const fb = await api(`/api/contests/${parityCid}/grade/feedback`, { method: 'POST', ...json({ filter: 'WA', text: 'Please check edge cases.' }) }, teacherTok);
  assert.equal(fb.status, 200);
  assert.ok(fb.body.count >= 1, 'matched the WA submit');
  assert.ok(fb.body.users >= 1, 'at least one user notified');

  const notif = await api('/api/notifications', {}, janTok);
  assert.ok((notif.body.items || []).some((n) => n.type === 'grade.feedback'), 'student received feedback notification');

  const denied = await api(`/api/contests/${parityCid}/grade/feedback`, { method: 'POST', ...json({ text: 'x' }) }, janTok);
  assert.equal(denied.status, 403, 'student cannot post bulk feedback');
  const empty = await api(`/api/contests/${parityCid}/grade/feedback`, { method: 'POST', ...json({ filter: 'WA', text: '' }) }, teacherTok);
  assert.equal(empty.status, 422, 'text required');
});

test('grade CSV export is server-side, scaled and admin-only (S4-1)', async () => {
  const res = await fetch(`${BASE}/api/contests/${parityCid}/grade/export.csv`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const lines = (await res.text()).split('\n');
  assert.match(lines[0], /^login,usos_id,first_name,last_name,email,total,pct,grade,/);
  const janLine = lines.find((l) => l.startsWith('jan_kowalski,'));
  assert.ok(janLine, 'jan in export');
  const cols = janLine.split(',');
  assert.equal(Number(cols[5]), parityTotal, 'total matches /grade');
  assert.equal(Number(cols[7]), 3, '66.7% -> grade 3 on default scale');

  const res5 = await fetch(`${BASE}/api/contests/${parityCid}/grade/export.csv?scale=${encodeURIComponent('0:5')}`, { headers: { Authorization: `Bearer ${teacherTok}` } });
  const line5 = (await res5.text()).split('\n').find((l) => l.startsWith('jan_kowalski,'));
  assert.equal(Number(line5.split(',')[7]), 5, 'custom scale honoured');

  const denied = await fetch(`${BASE}/api/contests/${parityCid}/grade/export.csv`, { headers: { Authorization: `Bearer ${janTok}` } });
  assert.equal(denied.status, 403, 'student cannot export');
});

test('submits list paginates with total (S3-9)', async () => {
  const p1 = await api(`/api/submits?contest=${parityCid}&limit=1&offset=0`, {}, teacherTok);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.items.length, 1);
  assert.ok(p1.body.total >= 2, 'total reported, no silent cap');
  const p2 = await api(`/api/submits?contest=${parityCid}&limit=1&offset=1`, {}, teacherTok);
  assert.equal(p2.body.items.length, 1);
  assert.notEqual(p1.body.items[0].id, p2.body.items[0].id, 'offset pages differ');
  const p3 = await api(`/api/submits?contest=${parityCid}&limit=5&offset=${p1.body.total}`, {}, teacherTok);
  assert.equal(p3.body.items.length, 0, 'beyond total is empty');
});

test('integrity: similarity, timeline, appeals + exam schema (S2-5, S2-6)', async () => {
  const cid = await mkContest('Integrity', 'ICPC');
  const adminTok = await loginAs('admin', 'admin123');

  const deniedExam = await api(`/api/contests/${cid}/exam`, {}, janTok);
  assert.equal(deniedExam.status, 403, 'non-member cannot read exam settings');

  await addMember(cid, 'jan_kowalski');
  await setRunning(cid);

  const badPatch = await api(`/api/contests/${cid}/exam`, { method: 'PATCH', ...json({ settings: { fullscreen: true } }) }, janTok);
  assert.equal(badPatch.status, 403, 'member cannot patch exam');
  const patch = await api(`/api/contests/${cid}/exam`, { method: 'PATCH', ...json({ settings: { fullscreen: true, pasteBlock: true, ipAllow: '10.0.0.0/8', timeWindow: '09:00-11:00' } }) }, teacherTok);
  assert.equal(patch.status, 200);
  assert.equal(patch.body.settings.ipAllow, '10.0.0.0/8');
  const legacy = await api(`/api/contests/${cid}/exam`, { method: 'PATCH', ...json({ ips: '1.2.3.4', tokens: 'window-1' }) }, teacherTok);
  assert.equal(legacy.body.settings.ipAllow, '1.2.3.4', 'legacy ips unified into ipAllow');
  assert.equal(legacy.body.settings.timeWindow, 'window-1', 'legacy tokens unified into timeWindow');
  const get = await api(`/api/contests/${cid}/exam`, {}, janTok);
  assert.equal(get.status, 200);
  assert.equal(get.body.settings.fullscreen, true);
  assert.equal(get.body.settings.ipAllow, '1.2.3.4');

  const vpost = await api(`/api/contests/${cid}/exam/violations`, { method: 'POST', ...json({ type: 'paste' }) }, janTok);
  assert.equal(vpost.status, 201);
  const vAdmin = await api(`/api/contests/${cid}/exam/violations`, {}, teacherTok);
  assert.equal(vAdmin.status, 200);
  assert.ok(vAdmin.body.count >= 1);
  const vDenied = await api(`/api/contests/${cid}/exam/violations`, {}, janTok);
  assert.equal(vDenied.status, 403, 'student cannot read violation log');

  // F3: clear the exam network window before the submit checks below. The schema
  // assertions above already proved ipAllow/timeWindow are stored canonically.
  const cleared = await api(`/api/contests/${cid}/exam`, { method: 'PATCH', ...json({ settings: { fullscreen: false, pasteBlock: false, shuffle: false, ipAllow: '', timeWindow: '' } }) }, teacherTok);
  assert.equal(cleared.status, 200);

  const pid = await mkProblem(cid, 'S', FAST_LIMITS);
  await addCase(pid, '2 3\n', '5\n');
  const s1 = await submit(janTok, pid, 'sol.cpp', SUM_CODE, cid);
  assert.equal(s1.status, 201);
  assert.equal((await waitJudged(s1.body.id, janTok)).status, 'OK');
  const s2 = await submit(adminTok, pid, 'sol.cpp', SUM_CODE, cid);
  assert.equal(s2.status, 201);
  assert.equal((await waitJudged(s2.body.id, adminTok)).status, 'OK');

  const sim = await api(`/api/contests/${cid}/integrity/similarity?threshold=0.5`, {}, teacherTok);
  assert.equal(sim.status, 200);
  assert.ok(sim.body.pairs.length >= 1, 'identical code flagged');
  assert.ok(sim.body.pairs[0].score >= 0.85, 'high similarity');
  assert.ok(String(sim.body.pairs[0].codeA).includes('main'), 'codes included for DiffView');
  const simDenied = await api(`/api/contests/${cid}/integrity/similarity`, {}, janTok);
  assert.equal(simDenied.status, 403, 'students never see similarity');

  const tl = await api(`/api/contests/${cid}/integrity/timeline`, {}, teacherTok);
  assert.equal(tl.status, 200);
  assert.ok(tl.body.count >= 1, 'rapid-after-peer flag');
  assert.ok(String(tl.body.flags[0].text || '').length > 0, 'flag has human text');

  const { store } = require('../apps/api/src/lib/store');
  const appeal = store.insert('appeals', { contestId: cid, userId: studentId, text: 'please recheck verdict', status: 'open', at: new Date().toISOString() });
  const appeals = await api(`/api/contests/${cid}/integrity/appeals`, {}, teacherTok);
  assert.equal(appeals.status, 200);
  assert.ok(appeals.body.items.some((a) => a.id === appeal.id && a.student === 'jan_kowalski'), 'open appeal listed with student login');
  const appealsDenied = await api(`/api/contests/${cid}/integrity/appeals`, {}, janTok);
  assert.equal(appealsDenied.status, 403);
  const resolveDenied = await api(`/api/contests/${cid}/integrity/appeals/${appeal.id}`, { method: 'POST', ...json({ verdict: 'upheld' }) }, janTok);
  assert.equal(resolveDenied.status, 403, 'student cannot resolve appeals');
  const resolve = await api(`/api/contests/${cid}/integrity/appeals/${appeal.id}`, { method: 'POST', ...json({ verdict: 'upheld' }) }, teacherTok);
  assert.equal(resolve.status, 200);
  const appealsAfter = await api(`/api/contests/${cid}/integrity/appeals`, {}, teacherTok);
  assert.ok(!appealsAfter.body.items.some((a) => a.id === appeal.id), 'resolved appeal leaves the open list');
});

test('me: sessions list, per-device revoke, teams (S3-7)', async () => {
  const tok2 = await loginAs('jan_kowalski', 'student123');
  janTwo = tok2;

  const list = await api('/api/me/sessions', {}, tok2);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 2, 'two live sessions');
  assert.equal(list.body.items.filter((s) => s.current).length, 1, 'exactly one current');
  assert.ok(list.body.items.every((s) => s.id && s.device), 'sessions carry id + device');

  const meResp = await api('/api/me', {}, tok2);
  assert.ok(Array.isArray(meResp.body.sessions), '/api/me carries sessions');
  assert.ok(Array.isArray(meResp.body.teams), '/api/me carries teams');
  const teams = await api('/api/me/teams', {}, tok2);
  assert.equal(teams.status, 200);
  assert.ok(Array.isArray(teams.body.items));

  const other = list.body.items.find((s) => !s.current);
  const del = await api(`/api/me/sessions/${other.id}`, { method: 'DELETE' }, tok2);
  assert.equal(del.status, 200);
  const stale = await api('/api/me', {}, janTok);
  assert.equal(stale.status, 401, 'revoked device token rejected');
  const after = await api('/api/me/sessions', {}, tok2);
  assert.equal(after.body.items.length, list.body.items.length - 1);
});

test('me: password change verifies old, revokes other sessions (S3-7)', async () => {
  const wrong = await api('/api/me/password', { method: 'POST', ...json({ old: 'nope-nope', new: 'password456' }) }, janTwo);
  assert.equal(wrong.status, 403, 'wrong current password rejected');
  const short = await api('/api/me/password', { method: 'POST', ...json({ old: 'student123', new: '123' }) }, janTwo);
  assert.equal(short.status, 422, 'short new password rejected');
  const ok = await api('/api/me/password', { method: 'POST', ...json({ old: 'student123', new: 'password456' }) }, janTwo);
  assert.equal(ok.status, 200);

  const oldLogin = await fetch(`${BASE}/api/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'jan_kowalski', password: 'student123' }) });
  assert.equal(oldLogin.status, 401, 'old password no longer works');
  const newTok = await loginAs('jan_kowalski', 'password456');
  assert.ok(newTok, 'new password works');
});
