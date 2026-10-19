// Lane C — judge core regressions (pure judge, no API server):
// C1 C compiles as C (gcc + sol.c), C2 limits honored > 30s, C3 Java -Xmx from
// memoryMb, C8 fixture triggers gated behind a demo flag.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  runProcess, clampTimeMs, DEFAULT_TIME_MS, SAFE_TIME_MIN_MS, SAFE_TIME_MAX_MS,
} = require('../packages/judge/src/run');
const CPP = require('../packages/judge/src/cpp');
const RUNNERS = require('../packages/judge/src/runners');
const J = require('../packages/judge/src/judge');

// C-only source: malloc without a cast is valid C but a C++ constraint
// violation — the exact bug C1 fixes (g++ was compiling .cpp for lang C).
const C_ONLY = [
  '#include <stdio.h>',
  '#include <stdlib.h>',
  'int main(void) {',
  '  int n = 3;',
  '  int *a = malloc((size_t)n * sizeof(int));',
  '  for (int i = 0; i < n; i++) a[i] = i * i;',
  '  printf("%d %d %d\\n", a[0], a[1], a[2]);',
  '  free(a);',
  '  return 0;',
  '}',
].join('\n');

// ---- C1: C compiles as C ----

test('C1: hasGcc/hasGpp probes match the host toolchain (cached)', () => {
  const raw = runProcess('gcc', ['--version'], { timeMs: 5000, maxOutputBytes: 65536 });
  const expected = !raw.spawnError && !raw.timedOut && raw.exitCode === 0;
  assert.equal(CPP.hasGcc(), expected, 'hasGcc() must match `gcc --version`');
  assert.equal(CPP.hasGcc(), CPP.hasGcc(), 'probe is cached, stable across calls');
  // C reports through gcc; C++17 keeps g++ (matrix truth).
  assert.equal(J.languageAvailability().C, CPP.hasGcc());
  assert.equal(J.languageAvailability()['C++17'], CPP.hasGpp());
});

test('C1: C-only code compiles with gcc and runs (positive)', (t) => {
  if (!CPP.hasGcc()) return t.skip('gcc not installed on this host');
  const c = CPP.compileC(C_ONLY);
  try {
    assert.equal(c.ok, true, `compileC failed:\n${c.log}`);
    assert.ok(fs.existsSync(c.binary), 'binary exists');
    const run = CPP.runBinary(c.binary, '', 10000);
    assert.equal(run.exitCode, 0, String(run.stderr || ''));
    // Windows CRT translates \n -> \r\n; the judge checker normalizes whitespace.
    assert.equal(run.stdout.replace(/\r\n/g, '\n'), '0 1 4\n');
  } finally {
    CPP.cleanupDir(c.dir);
  }
});

test('C1: compileCpp({ lang: "C" }) delegates to the gcc path (positive)', (t) => {
  if (!CPP.hasGcc()) return t.skip('gcc not installed on this host');
  const c = CPP.compileCpp(C_ONLY, { lang: 'C' });
  try {
    assert.equal(c.ok, true, `delegated compile failed:\n${c.log}`);
    const run = CPP.runBinary(c.binary, '', 10000);
    assert.equal(run.exitCode, 0, String(run.stderr || ''));
    assert.equal(run.stdout.replace(/\r\n/g, '\n'), '0 1 4\n');
  } finally {
    CPP.cleanupDir(c.dir);
  }
});

test('C1: C-only code is rejected by the C++ path (negative)', (t) => {
  if (!CPP.hasGpp()) return t.skip('g++ not installed on this host');
  const c = CPP.compileCpp(C_ONLY); // no lang -> C++17 on g++
  try {
    assert.equal(c.ok, false, 'malloc without a cast must not compile as C++');
    assert.match(c.log, /conversion|initialize|cannot/i);
    assert.equal(c.binary, undefined, 'no binary on failure');
  } finally {
    CPP.cleanupDir(c.dir);
  }
});

// ---- C2: limits are honored (no silent 30s clamp) ----

