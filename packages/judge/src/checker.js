// Satori V2 — checkers (C4/D7).
// A custom checker is a real program, never a substring match:
//   checker input.txt expected.txt output.txt
// Exit 0 = accepted, 1 = wrong answer, any other exit = checker error.
// Checker errors fail closed (the test is wrong) and carry a message.
// Programs are compiled once per submit/group through the existing language
// runners and executed per test via run.js (timeout, output cap, scrubbed env).
// Hard network isolation is the sandbox task (docs/JUDGE_SANDBOX.md).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CPP = require('./cpp');
const PY = require('./python');
const RUNNERS = require('./runners');
const { runProcess } = require('./run');

const DEFAULT_TOLERANCE = 1e-6;
const CHECKER_TIME_MS = 2000;
const CHECKER_OUTPUT_BYTES = 64 * 1024; // checker stdout/stderr are messages, not solutions
const CHECKER_MESSAGE_BYTES = 2000;

const LANG_ALIASES = new Map([
  ['c', 'C'], ['gcc', 'C'],
  ['c++', 'C++17'], ['cpp', 'C++17'], ['c++17', 'C++17'], ['g++', 'C++17'],
  ['py', 'Python'], ['python', 'Python'], ['python3', 'Python'],
  ['js', 'JavaScript'], ['javascript', 'JavaScript'], ['node', 'JavaScript'], ['nodejs', 'JavaScript'],
  ['java', 'Java'],
  ['rs', 'Rust'], ['rust', 'Rust'],
]);
const EXT_LANG = {
  '.c': 'C',
  '.cpp': 'C++17', '.cc': 'C++17', '.cxx': 'C++17', '.c++': 'C++17',
  '.py': 'Python',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.java': 'Java',
  '.rs': 'Rust',
};

// 'token' | 'float' | 'float:1e-3' | 'float(1e-3)' | 'custom'.
// Any unknown legacy value is token, matching the pre-D7 judge for data written
// before the checker selector existed.
function parseCheckerSpec(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const m = text.match(/^float(?:\s*[:(]\s*([0-9.eE+-]+)\s*\)?)?$/i);
  if (m) {
    const n = m[1] == null ? DEFAULT_TOLERANCE : Number(m[1]);
    return { kind: 'float', explicit: m[1] != null, tolerance: Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCE, raw: text };
  }
  if (/^custom$/i.test(text)) return { kind: 'custom', explicit: false, tolerance: DEFAULT_TOLERANCE, raw: text };
  return { kind: 'token', explicit: false, tolerance: DEFAULT_TOLERANCE, raw: text };
}

function normalizeTolerance(value, fallback = DEFAULT_TOLERANCE) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeLang(raw) {
  if (raw == null || raw === '') return null;
  return LANG_ALIASES.get(String(raw).trim().toLowerCase()) || null;
}

// Supported languages are inferred from checkerLang first, then checkerFile.
function inferCheckerLang(file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  return EXT_LANG[ext] || null;
}

// Case > group > problem, field by field: a case may override only the tolerance
// or only the program and still inherit the rest. A tolerance embedded in the
// checker string ('float:1e-9') beats an inherited group tolerance, but an
// explicit checkerTolerance on the same row still wins.
function resolveChecker(testCase, group, problem) {
  const chain = [testCase || {}, group || {}, problem || {}];
  const first = (field) => {
    for (const row of chain) {
      if (row[field] != null && row[field] !== '') return row[field];
    }
    return undefined;
  };
  const checkerIndex = chain.findIndex((row) => row.checker != null && row.checker !== '');
  const spec = parseCheckerSpec(checkerIndex >= 0 ? chain[checkerIndex].checker : 'token');
  const rowTolerance = checkerIndex >= 0 ? chain[checkerIndex].checkerTolerance : undefined;
  const inheritedTolerance = normalizeTolerance(first('checkerTolerance'), DEFAULT_TOLERANCE);
  const tolerance = spec.explicit
    ? normalizeTolerance(rowTolerance, spec.tolerance)
    : inheritedTolerance;
  const file = first('checkerFile');
  const code = first('checkerCode');
  return {
    kind: spec.kind,
    raw: spec.raw,
    tolerance,
    lang: normalizeLang(first('checkerLang')) || inferCheckerLang(file),
    file: file == null ? null : String(file),
    code: code == null ? '' : String(code),
  };
}

