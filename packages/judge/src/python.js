// Satori V2 — real Python runner. Syntax-check once per submit, run once per test.
// Hardened via run.js (env scrub, temp cwd, output cap). Sandbox gap: docs/JUDGE_SANDBOX.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./run');

function findPython() {
  const candidates = process.platform === 'win32'
    ? [['python3'], ['python'], ['py']]
    : [['python3'], ['python']];
  for (const cmd of candidates) {
    const r = runProcess(cmd[0], [...cmd.slice(1), '--version'], { timeMs: 5000, maxOutputBytes: 65536 });
    if (!r.spawnError && !r.timedOut && r.exitCode === 0) return cmd;
  }
  return null;
}

let CACHED = null;
function pythonCmd() {
  if (!CACHED) CACHED = findPython();
  return CACHED;
}

function hasPython() {
  return Boolean(pythonCmd());
}

function preparePython(code) {
  if (!code || String(code).length < 2) {
    return { ok: false, log: 'error: empty source.' };
  }
  const cmd = pythonCmd();
  if (!cmd) return { ok: false, log: 'error: no python3 found.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-py-'));
  const script = path.join(dir, 'main.py');
  fs.writeFileSync(script, String(code), 'utf8');
  const r = runProcess(cmd[0], [...cmd.slice(1), '-m', 'py_compile', script], { timeMs: 10000, cwd: dir, maxOutputBytes: 2 * 1024 * 1024 });
  if (!r.spawnError && !r.timedOut && r.exitCode === 0) {
    return { ok: true, dir, script, cmd, log: '' };
  }
  const log = String((r.stderr || '') + (r.stdout || '') + (r.spawnError ? `\n${r.spawnError}` : '')).slice(0, 8000) || 'error: syntax error.';
  return { ok: false, dir, script, cmd, log };
}

function runPythonScript(cmd, script, input, timeMs) {
  return runProcess(cmd[0], [...cmd.slice(1), script], { input, timeMs, cwd: path.dirname(script) });
}

function cleanupDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { hasPython, pythonCmd, preparePython, runPythonScript, cleanupDir };
