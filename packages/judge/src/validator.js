// Satori V2 — test input validators (C5).
// A validator is a real program, like a custom checker:
//   validator <input-file>
// Exit 0 = input is valid, 1 = invalid, any other exit = validator error.
// The input is also piped on stdin so a validator written against stdin works
// ("or stdin fallback"); the file path stays the canonical contract.
// Programs are compiled once per authoring run, then executed per case via
// run.js (2s timeout, output cap, scrubbed env). Any validator error fails
// closed: the case is reported invalid with a message the teacher can read.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CPP = require('./cpp');
const PY = require('./python');
const RUNNERS = require('./runners');
const { runProcess } = require('./run');
const { normalizeLang, inferCheckerLang } = require('./checker');

const VALIDATOR_TIME_MS = 2000;
const VALIDATOR_OUTPUT_BYTES = 64 * 1024;
const VALIDATOR_MESSAGE_BYTES = 2000;
const MAX_SOURCE_BYTES = 512 * 1024;

function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean) || '';
  return line.slice(0, VALIDATOR_MESSAGE_BYTES);
}

function clipMessage(text) {
  return String(text || '').trim().slice(0, VALIDATOR_MESSAGE_BYTES);
}

// Compiles (or syntax-checks) any supported program once. Shared by validators
// and the reference-solution runner so both use the exact same language paths.
// Returns { ok, lang, dir, cmd, args, log }.
function prepareProgram(code, lang, opts = {}) {
  const label = opts.label || 'program';
  const source = String(code == null ? '' : code);
  if (!source.trim()) {
    return { ok: false, lang: lang || null, log: `error: ${label} has no program.` };
  }
  if (source.length > MAX_SOURCE_BYTES) {
    return { ok: false, lang: lang || null, log: `error: ${label} source exceeds 512KB.` };
  }
  const language = normalizeLang(lang) || inferCheckerLang(lang);
  if (!language) {
    return { ok: false, lang: lang || null, log: `error: unknown ${label} language. Set the language or infer it from the file extension (.c, .cpp, .py, .js, .java, .rs).` };
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
  return { ok: false, lang: language, log: `error: unsupported ${label} language ${language}.` };
}

function prepareValidator(code, lang, opts = {}) {
  return prepareProgram(code, lang, { ...opts, label: opts.label || 'validator' });
}

// Resolution mirrors checkers: case > group > problem, field by field. A group
// may override only the program or only the language and still inherit the
// rest. `validator: "none"` / "off" disables an inherited validator.
const VALIDATOR_FIELDS = ['validator', 'validatorLang', 'validatorCode', 'validatorFile'];

function resolveValidator(testCase, group, problem) {
  const chain = [testCase || {}, group || {}, problem || {}];
  const first = (field) => {
    for (const row of chain) {
      if (row[field] != null && row[field] !== '') return row[field];
    }
    return undefined;
  };
  const flag = first('validator');
  const disabled = flag != null && /^(none|off|disabled|0)$/i.test(String(flag).trim());
  const file = first('validatorFile');
  const code = String(first('validatorCode') ?? '');
  const lang = normalizeLang(first('validatorLang')) || inferCheckerLang(file);
  const configured = !disabled && (Boolean(flag) || Boolean(code.trim()) || Boolean(file));
  return {
    configured,
    validator: flag == null ? null : String(flag),
    lang,
    file: file == null ? null : String(file),
    code,
  };
}

function hasValidatorConfig(row) {
  if (!row || typeof row !== 'object') return false;
  for (const f of VALIDATOR_FIELDS) {
    if (row[f] != null && row[f] !== '') return true;
  }
  return false;
}

function cleanupProgram(desc) {
  if (desc && desc.dir) CPP.cleanupDir(desc.dir);
}

// Run one compiled validator against one case. Never throws; every failure is a
// validator error (valid=false, ok=false) carrying a message.
function runValidator({ lang, code, file, input, program, timeMs } = {}) {
  let own = null;
  let desc = program || null;
  if (!desc) {
    own = prepareValidator(code, normalizeLang(lang) || inferCheckerLang(file));
    desc = own;
  }
  if (!desc || !desc.ok) {
    if (own) cleanupProgram(own);
    return { ok: false, valid: false, message: clipMessage((desc && desc.log) || 'validator is not compiled.') || 'validator is not compiled.' };
  }
  const dir = desc.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'satori-validator-'));
  const inputPath = path.join(dir, 'input.txt');
  const text = String(input ?? '');
  try {
    fs.writeFileSync(inputPath, text, 'utf8');
  } catch (e) {
    if (own) cleanupProgram(desc);
    return { ok: false, valid: false, message: `validator input file: ${clipMessage((e && e.message) || e)}` };
  }
  const limit = Number(timeMs) > 0 ? Math.round(Number(timeMs)) : VALIDATOR_TIME_MS;
  let run;
  try {
    run = runProcess(desc.cmd, [...(desc.args || []), inputPath], {
      timeMs: limit,
      cwd: dir,
      input: text,
      maxOutputBytes: VALIDATOR_OUTPUT_BYTES,
    });
  } finally {
    if (own) cleanupProgram(desc);
  }
  if (run.spawnError) {
    return { ok: false, valid: false, message: `validator could not start: ${clipMessage(run.spawnError)}` };
  }
  if (run.timedOut) {
    return { ok: false, valid: false, message: `validator timed out after ${limit}ms` };
  }
  if (run.outputCapped) {
    return { ok: false, valid: false, message: 'validator output limit exceeded' };
  }
  const detail = firstLine(run.stderr) || firstLine(run.stdout);
  if (run.exitCode === 0) return { ok: true, valid: true, message: '' };
  if (run.exitCode === 1) return { ok: true, valid: false, message: detail || 'invalid input' };
  return {
    ok: false,
    valid: false,
    message: `validator error (exit ${run.exitCode == null ? 'none' : run.exitCode}): ${detail || 'no message'}`,
  };
}

module.exports = {
  VALIDATOR_TIME_MS,
  VALIDATOR_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  VALIDATOR_FIELDS,
  prepareProgram,
  prepareValidator,
  resolveValidator,
  hasValidatorConfig,
  runValidator,
  cleanupProgram,
  firstLine,
};
