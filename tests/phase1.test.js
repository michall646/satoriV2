// Phase 1 integration: real runners + retired languages (D1), hardened runner
// limits (S1-7), honest per-test stats (S1-4), LABS board parity with /grade (S1-3).
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-p1-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3134';
process.env.SATORI_DEMO_TRIGGERS = '1';
const BASE = 'http://localhost:3134';

let server;
let teacherTok;
let janTok;
let studentId;
const availability = {};

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

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3134, r));
  teacherTok = await loginAs('g_herman', 'teacher123');
  janTok = await loginAs('jan_kowalski', 'student123');
  studentId = (await api('/api/me', {}, janTok)).body.id;
  const langs = await api('/api/languages');
  for (const row of langs.body.matrix) availability[row.lang] = row.available;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('language matrix: six serviced languages; SQL/CUDA retired', () => {
  const langs = Object.keys(availability);
  assert.deepEqual(langs.sort(), ['C', 'C++17', 'Java', 'JavaScript', 'Python', 'Rust'].sort());
  for (const l of langs) assert.equal(typeof availability[l], 'boolean', `${l} availability flag`);
  assert.equal(availability.JavaScript, true, 'node must be available where the API runs');
});

test('SQL and CUDA submissions are rejected (negative)', async () => {
  const cid = await mkContest('Retired langs');
  const pid = await mkProblem(cid, 'A');
  const sql = await submit(teacherTok, pid, 'solution.sql', 'SELECT 1;', cid);
  assert.equal(sql.status, 422);
  assert.equal(sql.body.error.code, 'LANG_OFF');
  const cu = await submit(teacherTok, pid, 'kernel.cu', '__global__ void k(){}', cid);
  assert.equal(cu.status, 422);
  assert.equal(cu.body.error.code, 'LANG_OFF');
});

const HELLO = {
  'C': ['sol.c', '#include <stdio.h>\nint main(){printf("hi\\n");return 0;}'],
  'C++17': ['sol.cpp', '#include <bits/stdc++.h>\nint main(){std::cout<<"hi\\n";}'],
  'Python': ['sol.py', 'print("hi")'],
  'Java': ['Main.java', 'public class Main { public static void main(String[] args) { System.out.println("hi"); } }'],
  'Rust': ['sol.rs', 'fn main(){println!("hi");}'],
  'JavaScript': ['sol.js', 'console.log("hi");'],
};

test('every serviced language with a toolchain really runs (hello world)', async () => {
  const cid = await mkContest('Hello langs');
  const pid = await mkProblem(cid, 'H', FAST_LIMITS);
  await addCase(pid, '', 'hi');
  for (const lang of Object.keys(HELLO)) {
    if (!availability[lang]) continue;
    const [file, code] = HELLO[lang];
    const r = await submit(teacherTok, pid, file, code, cid);
    assert.equal(r.status, 201, `${lang} accepted: ${JSON.stringify(r.body)}`);
    const judged = await waitJudged(r.body.id, teacherTok);
    assert.ok(judged, `${lang} judged in time`);
    assert.equal(judged.status, 'OK', `${lang} real run failed: ${String(judged.compileLog || judged.explain || '').slice(0, 300)}`);
    assert.equal(judged.simulated, false, `${lang} must not be simulated`);
  }
});

test('runaway output is capped and becomes RE', async () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'JUDGE_SANDBOX.md')), 'sandbox doc exists');
  if (!availability['C++17']) return;
  const cid = await mkContest('Output bomb');
  const pid = await mkProblem(cid, 'B', FAST_LIMITS);
  await addCase(pid, '', 'x');
  const r = await submit(teacherTok, pid, 'bomb.cpp', '#include <bits/stdc++.h>\nint main(){for(;;)std::cout<<"x";}', cid);
  assert.equal(r.status, 201);
  const judged = await waitJudged(r.body.id, teacherTok);
  assert.ok(judged);
  assert.equal(judged.status, 'RE');
  assert.match(String(((judged.perTestFull || [])[0] || {}).msg || ''), /output limit/i);
});

test('per-test stats are real: no fabricated memMb or fake numbers', async () => {
  if (!availability['C++17']) return;
  const cid = await mkContest('Stats');
  const pid = await mkProblem(cid, 'S', FAST_LIMITS);
  await addCase(pid, '2 3\n', '5\n');
  const r = await submit(teacherTok, pid, 'sol.cpp', SUM_CODE, cid);
  assert.equal(r.status, 201);
  const judged = await waitJudged(r.body.id, teacherTok);
  assert.ok(judged);
  assert.equal(judged.status, 'OK');
  const t0 = (judged.perTestFull || [])[0] || {};
  assert.equal('memMb' in t0, false, 'no invented memory numbers');
  assert.equal(typeof t0.timeMs, 'number');
  assert.ok(t0.timeMs >= 0, 'real wall time');
  assert.equal(judged.memMb, null);
  assert.equal(judged.simulated, false);
  assert.equal(typeof judged.cpuMs, 'number');

  const trig = await submit(teacherTok, pid, 'sol.cpp', '// TLE-TRIGGER\nint main(){return 0;}', cid);
  const tj = await waitJudged(trig.body.id, teacherTok);
  assert.equal(tj.status, 'TLE');
  assert.equal('memMb' in ((tj.perTestFull || [])[0] || {}), false);
});

test('LABS board total equals /grade total (S1-3)', async () => {
  const cid = await mkContest('Labs parity', 'LABS');
  const a = await mkProblem(cid, 'A');
  const b = await mkProblem(cid, 'B');
  await api(`/api/problems/${a}`, { method: 'PATCH', ...json({ weight: 2 }) }, teacherTok);
  await api(`/api/problems/${b}`, { method: 'PATCH', ...json({ weight: 1 }) }, teacherTok);
  await addCase(a, '2 3\n', '5\n');
  await addCase(b, '2 3\n', '999\n');
  await api(`/api/contests/${cid}`, { method: 'PATCH', ...json({ lifecycle: 'running' }) }, teacherTok);
  await api(`/api/contests/${cid}/members/csv`, { method: 'POST', ...json({ csv: 'jan_kowalski' }) }, teacherTok);

  const okSub = await submit(janTok, a, 'sol.cpp', SUM_CODE, cid);
  assert.equal(okSub.status, 201);
  const okJudged = await waitJudged(okSub.body.id, janTok);
  assert.equal(okJudged.status, 'OK');
  const waSub = await submit(janTok, b, 'sol.cpp', SUM_CODE, cid);
  assert.equal(waSub.status, 201);
  const waJudged = await waitJudged(waSub.body.id, janTok);
  assert.equal(waJudged.status, 'WA');

  const board = await api(`/api/contests/${cid}/ranking`, {}, teacherTok);
  assert.equal(board.status, 200);
  assert.equal(board.body.mode, 'LABS');
  const row = board.body.rows.find((x) => x.contestantId === `u:${studentId}`);
  assert.ok(row, 'jan on the board');
  assert.equal(row.total, 66.7, 'weighted: (100*2 + 0*1) / 3');
  assert.equal(row.grade, 3, 'default 90/75/50 grade scale');

  const grade = await api(`/api/contests/${cid}/grade?user=${studentId}`, {}, teacherTok);
  assert.equal(grade.status, 200);
  assert.equal(grade.body.total, row.total, 'board matches /grade');
  assert.equal(grade.body.grade, row.grade);
});
