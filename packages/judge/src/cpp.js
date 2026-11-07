// Satori V2 — real C/C++ runner. Compile once per submit, run once per test.
// C compiles as C: gcc + `sol.c` + -std=c17. C++ compiles as C++: g++ + `sol.cpp`.
// Hardened via run.js (env scrub, temp cwd, output cap). Sandbox gap: docs/JUDGE_SANDBOX.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./run');
const { runBinary: runSandboxedBinary } = require('./sandbox');

// C1: toolchain probes are cached — availability is asked on every submit/status call.
const PROBES = new Map();
function probeVersion(cmd) {
  if (!PROBES.has(cmd)) {
    const r = runProcess(cmd, ['--version'], { timeMs: 5000, maxOutputBytes: 65536 });
    PROBES.set(cmd, !r.spawnError && !r.timedOut && r.exitCode === 0);
  }
  return PROBES.get(cmd);
}

function hasGcc() {
  return probeVersion('gcc');
}

function hasGpp() {
  return probeVersion('g++');
}

// Shared compile path. Return shapes (unchanged): { ok:false, dir, log } |
// { ok:true, dir, binary, log }.
function compileSource(tool, std, ext, prefix, code, opts = {}) {
  if (!code || String(code).length < 2) {
    return { ok: false, log: 'error: empty source.' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const src = path.join(dir, `sol.${ext}`);
  const isWin = process.platform === 'win32';
  const binary = path.join(dir, isWin ? 'sol.exe' : 'sol');
  fs.writeFileSync(src, String(code), 'utf8');
  const compileTimeout = opts.compileTimeoutMs || 15000;
  const r = runProcess(tool, [std, '-O2', '-o', binary, src, '-lm'], { timeMs: compileTimeout, cwd: dir, maxOutputBytes: 2 * 1024 * 1024 });
  if (r.timedOut) return { ok: false, dir, log: `error: compile timeout after ${compileTimeout}ms.` };
  if (!r.spawnError && r.exitCode === 0 && fs.existsSync(binary)) {
    return { ok: true, dir, binary, log: String(r.stderr || '') };
  }
  const log = String((r.stderr || '') + (r.stdout || '') + (r.spawnError ? `\n${r.spawnError}` : '')).slice(0, 8000) || 'error: compile failed.';
  return { ok: false, dir, log };
}

// C must never be compiled by g++ (that rejected valid C and accepted C++-only code).
function compileC(code, opts = {}) {
  return compileSource('gcc', '-std=c17', 'c', 'satori-c-', code, opts);
}

function compileCpp(code, opts = {}) {
  if (opts.lang === 'C') return compileC(code, opts);
  return compileSource('g++', '-std=c++17', 'cpp', 'satori-cpp-', code, opts);
}

function runBinary(binary, input, timeMs, opts = {}) {
  return runSandboxedBinary(binary, input, timeMs, opts);
}

function cleanupDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { hasGcc, hasGpp, compileC, compileCpp, runBinary, cleanupDir };
