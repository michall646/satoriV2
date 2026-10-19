// Satori V2 — hardened process runner for the judge. Single place for:
// scrubbed env, temp cwd, output cap, timeout + hard kill.
// Sandbox gap (no cgroups/memory caps/process-tree kill) documented in docs/JUDGE_SANDBOX.md.
'use strict';

const { spawnSync } = require('node:child_process');

const OUTPUT_CAP_BYTES = 1024 * 1024; // 1 MB per stream
const ENV_PASSTHROUGH = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'LANG', 'LC_ALL', 'PATHEXT'];

function cleanEnv(extra) {
  const env = {};
  for (const k of ENV_PASSTHROUGH) if (process.env[k] != null) env[k] = process.env[k];
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  return { ...env, ...(extra || {}) };
}

function runProcess(cmd, args, opts = {}) {
  const limit = Math.max(100, Math.min(Number(opts.timeMs) || 2000, 30000));
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
  if (outputCapped) {
    return { stdout: '', stderr: '', timedOut: false, outputCapped: true, exitCode: r.status, signal: r.signal || null, wallMs: wall, spawnError: '' };
  }
  if (r.error && (r.error.code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT'))) {
    return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: true, outputCapped: false, exitCode: null, signal: 'SIGKILL', wallMs: wall, spawnError: '' };
  }
  // some platforms report timeout only via signal + wall clock
  if ((r.signal === 'SIGTERM' || r.signal === 'SIGKILL') && wall + 50 >= limit) {
    return { stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), timedOut: true, outputCapped: false, exitCode: r.status, signal: r.signal, wallMs: wall, spawnError: '' };
  }
  return {
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

module.exports = { runProcess, cleanEnv, OUTPUT_CAP_BYTES };
