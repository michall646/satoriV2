// Batch 4 Lane S — observability + load-test gate.
//
// Covers the metrics contract (bounded route labels, counters, histograms,
// process gauges, queue gauge, optional token), and proves the load script runs
// and applies its error threshold.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { startServer } = require('./helpers');
const metrics = require('../apps/api/src/lib/metrics');

const LOAD_SCRIPT = path.join(__dirname, '..', 'scripts', 'load-test.js');

// The API under test runs in this process: spawnSync would block its event loop
// and the child could never receive a response. Async spawn keeps the parent
// serving requests while the child runs.
function runNode(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: null, signal: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr, timedOut });
    });
  });
}

let h;

before(async () => {
  h = await startServer({ prefix: 'satori-metrics-' });
});

after(async () => {
  delete process.env.SATORI_METRICS_TOKEN;
  if (h) await h.close();
});

test('path normalization: ids and query strings never become route labels', () => {
  const cases = [
    ['/api/contests/251519', '/api/contests/:id'],
    ['/api/contests/251519/ranking?x=1', '/api/contests/:id/ranking'],
    ['/api/contests/251519/grade/export.csv', '/api/contests/:id/grade/export.csv'],
    ['/api/problems/123', '/api/problems/:id'],
    ['/api/problems/123/tests/456', '/api/problems/:id/tests/:id'],
    ['/api/problems/123/tests/groups/7', '/api/problems/:id/tests/groups/:id'],
    ['/api/submits/123/events', '/api/submits/:id/events'],
    ['/api/users/123', '/api/users/:id'],
    ['/api/orgs/12/members', '/api/orgs/:id'],
    ['/api/news/99', '/api/news/:id'],
    ['/api/me/sessions/abc.def.ghi', '/api/me/sessions/:id'],
    ['/api/notes/42', '/api/notes/:id'],
    ['/api/does-not-exist/99', '/api/__unmatched__'],
    ['/contest/251519', '/contest/:id'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(metrics.normalizePath(input), expected, input);
    assert.ok(!metrics.normalizePath(input).includes('?'), 'query string stripped');
  }
});

test('counters, gauges and histograms expose a bounded, escaped snapshot', () => {
  metrics.reset();
  metrics.observeRequest('get', '/api/contests/123/ranking?token=super-secret', 200, 3);
  metrics.observeRequest('GET', '/api/contests/999/ranking', 500, 12);

  const snap = metrics.snapshot();
  const counter = snap.counters.find((c) => c.name === 'satori_http_requests_total'
    && c.labels.route === '/api/contests/:id/ranking' && c.labels.status === '200');
  assert.ok(counter, 'counter series recorded');
  assert.equal(counter.value, 1);
  assert.equal(counter.labels.method, 'GET', 'method is normalized');

  const hist = snap.histograms.find((x) => x.name === 'satori_http_request_duration_seconds');
  assert.ok(hist, 'histogram recorded');
  assert.equal(hist.count, 2);
  assert.equal(hist.sumSeconds, 0.015);
  const buckets = Object.fromEntries(hist.buckets.map((b) => [b.le, b.count]));
  assert.equal(buckets['0.005'], 1, '3ms observation');
  assert.equal(buckets['0.01'], 1);
  assert.equal(buckets['0.025'], 2, '12ms observation');
  assert.equal(buckets['+Inf'], 2);

  const text = metrics.prometheus();
  assert.match(text, /satori_http_requests_total\{method="GET",route="\/api\/contests\/:id\/ranking",status="200"\} 1/);
  assert.match(text, /satori_http_request_duration_seconds_bucket\{le="0\.005",route="\/api\/contests\/:id\/ranking"\} 1/);
  assert.match(text, /satori_http_request_duration_seconds_sum\{route="\/api\/contests\/:id\/ranking"\} 0\.015/);
  assert.match(text, /satori_http_request_duration_seconds_count\{route="\/api\/contests\/:id\/ranking"\} 2/);
  assert.match(text, /satori_process_uptime_seconds \d/);
  assert.match(text, /satori_process_resident_memory_bytes \d/);
  assert.match(text, /satori_judge_queue_depth \d/);
  assert.ok(!text.includes('super-secret'), 'tokens are not labels');
  assert.ok(!text.includes('route="/api/contests/123'), 'numeric ids are not labels');
});

test('GET /api/metrics: exposition content type, normalized labels, queue gauge', async () => {
  await h.api('/api/health');
  await h.api('/api/contests');
  await h.api('/api/contests/251519');
  await h.api('/api/contests/251519/ranking');
  await h.api('/api/does-not-exist/999');
  await h.api('/api/metrics'); // first scrape is counted only after it finishes

  const res = await h.api('/api/metrics');
  assert.equal(res.status, 200, res.text);
  assert.match(String(res.headers.get('content-type')), /^text\/plain; version=0\.0\.4; charset=utf-8$/i);
  assert.match(res.text, /satori_http_requests_total\{method="GET",route="\/api\/health",status="200"\}/);
  assert.match(res.text, /route="\/api\/contests"/);
  assert.match(res.text, /route="\/api\/contests\/:id"/);
  assert.match(res.text, /route="\/api\/__unmatched__"/);
  assert.match(res.text, /route="\/api\/__unmatched__",status="404"/, '404 status is recorded');
  assert.match(res.text, /route="\/api\/metrics"/, 'the metrics route itself is counted');
  assert.match(res.text, /satori_http_request_duration_seconds_bucket\{le="0\.005",route="\/api\/health"\}/);
  assert.match(res.text, /satori_http_request_duration_seconds_sum\{route="\/api\/health"\}/);
  assert.match(res.text, /satori_http_request_duration_seconds_count\{route="\/api\/health"\}/);
  assert.match(res.text, /^satori_process_uptime_seconds \d/m);
  assert.match(res.text, /^satori_process_resident_memory_bytes \d/m);
  assert.match(res.text, /^satori_judge_queue_depth \d/m);
  assert.ok(!/route="[^"]*251519/.test(res.text), 'contest id never appears in a label');
  assert.ok(!/route="[^"]*\/\d{3,}/.test(res.text), 'no numeric ids inside route labels');

  const judgeQueue = require('../apps/api/src/lib/judgeQueue');
  const queueLine = res.text.match(/^satori_judge_queue_depth (\d+(?:\.\d+)?)$/m);
  assert.ok(queueLine, 'queue gauge line present');
  assert.equal(Number(queueLine[1]), judgeQueue.queueSize());

  const json = await h.api('/api/metrics.json');
  assert.equal(json.status, 200);
  assert.ok(json.body.process.uptimeSeconds >= 0);
  assert.ok(Array.isArray(json.body.counters));
  assert.ok(json.body.counters.some((c) => c.name === 'satori_http_requests_total' && c.labels.route === '/api/health'));
});