// Compile (or syntax-check) once per submit/group. Returns the same descriptor
// shape for every language: { ok, lang, dir, cmd, args, log }.
function prepareChecker(code, lang, opts = {}) {
  const source = String(code == null ? '' : code);
  if (!source.trim()) {
    return { ok: false, lang: lang || null, log: 'error: custom checker has no program.' };
  }
  if (source.length > 512 * 1024) {
    return { ok: false, lang: lang || null, log: 'error: custom checker source exceeds 512KB.' };
  }
  const language = normalizeLang(lang);
  if (!language) {
    return { ok: false, lang: lang || null, log: 'error: unknown checker language. Set checkerLang or checkerFile (.c, .cpp, .py, .js, .java, .rs).' };
  }
  if (language === 'C') {
    const r = CPP.compileC(source, opts);
    return r.ok
      ? { ok: true, lang: language, dir: r.dir, cmd: r.binary, args: [], log: r.log || '' }
      : { ok: false, lang: language, dir: r.dir, log: r.log };
  }
  if (language === 'C++17') {
    const r = CPP.compileCpp(source, opts);
    return r.ok
      ? { ok: true, lang: language, dir: r.dir, cmd: r.binary, args: [], log: r.log || '' }
      : { ok: false, lang: language, dir: r.dir, log: r.log };
  }
  if (language === 'Python') {
    const r = PY.preparePython(source);
    if (!r.ok) return { ok: false, lang: language, dir: r.dir, log: r.log };
    return { ok: true, lang: language, dir: r.dir, cmd: r.cmd[0], args: [...r.cmd.slice(1), r.script], log: '' };
  }
  if (language === 'JavaScript') {
    const r = RUNNERS.prepareJs(source);
    if (!r.ok) return { ok: false, lang: language, dir: r.dir, log: r.log };
    return { ok: true, lang: language, dir: r.dir, cmd: r.cmd, args: r.args, log: '' };
  }
  if (language === 'Java') {
    const r = RUNNERS.compileJava(source, { memoryMb: opts.memoryMb });
    if (!r.ok) return { ok: false, lang: language, dir: r.dir, log: r.log };
    return { ok: true, lang: language, dir: r.dir, cmd: r.cmd, args: r.args, log: '' };
  }
  if (language === 'Rust') {
    const r = RUNNERS.compileRust(source);
    if (!r.ok) return { ok: false, lang: language, dir: r.dir, log: r.log };
    return { ok: true, lang: language, dir: r.dir, cmd: r.cmd, args: r.args, log: r.log || '' };
  }
  return { ok: false, lang: language, log: `error: unsupported checker language ${language}.` };
}

function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean) || '';
  return line.slice(0, CHECKER_MESSAGE_BYTES);
}

function checkerMessage(run) {
  return firstLine(run.stdout) || firstLine(run.stderr) || firstLine(run.spawnError);
}

// Run one compiled checker against one test. Never throws: every failure is a
// checker error (fail closed) with a message the teacher can read.
function runChecker(desc, opts = {}) {
  if (!desc || !desc.ok) {
    const log = firstLine((desc && desc.log) || 'checker is not compiled.');
    return { accepted: false, status: 'CHECKER_ERROR', message: log };
  }
  const dir = desc.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'satori-check-'));
  const files = ['input.txt', 'expected.txt', 'output.txt'].map((n) => path.join(dir, n));
  try {
    fs.writeFileSync(files[0], String(opts.input ?? ''), 'utf8');
    fs.writeFileSync(files[1], String(opts.expected ?? ''), 'utf8');
    fs.writeFileSync(files[2], String(opts.output ?? ''), 'utf8');
  } catch (e) {
    return { accepted: false, status: 'CHECKER_ERROR', message: `checker files: ${String((e && e.message) || e).slice(0, 300)}` };
  }
  const timeMs = Number(opts.timeMs) > 0 ? Number(opts.timeMs) : CHECKER_TIME_MS;
  const run = runProcess(desc.cmd, [...(desc.args || []), ...files], {
    timeMs,
    cwd: dir,
    maxOutputBytes: CHECKER_OUTPUT_BYTES,
  });
  if (run.spawnError) {
    return { accepted: false, status: 'CHECKER_ERROR', message: `checker could not start: ${run.spawnError}` };
  }
  if (run.timedOut) {
    return { accepted: false, status: 'CHECKER_ERROR', message: `checker timed out after ${timeMs}ms` };
  }
  if (run.outputCapped) {
    return { accepted: false, status: 'CHECKER_ERROR', message: 'checker output limit exceeded' };
  }
  const detail = checkerMessage(run);
  if (run.exitCode === 0) return { accepted: true, status: 'OK', message: '' };
  if (run.exitCode === 1) return { accepted: false, status: 'WA', message: detail || 'wrong answer' };
  return { accepted: false, status: 'CHECKER_ERROR', message: `checker error (exit ${run.exitCode}): ${detail || 'no message'}` };
}

function normToken(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
}

function acceptToken(expected, got) {
  return normToken(expected) === normToken(got);
}

function acceptFloat(expected, got, tolerance = DEFAULT_TOLERANCE) {
  const tol = normalizeTolerance(tolerance);
  const a = String(expected).trim().split(/\s+/).map(Number);
  const b = String(got).trim().split(/\s+/).map(Number);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return acceptToken(expected, got);
    if (Math.abs(a[i] - b[i]) > tol + 1e-9) return false;
  }
  return true;
}

module.exports = {
  DEFAULT_TOLERANCE,
  CHECKER_TIME_MS,
  CHECKER_OUTPUT_BYTES,
  parseCheckerSpec,
  normalizeTolerance,
  normalizeLang,
  inferCheckerLang,
  resolveChecker,
  prepareChecker,
  runChecker,
  firstLine,
  acceptToken,
  acceptFloat,
};
