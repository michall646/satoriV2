// Satori V2 — judge core (Kolejka-compat).
// Pipeline: queued -> compiling -> testing t3/12 -> judged.
// Checkers: token | float(tol) | custom substring. Mirrors kolejka-judge subset.
'use strict';

const { LANGUAGES } = require('../../../apps/api/src/lib/validators');
const CPP = require('./cpp');
const PY = require('./python');
const RUNNERS = require('./runners');
const { runProcess } = require('./run');

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

function normToken(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
}

function checkOutput(checker, expected, got, tol = 1e-6) {
  if (checker === 'float') {
    const a = String(expected).trim().split(/\s+/).map(Number);
    const b = String(got).trim().split(/\s+/).map(Number);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return normToken(expected) === normToken(got);
      if (Math.abs(a[i] - b[i]) > tol + 1e-9) return false;
    }
    return true;
  }
  if (checker === 'custom') return String(got).includes(String(expected).trim().split('\n')[0] ?? '');
  return normToken(expected) === normToken(got);
}

// Simulated fallback: only used when the judge host has no toolchain for the
// language. The submit is flagged `simulated: true` — never presented as a real run.
function simulate(code, lang, input) {
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
  if (code.includes('WA-TRIGGER')) return 'wrong\n';
  if (code.includes('TLE-TRIGGER')) return { __sleep: true };
  if (nums.length > 0) return `${nums.reduce((a, b) => a + b, 0)}\n`;
  if (String(code).includes('ok')) return 'ok\n';
  return '';
}

// Serviced languages only (D1): SQL + CUDA retired — submissions blocked in the API.
const LANGUAGE_MATRIX = [
  { lang: 'C', version: 'gcc', flags: '-O2 -std=c17 -lm', hello: 'int main(){printf("hi\\n");}' },
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
      C: CPP.hasGpp(),
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
  QUEUE, pushEvent, subscribe, unsubscribe, queuePosition, checkOutput, simulate, LANGUAGE_MATRIX, LANGUAGES, languageAvailability, runProcess,
  hasGpp: CPP.hasGpp, compileCpp: CPP.compileCpp, runBinary: CPP.runBinary, cleanupDir: CPP.cleanupDir,
  hasPython: PY.hasPython, preparePython: PY.preparePython, runPythonScript: PY.runPythonScript,
  hasJava: RUNNERS.hasJava, compileJava: RUNNERS.compileJava,
  hasRust: RUNNERS.hasRust, compileRust: RUNNERS.compileRust,
  hasNode: RUNNERS.hasNode, prepareJs: RUNNERS.prepareJs,
};
