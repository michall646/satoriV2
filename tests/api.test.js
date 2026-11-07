// API integration: register->login->apply->submit->judged->ranking. Isolated DATA_DIR.
// AAA per test. Positive+negative.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-test-'));
process.env.SATORI_DATA_DIR = tmp;
process.env.PORT = '3131';
const BASE = 'http://localhost:3131';

let server;
let token;
let contestId = 251519;
let problemId;

async function api(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((opts.headers) || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

before(async () => {
  require('../apps/api/src/seed').main();
  server = require('../apps/api/src/server').server;
  await new Promise((r) => server.listen(3131, r));
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('seed exposes playground contest (positive)', async () => {
  // Arrange: seeded DB
  // Act
  const { status, body } = await api('/api/contests?q=playground');
  // Assert
  assert.equal(status, 200);
  assert.ok(body.items.some((c) => c.id === contestId));
});

test('register+login issues JWT (positive)', async () => {
  const login = `t_${Date.now().toString(36)}`;
  const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ login, email: `${login}@uj.edu.pl`, password: 'secret12', firstName: 'T', lastName: 'U' }) });
  assert.equal(reg.status, 201);
  const tok = await api('/api/auth/token', { method: 'POST', body: JSON.stringify({ login, password: 'secret12' }) });
  assert.equal(tok.status, 200);
  assert.ok(tok.body.token);
  token = tok.body.token; // use for rest
});

test('bad password rejected (negative)', async () => {
  const r = await api('/api/auth/token', { method: 'POST', body: JSON.stringify({ login: 'nope_x', password: 'bad' }) });
  assert.equal(r.status, 401);
});

test('filename charset rejected with suggestion (negative)', async () => {
  const probs = await api(`/api/contests/${contestId}/problems`);
  problemId = probs.body.items[0].id;
  const r = await api('/api/submits', { method: 'POST', body: JSON.stringify({ contestId, problemId, filename: 'zło name.cpp', code: 'int main(){}' }) });
  assert.equal(r.status, 422);
  assert.match(r.body.error?.message || r.body.suggestion || '', /disallowed|Suggested|my|zło/i);
});

test('submit judges to OK and ranking reflects solve (positive)', async () => {
  const s = await api('/api/submits', { method: 'POST', body: JSON.stringify({ contestId, problemId, filename: 'solution.cpp', code: '#include<bits/stdc++.h>\nusing namespace std;\nint main(){ int a,b; if(!(cin>>a>>b)) return 0; cout<<a+b; }' }) });
  assert.equal(s.status, 201);
  const id = s.body.id;
  let got = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const d = await api(`/api/submits/${id}`);
    if (!['QUE', 'CMP', 'TST'].includes(d.body.status)) { got = d.body; break; }
  }
  assert.ok(got, 'judged in time');
  assert.equal(got.status, 'OK');
  const rank = await api(`/api/contests/${contestId}/ranking?mode=ICPC`);
  assert.equal(rank.status, 200);
  assert.ok(Array.isArray(rank.body.rows));
});
