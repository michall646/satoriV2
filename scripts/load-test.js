#!/usr/bin/env node
// Satori V2 — dependency-free HTTP load test (G10).
//
// Drives a fixed set of API paths from N concurrent workers for a duration,
// then reports throughput, latency percentiles and status/error breakdown.
// Node >= 20: uses the built-in global fetch.
'use strict';

const { performance } = require('node:perf_hooks');

const DEFAULTS = {
  base: 'http://localhost:3001',
  login: 'jan_kowalski',
  password: 'student123',
  duration: '10s',
  concurrency: 20,
};
const DEFAULT_PATHS = ['/api/health', '/api/contests', '/api/contests/251519/ranking'];

function usage() {
  console.log(`Satori load test (no dependencies)

Usage:
  node scripts/load-test.js [options]

Options:
  --base <url>          API base URL (default ${DEFAULTS.base})
  --token <jwt>         Reuse a token instead of logging in
  --login <login>       Login used when --token is absent (default ${DEFAULTS.login})
  --password <pass>     Password used when --token is absent (default ${DEFAULTS.password})
  --duration <time>     Run time: 10s, 500ms, or a bare number of milliseconds (default ${DEFAULTS.duration})
  --concurrency <n>     Parallel workers (default ${DEFAULTS.concurrency})
  --path <path>         Repeatable; default:
                          ${DEFAULT_PATHS.join('\n                          ')}
  -h, --help            Show this help

Exit codes: 0 success (<=1% errors), 1 too many errors, 2 usage/config error.
`);
}

function fail(message) {
  console.error(`load-test: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(2);
}

function parseDuration(raw) {
  const value = String(raw).trim().toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
  if (!match) fail(`invalid duration "${raw}" (use 10s, 500ms, or milliseconds)`);
  const amount = Number(match[1]);
  if (!(amount > 0)) fail('duration must be greater than zero');
  return match[2] === 's' ? amount * 1000 : amount;
}

function parseArgs(argv) {
  const opts = {
    base: DEFAULTS.base,
    token: '',
    login: DEFAULTS.login,
    password: DEFAULTS.password,
    durationMs: parseDuration(DEFAULTS.duration),
    concurrency: DEFAULTS.concurrency,
    paths: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '-h' || raw === '--help') {
      opts.help = true;
      continue;
    }
    if (!raw.startsWith('--')) fail(`unexpected argument "${raw}"`);

    const eq = raw.indexOf('=');
    const name = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
    const value = () => {
      if (eq >= 0) return raw.slice(eq + 1);
      i += 1;
      if (i >= argv.length) fail(`--${name} requires a value`);
      return argv[i];
    };

    switch (name) {
      case 'base': opts.base = value(); break;
      case 'token': opts.token = value(); break;
      case 'login': opts.login = value(); break;
      case 'password': opts.password = value(); break;
      case 'duration': opts.durationMs = parseDuration(value()); break;
      case 'concurrency': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) fail('--concurrency must be a positive integer');
        opts.concurrency = n;
        break;
      }
      case 'path': {
        const p = value();
        opts.paths.push(p.startsWith('/') ? p : `/${p}`);
        break;
      }
      default: fail(`unknown option --${name}`);
    }
  }

  if (!opts.paths.length) opts.paths.push(...DEFAULT_PATHS);
  return opts;
}

function normalizeBase(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { fail(`invalid --base "${raw}"`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') fail('--base must be http(s)');
  return raw.replace(/\/+$/, '');
}

async function login(base, loginName, password) {
  const res = await fetch(`${base}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login failed (${res.status}): ${text.slice(0, 300)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('login returned non-JSON'); }
  if (!body.token) throw new Error('login response did not include a token');
  return body.token;
}

async function warmup(base, paths, headers) {
  for (const p of paths) {
    try {
      const res = await fetch(`${base}${p}`, { headers, signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer();
    } catch { /* warmup failures surface in the measured run */ }
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return 0;
  }
  const base = normalizeBase(opts.base);

  let token = opts.token;
  if (!token) {
    try {
      token = await login(base, opts.login, opts.password);
    } catch (err) {
      console.error(`load-test: ${err.message}`);
      return 2;
    }
  }

  const headers = { Authorization: `Bearer ${token}` };
  console.log(`Satori load test -> ${base}`);
  console.log(`  paths       ${opts.paths.join(', ')}`);
  console.log(`  concurrency ${opts.concurrency}`);
  console.log(`  duration    ${opts.durationMs} ms`);

  await warmup(base, opts.paths, headers);

  const statuses = new Map();
  const latencies = [];
  let networkErrors = 0;
  let httpErrors = 0;
  let nextPath = 0;

  const deadline = Date.now() + opts.durationMs;
  const startedAt = performance.now();

  async function worker() {
    while (Date.now() < deadline) {
      const p = opts.paths[nextPath % opts.paths.length];
      nextPath += 1;
      const requestStarted = performance.now();
      try {
        const res = await fetch(`${base}${p}`, { headers, signal: AbortSignal.timeout(15000) });
        await res.arrayBuffer();
        latencies.push(performance.now() - requestStarted);
        statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
        if (res.status >= 400) httpErrors += 1;
      } catch {
        latencies.push(performance.now() - requestStarted);
        statuses.set('ERR', (statuses.get('ERR') || 0) + 1);
        networkErrors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  const elapsedMs = performance.now() - startedAt;

  const total = latencies.length;
  const errors = httpErrors + networkErrors;
  const sorted = [...latencies].sort((a, b) => a - b);
  const rps = elapsedMs > 0 ? (total / elapsedMs) * 1000 : 0;
  const errorRate = total > 0 ? (errors / total) * 100 : 100;

  const statusText = [...statuses.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([code, count]) => `${code}: ${count}`)
    .join(', ') || 'none';

  console.log('');
  console.log('Results');
  console.log(`  total       ${total} requests in ${Math.round(elapsedMs)} ms`);
  console.log(`  RPS         ${round(rps)}`);
  console.log(`  latency ms  p50=${round(percentile(sorted, 50))} p95=${round(percentile(sorted, 95))} p99=${round(percentile(sorted, 99))} max=${round(sorted.length ? sorted[sorted.length - 1] : 0)}`);
  console.log(`  errors      ${errors} (${round(errorRate)}%)${networkErrors ? `, network ${networkErrors}` : ''}`);
  console.log(`  status      ${statusText}`);

  if (total === 0) {
    console.error('load-test: no requests completed; increase --duration or check the target.');
    return 1;
  }
  if (errorRate > 1) {
    console.error('load-test: error rate above 1% threshold.');
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`load-test: ${err && err.stack ? err.stack : err}`);
    process.exit(2);
  });
