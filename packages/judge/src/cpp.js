// Satori V2 — real C/C++ runner. Compile once per submit, run once per test.
// Hardened via run.js (env scrub, temp cwd, output cap). Sandbox gap: docs/JUDGE_SANDBOX.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./run');

function hasGpp() {
  const r = runProcess('g++', ['--version'], { timeMs: 5000, maxOutputBytes: 65536 });
  return !r.spawnError && !r.timedOut && r.exitCode === 0;
}

function compileCpp(code, opts = {}) {
  if (!code || String(code).length < 2) {
    return { ok: false, log: 'error: empty source.' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-cpp-'));
  const src = path.join(dir, 'sol.cpp');
  const isWin = process.platform === 'win32';
  const binary = path.join(dir, isWin ? 'sol.exe' : 'sol');
  fs.writeFileSync(src, String(code), 'utf8');
  const compileTimeout = opts.compileTimeoutMs || 15000;
  const std = opts.lang === 'C' ? '-std=c17' : '-std=c++17';
  const r = runProcess('g++', ['-O2', std, '-o', binary, src], { timeMs: compileTimeout, cwd: dir, maxOutputBytes: 2 * 1024 * 1024 });
  if (r.timedOut) return { ok: false, dir, log: `error: compile timeout after ${compileTimeout}ms.` };
  if (!r.spawnError && r.exitCode === 0 && fs.existsSync(binary)) {
    return { ok: true, dir, binary, log: String(r.stderr || '') };
  }
  const log = String((r.stderr || '') + (r.stdout || '') + (r.spawnError ? `\n${r.spawnError}` : '')).slice(0, 8000) || 'error: compile failed.';
  return { ok: false, dir, log };
}

function runBinary(binary, input, timeMs) {
  return runProcess(binary, [], { input, timeMs, cwd: path.dirname(binary) });
}

function cleanupDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { hasGpp, compileCpp, runBinary, cleanupDir };