test('C2: clampTimeMs validates input and flags real clamps', () => {
  assert.deepEqual(clampTimeMs(undefined), { timeMs: DEFAULT_TIME_MS, clamped: false });
  assert.equal(clampTimeMs(0).timeMs, DEFAULT_TIME_MS, '0 -> sensible default');
  assert.equal(clampTimeMs(NaN).timeMs, DEFAULT_TIME_MS);
  assert.equal(clampTimeMs(-5).timeMs, DEFAULT_TIME_MS);
  assert.equal(clampTimeMs('garbage').timeMs, DEFAULT_TIME_MS);
  assert.deepEqual(clampTimeMs(50), { timeMs: SAFE_TIME_MIN_MS, clamped: true });
  assert.deepEqual(clampTimeMs(600000), { timeMs: SAFE_TIME_MAX_MS, clamped: true });
  assert.deepEqual(clampTimeMs(60000), { timeMs: 60000, clamped: false });
  assert.equal(SAFE_TIME_MAX_MS, 120000, 'safe ceiling raised past the old 30s');
});

test('C2: runProcess honors a 60s limit (no silent 30s clamp)', () => {
  const r = runProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeMs: 60000 });
  assert.equal(r.exitCode, 0, String(r.stderr || ''));
  assert.equal(r.stdout, 'ok');
  assert.equal(r.timeLimitMs, 60000, 'effective limit must stay 60000');
  assert.equal(r.limitClamped, false);
});

test('C2: timeout still kills a runaway process', () => {
  const r = runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeMs: 400 });
  assert.equal(r.timedOut, true);
  assert.equal(r.timeLimitMs, 400);
});

// ---- C3: Java memory ----

test('C3: javaArgs uses -Xmx from memoryMb (default 256)', () => {
  assert.deepEqual(RUNNERS.javaArgs('/tmp/x', 512), ['-Xmx512m', '-cp', '/tmp/x', 'Main']);
  assert.deepEqual(RUNNERS.javaArgs('/tmp/x'), ['-Xmx256m', '-cp', '/tmp/x', 'Main']);
  assert.deepEqual(RUNNERS.javaArgs('/tmp/x', 0), ['-Xmx256m', '-cp', '/tmp/x', 'Main']);
  assert.deepEqual(RUNNERS.javaArgs('/tmp/x', NaN), ['-Xmx256m', '-cp', '/tmp/x', 'Main']);
  assert.deepEqual(RUNNERS.javaArgs('/tmp/x', '1024'), ['-Xmx1024m', '-cp', '/tmp/x', 'Main']);
  assert.equal(J.javaArgs, RUNNERS.javaArgs, 'judge core re-exports the helper');
});

test('C3: compileJava bakes -Xmx into the run command', (t) => {
  if (!RUNNERS.hasJava()) return t.skip('javac/java not installed on this host');
  const code = 'class Main{public static void main(String[] a){System.out.println("hi");}}';
  const j = RUNNERS.compileJava(code, { memoryMb: 384 });
  try {
    assert.equal(j.ok, true, `javac failed:\n${j.log}`);
    assert.equal(j.args[0], '-Xmx384m');
    const run = runProcess(j.cmd, j.args, { input: '', timeMs: 15000, cwd: j.dir });
    assert.equal(run.exitCode, 0, String(run.stderr || ''));
    assert.equal(run.stdout.trim(), 'hi');
  } finally {
    J.cleanupDir(j.dir);
  }
});

// ---- C8: fixture triggers are demo-only ----

test('C8: magic triggers are ignored unless demo is set (judge core)', () => {
  const tle = '// TLE-TRIGGER\nint main(){return 0;}';
  const noDemo = J.simulate(tle, 'C++17', '2 3\n');
  assert.notDeepEqual(noDemo, { __sleep: true }, 'TLE-TRIGGER must not force TLE');
  assert.equal(typeof noDemo, 'string');

  const wa = '// WA-TRIGGER\nreturn 0;';
  assert.notEqual(J.simulate(wa, 'C++17', 'no numbers here\n'), 'wrong\n', 'WA-TRIGGER must not force WA');

  // demo opt-in keeps the harness fixtures available to tests.
  assert.deepEqual(J.simulate(tle, 'C++17', '2 3\n', { demo: true }), { __sleep: true });
  assert.equal(J.simulate(wa, 'C++17', 'anything\n', { demo: true }), 'wrong\n');
});
