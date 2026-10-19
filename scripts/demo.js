// One-command demo: seed + start API + smoke test. Run: npm run demo
// Zero-install (stdlib only). Web UI optional: cd apps/web && npm install && npm run dev
// Against an already-running API (no spawn): SATORI_API=http://localhost:3198 node scripts/demo.js
'use strict';
const { spawn } = require('node:child_process');

const PORT = process.env.PORT || 3001;
const EXTERNAL = (process.env.SATORI_API || '').replace(/\/+$/, '');
const BASE = EXTERNAL || `http://localhost:${PORT}`;
const api = EXTERNAL ? null : spawn('node', ['apps/api/src/server.js'], { env: { ...process.env, PORT }, stdio: 'inherit' });

// C++17 A+B for the playground "Sum" problem: compiles with g++ and prints the
// exact expected tokens, so the smoke test can assert a real OK verdict.
const CODE = [
  '#include <bits/stdc++.h>',
  'using namespace std;',
  'int main(){int a,b;if(!(cin>>a>>b))return 0;cout<<a+b<<endl;}',
  '',
].join('\n');

// QUE = queued, CMP = compiling, TST = running tests; anything else is terminal.
const PENDING = ['QUE', 'CMP', 'TST'];
const WAIT_MS = 300;
const WAIT_TRIES = 100; // ~30s budget for queue + compile + tests

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function req(path, opts) {
  const r = await fetch(`${BASE}${path}`, opts);
  return r.json();
}

async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* retry */ }
    await wait(WAIT_MS);
  }
  throw new Error(`no healthy API at ${BASE}/api/health`);
}

async function waitJudged(id, H) {
  let last = null;
  for (let i = 0; i < WAIT_TRIES; i++) {
    await wait(WAIT_MS);
    const d = await req(`/api/submits/${id}`, { headers: H });
    if (d.error) throw new Error(`submit ${id} unreadable: ${d.error.message}`);
    last = d;
    if (!PENDING.includes(d.status)) return d;
  }
  throw new Error(`submit ${id} still ${last && last.status} after ${(WAIT_MS * WAIT_TRIES) / 1000}s`);
}

async function smoke() {
  await waitForApi();
  const login = await req('/api/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'jan_kowalski', password: 'student123' }),
  });
  if (!login.token) throw new Error(`login failed: ${JSON.stringify(login)}`);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  const contests = await req('/api/contests', { headers: H });
  if (!contests.items) throw new Error(`contest list failed: ${JSON.stringify(contests)}`);
  const probs = await req('/api/contests/251519/problems', { headers: H });
  if (!probs.items || !probs.items.length) throw new Error(`no problems in 251519: ${JSON.stringify(probs)}`);
  // Prefer problem A ("Sum"): the smoke solution is built for it.
  const prob = probs.items.find((x) => x.code === 'A') || probs.items[0];
  const sub = await req('/api/submits', {
    method: 'POST', headers: H,
    body: JSON.stringify({ contestId: 251519, problemId: prob.id, filename: 'solution.cpp', code: CODE }),
  });
  if (!sub.id) throw new Error(`submit rejected: ${JSON.stringify(sub)}`);
  const q = sub.queue || {};
  console.log(`\nSMOKE submit #${sub.id} ${sub.status} (queue ${q.position ?? '-'}, eta ${q.etaSec ?? '-'}s)`);
  const done = await waitJudged(sub.id, H);
  console.log(`SMOKE judged: ${done.status} (${done.points ?? 0} pts, ${done.cpuMs ?? 0}ms)`);
  if (done.status !== 'OK') throw new Error(`verdict ${done.status}, expected OK`);
  console.log(`\nREADY:\n- API:   ${BASE}\n- Demo UI (no install): ${BASE}/demo\n- OpenAPI:${BASE}/api/openapi.json\n- Next.js (needs install): cd apps/web && npm install && npm run dev -> http://localhost:3000/contests/251519\n- Login: jan_kowalski / student123\n`);
}

smoke().catch((e) => {
  console.error(`SMOKE-FAIL: ${e.message}`);
  if (api) api.kill(); // spawned server: stop it so a failed smoke test exits non-zero
  process.exitCode = 1;
});
process.on('SIGINT', () => { if (api) api.kill(); });
