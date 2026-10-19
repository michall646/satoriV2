// Satori V2 — hardened process runner for the judge. Single place for:
// scrubbed env, temp cwd, output cap, timeout + hard kill.
// Sandbox gap (no cgroups/memory caps/process-tree kill) documented in docs/JUDGE_SANDBOX.md.
'use strict';

const { spawnSync } = require('node:child_process');

const OUTPUT_CAP_BYTES = 1024 * 1024; // 1 MB per stream
const ENV_PASSTHROUGH = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL', 'PATHEXT'];

// C2 (D6): per-language limits are absolute milliseconds. The old runner
// silently clamped every limit to <= 30s, so a 60s Python limit ran as 30s.
// Keep only a runaway ceiling; expose any adjustment via `limitClamped`.
const DEFAULT_TIME_MS = 2000;
const SAFE_TIME_MIN_MS = 100;
const SAFE_TIME_MAX_MS = 120000;

// Normalizes a caller-supplied limit to a safe millisecond value.
// Missing / NaN / 0 / negative / non-numeric -> DEFAULT_TIME_MS (not "clamped").
// Positive below SAFE_TIME_MIN_MS / above SAFE_TIME_MAX_MS -> clamped: true.
function clampTimeMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { timeMs: DEFAULT_TIME_MS, clamped: false };
  if (n > SAFE_TIME_MAX_MS) return { timeMs: SAFE_TIME_MAX_MS, clamped: true };
  if (n < SAFE_TIME_MIN_MS) return { timeMs: SAFE_TIME_MIN_MS, clamped: true };
  return { timeMs: Math.round(n), clamped: false };
}

function cleanEnv(extra) {
  const env = {};
  for (const k of ENV_PASSTHROUGH) if (process.env[k] != null) env[k] = process.env[k];
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  return { ...env, ...(extra || {}) };
}

function runProcess(cmd, args, opts = {}) {
  const { timeMs: limit, clamped: limitClamped } = clampTimeMs(opts.timeMs);
  const cap = Number(opts.maxOutputBytes) || OUTPUT_CAP_BYTES;
  const started = Date.now();
  const r = spawnSync(cmd, Array.isArray(args) ? args : [], {
    input: String(opts.input ?? ''),
    timeout: limit,
    killSignal: 'SIGKILL',
    cwd: opts.cwd || undefined,
    env: cleanEnv(opts.env),
    maxBuffer: cap,
    encoding: 'utf8',
  });
  const wall = Date.now() - started;
  const msg = String((r.error && r.error.message) || '');
  const outputCapped = Boolean(r.error) && (r.error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || r.error.code === 'ENOBUFS' || /maxBuffer|ENOBUFS/i.test(msg));
  // Effective limit + whether it was adjusted, on every return shape.
  const meta = { timeLimitMs: limit, limitClamped };
  if (outputCapped) {
    return { ...meta, stdout: '', stderr: '', timedOut: false, outputCapped: true, exitCode: r.status, signal: r.signal || null, wallMs: wall, spawnError: '' };
  }
  if (r.error && (r.error.code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT'))) {
    return { ...meta, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: true, outputCapped: false, exitCode: null, signal: 'SIGKILL', wallMs: wall, spawnError: '' };
  }
  // some platforms report timeout only via signal + wall clock
  if ((r.signal === 'SIGTERM' || r.signal === 'SIGKILL') && wall + 50 >= limit) {
    return { ...meta, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: true, outputCapped: false, exitCode: r.status, signal: r.signal, wallMs: wall, spawnError: '' };
  }
  return {
    ...meta,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    timedOut: false,
    outputCapped: false,
    exitCode: r.status,
    signal: r.signal || null,
    wallMs: wall,
    spawnError: r.error ? String(r.error.message).slice(0, 500) : '',
  };
}

module.exports = { runProcess, cleanEnv, clampTimeMs, OUTPUT_CAP_BYTES, DEFAULT_TIME_MS, SAFE_TIME_MIN_MS, SAFE_TIME_MAX_MS };