test('SATORI_METRICS_TOKEN gates both endpoints (header and query)', async () => {
  const previous = process.env.SATORI_METRICS_TOKEN;
  process.env.SATORI_METRICS_TOKEN = 'test-metrics-token';
  try {
    const anon = await h.api('/api/metrics');
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error.code, 'METRICS_AUTH');
    assert.equal(anon.headers.get('www-authenticate'), 'Bearer');

    const wrongHeader = await h.api('/api/metrics', { headers: { Authorization: 'Bearer nope' } });
    assert.equal(wrongHeader.status, 401);

    const wrongQuery = await h.api('/api/metrics?token=nope');
    assert.equal(wrongQuery.status, 401);

    const goodHeader = await h.api('/api/metrics', { headers: { Authorization: 'Bearer test-metrics-token' } });
    assert.equal(goodHeader.status, 200);
    assert.match(goodHeader.text, /satori_http_requests_total/);

    const goodQuery = await h.api('/api/metrics?token=test-metrics-token');
    assert.equal(goodQuery.status, 200);
    assert.ok(!goodQuery.text.includes('test-metrics-token'), 'query token is not recorded');

    const json = await h.api('/api/metrics.json', { headers: { Authorization: 'Bearer test-metrics-token' } });
    assert.equal(json.status, 200);
  } finally {
    if (previous == null) delete process.env.SATORI_METRICS_TOKEN;
    else process.env.SATORI_METRICS_TOKEN = previous;
  }
});

test('load-test --help prints usage and exits 0', () => {
  const res = spawnSync(process.execPath, [LOAD_SCRIPT, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /--concurrency/);
});

test('load-test completes a short run against the test server', async () => {
  const token = await h.loginAs('jan_kowalski', 'student123');
  const res = await runNode([
    LOAD_SCRIPT,
    '--base', h.base,
    '--token', token,
    '--duration', '300',
    '--concurrency', '2',
    '--path', '/api/health',
  ]);

  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /RPS\s+\d/);
  assert.match(res.stdout, /total\s+\d+ requests/);
  assert.match(res.stdout, /p50=/);
});

test('load-test exits 1 when the error rate exceeds 1% (negative)', async () => {
  const res = await runNode([
    LOAD_SCRIPT,
    '--base', h.base,
    '--duration', '300',
    '--concurrency', '2',
    '--path', '/api/definitely-not-a-route',
  ]);

  assert.equal(res.status, 1, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /errors\s+[1-9]/);
});
