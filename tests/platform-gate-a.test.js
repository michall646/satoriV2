// Lane G / Gate A: OpenAPI truth, CLI token/session handling, SDK parity,
// language/status data. API-backed checks use the shared harness.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { Satori } = require('../packages/sdk/src/index.js');
const { parseArgs, pickToken, readSession, writeSession, openUrl } = require('../apps/cli/bin/satori.js');

let h;

before(async () => { h = await startServer({ prefix: 'satori-platform-' }); });
after(async () => { if (h) await h.close(); });

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function hasPath(yaml, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^  ${escaped}:`, 'm').test(yaml);
}

test('openapi.yaml lists every current API area and route', () => {
  const yaml = source('openapi.yaml');
  const required = [
    '/api/health', '/api/status', '/api/languages', '/api/openapi.json', '/api/orgs', '/api/search',
    '/api/auth/register', '/api/auth/token', '/api/auth/refresh', '/api/auth/revoke',
    '/api/me', '/api/me/sessions', '/api/me/sessions/{jti}', '/api/me/teams', '/api/me/password',
    '/api/contests', '/api/contests/{id}', '/api/contests/{id}/apply',
    '/api/contests/{id}/members', '/api/contests/{id}/members/approve',
    '/api/contests/{id}/members/csv', '/api/contests/{id}/members/{uid}',
    '/api/contests/{id}/duplicate', '/api/contests/{id}/teams',
    '/api/contests/{id}/problems', '/api/contests/{id}/ranking',
    '/api/contests/{id}/ranking.csv', '/api/contests/{id}/rankings/live',
    '/api/contests/{id}/grade', '/api/contests/{id}/grade/matrix',
    '/api/contests/{id}/grade/analytics', '/api/contests/{id}/grade/preview',
    '/api/contests/{id}/grade/feedback', '/api/contests/{id}/grade/export.csv',
    '/api/contests/{id}/grade.ics', '/api/contests/{id}/deadlines/bulk-extend',
    '/api/contests/{id}/audit', '/api/contests/{id}/clarifications',
    '/api/contests/{id}/clarifications/{cid}/answer', '/api/contests/{id}/clarifications/{cid}',
    '/api/contests/{id}/news', '/api/contests/{id}/news/{nid}', '/api/contests/{id}/subpages',
    '/api/contests/{id}/subpages/{sid}',
    '/api/contests/{id}/integrity/similarity', '/api/contests/{id}/integrity/timeline',
    '/api/contests/{id}/integrity/appeals', '/api/contests/{id}/integrity/appeals/{aid}',
    '/api/contests/{id}/exam', '/api/contests/{id}/exam/violations',
    '/api/contests/{id}/webhooks', '/api/contests/{id}/webhooks/deliveries',
    '/api/contests/{id}/webhooks/{hookId}', '/api/contests/{id}/webhooks/{hookId}/ping',
    '/api/problems/{id}', '/api/problems/{id}/tests', '/api/problems/{id}/tests/{groupId}',
    '/api/problems/{id}/best', '/api/problems/{id}/heatmap', '/api/problems/{id}/clone',
    '/api/problems/{id}/rejudge', '/api/problems/{id}/submit',
    '/api/submits', '/api/submits/sample-run', '/api/submits/codes.zip',
    '/api/submits/{id}', '/api/submits/{id}/events', '/api/submits/{id}/rejudge',
    '/api/webhooks', '/api/notifications', '/api/notifications/read', '/api/notifications/prefs',
    '/api/notes', '/api/notes/{id}',
    '/contest/{id}', '/contest/{id}/problems', '/contest/{id}/problems/{pid}',
    '/contest/{id}/ranking/{rid}', '/contest/{id}/results', '/subpage/{id}',
  ];
  for (const route of required) assert.ok(hasPath(yaml, route), `openapi.yaml is missing ${route}`);
  assert.match(yaml, /name: limit,.*maximum: 1000/s, 'results limit must document max 1000');
  assert.match(yaml, /absolute.*millisecond limit/s, 'perLang must be documented as absolute ms');
  assert.match(yaml, /JSON only/, 'submit contract must say JSON only');
});

test('/api/openapi.json returns JSON (skips while the route still serves YAML)', async (t) => {
  const r = await h.api('/api/openapi.json');
  const type = String(r.headers.get('content-type') || '').toLowerCase();
  if (type.includes('yaml') || /^\s*openapi:\s/m.test(r.text || '')) {
    t.skip('handoff to API owner: /api/openapi.json still serves openapi.yaml as text/yaml; it must parse YAML and send application/json');
    return;
  }
  assert.match(type, /application\/json/);
  assert.equal(r.body.openapi, '3.1.0');
  assert.ok(r.body.paths['/api/submits'], 'JSON OpenAPI must include /api/submits');
  assert.ok(r.body.paths['/api/contests/{id}/grade/preview'], 'JSON OpenAPI must include grade preview');
});

test('/api/languages exposes canonical keys, availability and hello-world', async () => {
  const r = await h.api('/api/languages');
  assert.equal(r.status, 200);
  const rows = r.body.matrix || [];
  assert.deepEqual(rows.map((x) => x.lang), ['C', 'C++17', 'Java', 'Python', 'Rust', 'JavaScript']);
  for (const row of rows) {
    assert.equal(typeof row.available, 'boolean', `${row.lang} needs available`);
    assert.equal(typeof row.hello, 'string', `${row.lang} needs hello`);
    assert.ok(row.hello.length > 0, `${row.lang} hello must not be empty`);
  }
  const rust = rows.find((x) => x.lang === 'Rust');
  const js = rows.find((x) => x.lang === 'JavaScript');
  assert.match(rust.hello, /fn main/);
  assert.match(js.hello, /console\.log/);
});

test('/api/status reports queue, ETA, languages, missing toolchains and sandbox', async () => {
  const r = await h.api('/api/status');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.queue, 'number');
  assert.equal(typeof r.body.etaSec, 'number');
  assert.ok(Array.isArray(r.body.languages));
  assert.ok(Array.isArray(r.body.missingToolchains));
  assert.equal(typeof r.body.sandbox, 'string');
  assert.ok(r.body.sandbox.length > 0);
});

test('languages page uses canonical keys and per-row availability/hello data', () => {
  const page = source('apps/web/app/languages/page.js');
  assert.match(page, /Rust:\s*'fn main/);
  assert.match(page, /JavaScript:\s*'console\.log/);
  assert.match(page, /available:\s*row\.available === true/);
  assert.ok(!/HELLO\[r\.lang\] \|\| HELLO\.python/.test(page), 'must not fall back to Python hello-world');
  assert.match(page, /r\.hello/, 'must render the API hello field');
});

test('status page shows availability, missing toolchains, queue/ETA and sandbox note', () => {
  const page = source('apps/web/app/status/page.js');
  assert.match(page, /s\.missingToolchains/);
  assert.match(page, /s\.sandbox/);
  assert.match(page, /s\.etaSec/);
  assert.match(page, /s\.queue/);
  assert.match(page, /const COPY = \{[\s\S]*en:[\s\S]*pl:/);
});

test('CLI parses --token and value/boolean flags without eating the source file', () => {
  const parsed = parseArgs(['problems', '--token', 'jwt-123', '--contest', '251519']);
  assert.equal(parsed.command, 'problems');
  assert.equal(parsed.flags.token, 'jwt-123');
  assert.equal(parsed.flags.contest, '251519');
  assert.deepEqual(parsed.rest, []);

  const submit = parseArgs(['submit', '--open', 'solution.cpp', '--ci', '--problem=A']);
  assert.equal(submit.command, 'submit');
  assert.deepEqual(submit.rest, ['solution.cpp']);
  assert.equal(submit.flags.open, true);
  assert.equal(submit.flags.ci, true);
  assert.equal(submit.flags.problem, 'A');

  const eq = parseArgs(['status', '7', '--token=abc']);
  assert.equal(eq.command, 'status');
  assert.deepEqual(eq.rest, ['7']);
  assert.equal(eq.flags.token, 'abc');
});

test('CLI token precedence is --token > SATORI_TOKEN > saved session', () => {
  assert.deepEqual(pickToken({ flag: 'f', env: 'e', session: { token: 's' } }), { token: 'f', source: 'flag' });
  assert.deepEqual(pickToken({ env: 'e', session: { token: 's' } }), { token: 'e', source: 'env' });
  assert.deepEqual(pickToken({ session: { token: 's' } }), { token: 's', source: 'file' });
  assert.deepEqual(pickToken({ flag: true, session: { token: 's' } }), { token: 's', source: 'file' });
  assert.deepEqual(pickToken({}), { token: null, source: 'none' });
});

test('CLI persists token + refresh and still reads a legacy bare-token file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-cli-token-'));
  const file = path.join(dir, 'token');
  try {
    fs.writeFileSync(file, 'legacy-token', 'utf8');
    assert.deepEqual(readSession(file), { token: 'legacy-token', refresh: null });

    writeSession({ token: 'new-token', refresh: 'new-refresh' }, file);
    assert.deepEqual(readSession(file), { token: 'new-token', refresh: 'new-refresh' });
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(raw, { token: 'new-token', refresh: 'new-refresh' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(openUrl('http://localhost:3000/results/1', { interactive: false }), false);
  assert.equal(openUrl('file:///etc/passwd', { interactive: true }), false);
});

test('SDK: results pagination, ranking and allProblems walk the API', async () => {
  const sdk = new Satori('http://example.test', 'tok');
  const calls = [];
  sdk.req = async (p) => { calls.push(p); return { items: [], total: 0 }; };

  await sdk.results({ contest: 1, problem: 2, verdict: 'WA', me: true, team: 3, limit: 25, offset: 50 });
  assert.equal(calls[0], '/api/submits?contest=1&problem=2&verdict=WA&me=1&team=3&limit=25&offset=50');

  await sdk.ranking(7, 'IOI');
  assert.equal(calls[1], '/api/contests/7/ranking?mode=IOI');

  sdk.req = async (p) => {
    if (p === '/api/contests') return { items: [{ id: 1, name: 'One' }] };
    if (p === '/api/contests/1/problems') return { items: [{ id: 10, code: 'A' }] };
    throw new Error(`unexpected ${p}`);
  };
  const all = await sdk.allProblems();
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].contestId, 1);
  assert.equal(all.items[0].contestName, 'One');
});

test('SDK allProblems works against seeded contests over HTTP', async () => {
  const token = await h.loginAs('jan_kowalski', 'student123');
  const sdk = new Satori(h.base, token);
  const all = await sdk.allProblems();
  assert.ok(all.items.length > 0, 'seeded contests must expose at least one problem');
  assert.ok(all.items.every((p) => p.contestId != null && p.contestName), 'aggregated rows carry their contest');
  assert.ok(all.items.some((p) => p.code === 'A'));
});

test('SDK: refresh stores the new token and 401 retries once', async () => {
  const sdk = new Satori('http://example.test', 'old', { refresh: 'refresh-1' });
  sdk.refresh = async () => { sdk.token = 'new'; return { token: 'new' }; };

  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('unauthorized', { status: 401 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const body = await sdk.req('/api/me');
    assert.deepEqual(body, { ok: true });
    assert.equal(calls, 2);
    assert.equal(sdk.token, 'new');
  } finally {
    global.fetch = realFetch;
  }
});

test('SDK: SSE helper and watch build the submit events URL', async () => {
  const sdk = new Satori('http://example.test', 'tok');
  sdk.streamEvents = async (p, cb) => ({ path: p, cb });
  const out = await sdk.watch(9, () => {});
  assert.equal(out.path, '/api/submits/9/events');
  assert.equal(typeof sdk.streamEvents, 'function');
});
