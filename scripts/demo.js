// One-command demo: seed + start API + smoke test. Run: npm run demo
// Zero-install (stdlib only). Web UI optional: cd apps/web && npm install && npm run dev
'use strict';
const { spawn } = require('node:child_process');

const PORT = process.env.PORT || 3001;
const api = spawn('node', ['apps/api/src/server.js'], { env: { ...process.env, PORT }, stdio: 'inherit' });

async function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function smoke() {
  const BASE = `http://localhost:${PORT}`;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* retry */ }
    await wait(300);
  }
  const login = await (await fetch(`${BASE}/api/auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'jan_kowalski', password: 'student123' }),
  })).json();
  if (!login.token) throw new Error(`login failed: ${JSON.stringify(login)}`);
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  const contests = await (await fetch(`${BASE}/api/contests`, { headers: H })).json();
  const probs = await (await fetch(`${BASE}/api/contests/251519/problems`, { headers: H })).json();
  const pid = probs.items[0].id;
  const sub = await (await fetch(`${BASE}/api/submits`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ contestId: 251519, problemId: pid, filename: 'solution.cpp', code: 'int main(){int a,b;cin>>a>>b;cout<<a+b;}' }),
  })).json();
  console.log(`\nSMOKE submit #${sub.id} ${sub.status} (queue ${sub.queue.position}, eta ${sub.queue.etaSec}s)`);
  for (let i = 0; i < 30; i++) {
    await wait(300);
    const d = await (await fetch(`${BASE}/api/submits/${sub.id}`, { headers: H })).json();
    if (!['QUE', 'CMP', 'TST'].includes(d.status)) {
      console.log(`SMOKE judged: ${d.status} (${d.points ?? 0} pts, ${d.cpuMs ?? 0}ms)`);
      break;
    }
  }
  console.log(`\nREADY:\n- API:   ${BASE}\n- Demo UI (no install): ${BASE}/demo\n- OpenAPI:${BASE}/api/openapi.json\n- Next.js (needs install): cd apps/web && npm install && npm run dev -> http://localhost:3000/contests/251519\n- Login: jan_kowalski / student123\n`);
}

smoke().catch((e) => { console.error(`SMOKE-FAIL: ${e.message}`); process.exitCode = 1; });
process.on('SIGINT', () => api.kill());
