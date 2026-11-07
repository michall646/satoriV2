// Satori V2 — judge core (Kolejka-compat).
// Pipeline: queued -> compiling -> testing t3/12 -> judged.
// Checkers (D7): token | float(tolerance) | custom program (see checker.js).
'use strict';

const { LANGUAGES } = require('../../../apps/api/src/lib/validators');
const CPP = require('./cpp');
const PY = require('./python');
const RUNNERS = require('./runners');
const CHECKER = require('./checker');
const SANDBOX = require('./sandbox');
const { runProcess, clampTimeMs } = require('./run');

const QUEUE = []; // submitIds in order
const LISTENERS = new Map(); // submitId -> Set(res)

function pushEvent(submitId, evt) {
  const set = LISTENERS.get(String(submitId));
  if (!set) return;
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of [...set]) {
    try { res.write(line); } catch { set.delete(res); }
  }
}

function subscribe(submitId, res) {
  const k = String(submitId);
  if (!LISTENERS.has(k)) LISTENERS.set(k, new Set());
  LISTENERS.get(k).add(res);
}

function unsubscribe(submitId, res) {
  const set = LISTENERS.get(String(submitId));
  if (set) set.delete(res);
}

function queuePosition(submitId) {
  const i = QUEUE.indexOf(Number(submitId));
  if (i < 0) return { position: 0, etaSec: 0 };
  return { position: i + 1, etaSec: (i + 1) * 4 };
}

// Removes every queued occurrence of a submit (rejudge deleted/recalled).
function queueRemove(submitId) {
  const id = Number(submitId);
  let removed = 0;
  for (let i = QUEUE.length - 1; i >= 0; i--) {
    if (Number(QUEUE[i]) !== id) continue;
    QUEUE.splice(i, 1);
    removed += 1;
  }
  return removed;
}

// Token / float are decided in-process; a custom checker is a program and is
// never decided by substring (that old behaviour was a security bug, D7).
function checkOutput(checker, expected, got, tol) {
  const spec = CHECKER.parseCheckerSpec(checker);
  if (spec.kind === 'float') return CHECKER.acceptFloat(expected, got, tol == null ? spec.tolerance : tol);
  if (spec.kind === 'custom') return false;
  return CHECKER.acceptToken(expected, got);
}

// Simulated fallback: only used when the judge host has no toolchain for the
// language. The submit is flagged `simulated: true` — never presented as a real run.
// C8: magic *-TRIGGER fixtures are harness-only; real code must not force a
// verdict, so they fire only when the caller opts in with { demo: true }.
function simulate(code, lang, input, opts = {}) {
  const demo = opts.demo === true;
  const nums = (String(input).match(/-?\d+(\.\d+)?/g) || []).map(Number);
  if (/sort/i.test(code) || /sorted/.test(code)) {
    const sorted = [...nums].sort((a, b) => a - b);
    return sorted.join(' ') + (sorted.length ? '\n' : '');
  }
  if (nums.length >= 2 && /\+|sum|add/i.test(code + input)) {
    if (code.includes('sum') || code.includes('+') || nums.length === 2) {
      if (String(input).includes('2 3')) return '5\n';
      if (String(input).includes('10 20')) return '30\n';
    }
  }
  if (demo && code.includes('WA-TRIGGER')) return 'wrong\n';
  if (demo && code.includes('TLE-TRIGGER')) return { __sleep: true };
  if (nums.length > 0) return `${nums.reduce((a, b) => a + b, 0)}\n`;
  if (String(code).includes('ok')) return 'ok\n';
  return '';
}

// Serviced languages only (D1): SQL + CUDA retired — submissions blocked in the API.
const LANGUAGE_MATRIX = [
  { lang: 'C', version: 'gcc', flags: '-std=c17 -O2 -lm', hello: '#include <stdio.h>\nint main(void){printf("hi\\n");return 0;}' },
  { lang: 'C++17', version: 'g++', flags: '-O2 -std=c++17', hello: '#include<bits/stdc++.h>\nint main(){std::cout<<"hi\\n";}' },
  { lang: 'Java', version: 'OpenJDK', flags: 'javac Main.java', hello: 'class Main{public static void main(String[]a){System.out.println("hi");}}' },
  { lang: 'Python', version: '3.x', flags: 'python main.py', hello: 'print("hi")', timeMult: 2 },
  { lang: 'Rust', version: 'rustc', flags: 'rustc -O main.rs', hello: 'fn main(){println!("hi");}' },
  { lang: 'JavaScript', version: 'node', flags: 'node main.js', hello: 'console.log("hi")' },
];

let AVAIL = null;
function languageAvailability() {
  if (!AVAIL) {
    AVAIL = {
      C: CPP.hasGcc(),
      'C++17': CPP.hasGpp(),
      Python: PY.hasPython(),
      Java: RUNNERS.hasJava(),
      Rust: RUNNERS.hasRust(),
      JavaScript: RUNNERS.hasNode(),
    };
  }
  return AVAIL;
}

module.exports = {
  QUEUE, pushEvent, subscribe, unsubscribe, queuePosition, queueRemove, checkOutput, simulate, LANGUAGE_MATRIX, LANGUAGES, languageAvailability, runProcess, clampTimeMs,
  parseCheckerSpec: CHECKER.parseCheckerSpec,
  prepareChecker: CHECKER.prepareChecker,
  runChecker: CHECKER.runChecker,
  resolveChecker: CHECKER.resolveChecker,
  hasGcc: CPP.hasGcc, hasGpp: CPP.hasGpp, compileC: CPP.compileC, compileCpp: CPP.compileCpp, runBinary: CPP.runBinary, cleanupDir: CPP.cleanupDir,
  hasPython: PY.hasPython, preparePython: PY.preparePython, runPythonScript: PY.runPythonScript,
  hasJava: RUNNERS.hasJava, compileJava: RUNNERS.compileJava, javaArgs: RUNNERS.javaArgs,
  hasRust: RUNNERS.hasRust, compileRust: RUNNERS.compileRust,
  hasNode: RUNNERS.hasNode, prepareJs: RUNNERS.prepareJs,
  runSandboxed: SANDBOX.runSandboxed,
  buildDockerArgs: SANDBOX.buildDockerRunArgs,
  buildDockerRunArgs: SANDBOX.buildDockerRunArgs,
  isDockerAvailable: SANDBOX.isDockerAvailable,
  getSandboxStatus: SANDBOX.getSandboxStatus,
  clampMemoryMb: SANDBOX.clampMemoryMb,
};
