// Tests for external plagiarism adapter (MOSS/JPlag) & integrity checks
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');

let h;
let teacher;
let student;
let stranger;
let contest;
let prob;
let plagiarism;
let store;

before(async () => {
  h = await startServer({ prefix: 'satori-plag-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  student = await h.loginAs('jan_kowalski', 'student123');
  const reg = await h.api('/api/auth/register', {
    method: 'POST',
    ...json({ login: 'other_student_plag', email: 'other_plag@uj.edu.pl', password: 'secret12' }),
  });
  stranger = await h.loginAs('other_student_plag', 'secret12');

  plagiarism = require('../apps/api/src/lib/plagiarism');
  store = require('../apps/api/src/lib/store').store;

  // Create contest
  contest = await h.createContest(teacher, {
    name: 'Plagiarism Test Contest',
    mode: 'ICPC',
  });

  // Add problem
  const p = await h.api(`/api/contests/${contest.id}/problems`, {
    method: 'POST',
    ...json({ code: 'A', name: 'Plag Task' }),
  }, teacher);
  prob = p.body;

  // Insert two near-identical submissions by two different users
  const studentUser = (await h.api('/api/me', {}, student)).body;
  const otherUser = (await h.api('/api/me', {}, stranger)).body;

  const code1 = '#include <iostream>\nusing namespace std;\nint main() { int a, b; cin >> a >> b; cout << a + b << endl; return 0; }';
  const code2 = '#include <iostream>\nusing namespace std;\nint main() { int x, y; cin >> x >> y; cout << x + y << endl; return 0; }';

  store.insert('submits', {
    contestId: contest.id,
    problemId: prob.id,
    userId: studentUser.id,
    code: code1,
    filename: 'sol1.cpp',
    language: 'C++',
    status: 'OK',
    createdAt: new Date().toISOString(),
  });

  store.insert('submits', {
    contestId: contest.id,
    problemId: prob.id,
    userId: otherUser.id,
    code: code2,
    filename: 'sol2.cpp',
    language: 'C++',
    status: 'OK',
    createdAt: new Date().toISOString(),
  });
});

after(async () => {
  if (h) await h.close();
});

test('getAvailableTools returns tool availability flags', () => {
  const tools = plagiarism.getAvailableTools();
  assert.equal(tools.builtin, true);
  assert.equal(typeof tools.moss, 'boolean');
  assert.equal(typeof tools.jplag, 'boolean');
});

test('exportProblemSubmissions writes files into directory tree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-export-test-'));
  try {
    const res = plagiarism.exportProblemSubmissions(contest.id, prob.id, tmp);
    assert.equal(res.submits.length, 2);
    assert.equal(res.exported.length, 2);
    for (const item of res.exported) {
      assert.ok(fs.existsSync(item.filePath), `File exists: ${item.filePath}`);
      const content = fs.readFileSync(item.filePath, 'utf8');
      assert.ok(content.includes('main()'));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runPlagiarismCheck identifies similar pair across users', async () => {
  const res = await plagiarism.runPlagiarismCheck(contest.id, prob.id, { threshold: 0.6 });
  assert.ok(res.tool);
  assert.equal(res.scannedCount, 2);
  assert.equal(res.matchCount, 1);
  assert.ok(res.pairs.length >= 1);
  const pair = res.pairs[0];
  assert.ok(pair.score >= 0.8, `Score ${pair.score} should be >= 0.8`);
  assert.notEqual(pair.userA, pair.userB, 'Must compare different users');
});

test('integrity external-tools endpoint requires contest admin', async () => {
  // Student -> 403
  const forbidden = await h.api(`/api/contests/${contest.id}/integrity/external-tools`, {}, student);
  assert.equal(forbidden.status, 403);

  // Teacher -> 200
  const ok = await h.api(`/api/contests/${contest.id}/integrity/external-tools`, {}, teacher);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tools.builtin, true);
});

test('integrity external-check endpoint performs plagiarism scan and audits', async () => {
  // Student -> 403
  const forbidden = await h.api(`/api/contests/${contest.id}/integrity/external-check`, {
    method: 'POST',
    ...json({ problemId: prob.id, tool: 'builtin', threshold: 0.6 }),
  }, student);
  assert.equal(forbidden.status, 403);

  // Teacher -> 200
  const ok = await h.api(`/api/contests/${contest.id}/integrity/external-check`, {
    method: 'POST',
    ...json({ problemId: prob.id, tool: 'builtin', threshold: 0.6 }),
  }, teacher);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.result.matchCount, 1);
  assert.ok(ok.body.result.pairs.length >= 1);
});
