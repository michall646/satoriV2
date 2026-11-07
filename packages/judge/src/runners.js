// Satori V2 — Java / Rust / JavaScript runners (D1: real runners, no simulate).
// Each runner returns { ok, dir, cmd, args, log } — one command to execute per test.
// Hardened via run.js (env scrub, temp cwd, output cap). Sandbox gap: docs/JUDGE_SANDBOX.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./run');

function probe(cmd, args) {
  const r = runProcess(cmd, args, { timeMs: 5000, maxOutputBytes: 65536 });
  return !r.spawnError && !r.timedOut && r.exitCode === 0;
}

const CACHE = new Map();
function cached(key, fn) {
  if (!CACHE.has(key)) CACHE.set(key, fn());
  return CACHE.get(key);
}

function findJavaCmd() {
  return cached('javaCmd', () => {
    if (process.env.JAVA_HOME) {
      const bin = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(bin)) return bin;
    }
    return 'java';
  });
}

function findJavacCmd() {
  return cached('javacCmd', () => {
    if (process.env.JAVA_HOME) {
      const bin = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
      if (fs.existsSync(bin)) return bin;
    }
    return 'javac';
  });
}

function hasJava() {
  return cached('java', () => {
    const javac = findJavacCmd();
    const java = findJavaCmd();
    if (!probe(javac, ['-version']) || !probe(java, ['-version'])) return false;
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-probe-'));
      const src = path.join(dir, 'Probe.java');
      fs.writeFileSync(src, 'public class Probe{public static void main(String[] a){}}', 'utf8');
      const c = runProcess(javac, [src], { timeMs: 5000, cwd: dir });
      if (c.exitCode !== 0) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        return false;
      }
      const r = runProcess(java, ['-cp', dir, 'Probe'], { timeMs: 5000, cwd: dir });
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      return r.exitCode === 0;
    } catch {
      return false;
    }
  });
}
function hasRust() {
  return cached('rust', () => probe('rustc', ['--version']));
}
function findNode() {
  return cached('node', () => (probe('node', ['--version']) ? 'node' : null));
}
function hasNode() {
  return Boolean(findNode());
}

// C3: the Java heap comes from the problem's memoryMb. Note -Xmx caps only the
// Java heap — total JVM footprint is usually 2-3x that (metaspace, thread
// stacks, GC). The runner does not enforce memory yet (docs/JUDGE_SANDBOX.md).
const DEFAULT_JAVA_MEMORY_MB = 256;

function javaArgs(dir, memoryMb) {
  const n = Number(memoryMb);
  const mb = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_JAVA_MEMORY_MB;
  return [`-Xmx${mb}m`, '-cp', dir, 'Main'];
}

function compileJava(code, opts = {}) {
  if (!code || String(code).length < 2) return { ok: false, log: 'error: empty source.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-java-'));
  const src = path.join(dir, 'Main.java');
  fs.writeFileSync(src, String(code), 'utf8');
  const javac = findJavacCmd();
  const java = findJavaCmd();
  const r = runProcess(javac, ['-encoding', 'UTF-8', src], { timeMs: 30000, cwd: dir, maxOutputBytes: 2 * 1024 * 1024 });
  if (!r.spawnError && !r.timedOut && r.exitCode === 0 && fs.existsSync(path.join(dir, 'Main.class'))) {
    return { ok: true, dir, cmd: java, args: javaArgs(dir, opts.memoryMb), log: '' };
  }
  const log = String((r.stderr || '') + (r.stdout || '') + (r.spawnError ? `\n${r.spawnError}` : '')).trim().slice(0, 8000) || 'error: compile failed. Hint: the entry class must be named Main.';
  return { ok: false, dir, log };
}

function compileRust(code) {
  if (!code || String(code).length < 2) return { ok: false, log: 'error: empty source.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-rs-'));
  const src = path.join(dir, 'main.rs');
  const binary = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
  fs.writeFileSync(src, String(code), 'utf8');
  const r = runProcess('rustc', ['-O', '-o', binary, src], { timeMs: 30000, cwd: dir, maxOutputBytes: 2 * 1024 * 1024 });
  if (!r.spawnError && !r.timedOut && r.exitCode === 0 && fs.existsSync(binary)) {
    return { ok: true, dir, cmd: binary, args: [], log: String(r.stderr || '') };
  }
  const log = String((r.stderr || '') + (r.stdout || '') + (r.spawnError ? `\n${r.spawnError}` : '')).slice(0, 8000) || 'error: compile failed.';
  return { ok: false, dir, log };
}

function prepareJs(code) {
  if (!code || String(code).length < 2) return { ok: false, log: 'error: empty source.' };
  const node = findNode();
  if (!node) return { ok: false, log: 'error: no node found.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'satori-js-'));
  const script = path.join(dir, 'main.js');
  fs.writeFileSync(script, String(code), 'utf8');
  return { ok: true, dir, cmd: node, args: [script], log: '' };
}

module.exports = { hasJava, hasRust, hasNode, findNode, compileJava, javaArgs, compileRust, prepareJs };
