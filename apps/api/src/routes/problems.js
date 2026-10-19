// Satori V2 — problem reads/writes, tests, stats, clone, rejudge, submit.
'use strict';
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const CHECKER = require('../../../../packages/judge/src/checker');
const VALIDATOR = require('../../../../packages/judge/src/validator');
const { send, readBody } = require('../lib/http');
const { authUser, needAuth, forbid, audit, canManageProblem, canManageContest, canReadContest, reqLang, localizeRow, submitView, teamHasMember } = require('../lib/authz');
const { enrichProblemWithDeadline } = require('../lib/contestAccess');
const { isAccepted } = require('../lib/ranking');
const { fireWebhooks } = require('./webhooks');
const { processQueue } = require('../lib/judgeWorker');
const { createSubmit } = require('../lib/createSubmit');

// A13: test authoring accepts only these fields; problemId/groupId are checked against
// the URL problem so an admin of contest A cannot write into contest B's tests.
const GROUP_FIELDS = ['name', 'points', 'subtask', 'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile', 'timeMs', 'memoryMb', 'order', 'validator', 'validatorLang', 'validatorCode', 'validatorFile'];
const CASE_FIELDS = ['groupId', 'name', 'input', 'expected', 'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile', 'timeMs', 'memoryMb', 'points', 'subtask'];
// C10: PATCH is whitelisted — a client cannot overwrite contestId, setterId or version.
const PROBLEM_PATCH_FIELDS = [
  'name', 'code', 'tags', 'difficulty', 'deadlineAt', 'setId', 'weight',
  'statementMd', 'statementMdEn', 'statementHtml', 'samples', 'limits',
  'visibility', 'aliasLetters', 'quarantineReason',
  'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile',
  'validator', 'validatorLang', 'validatorCode', 'validatorFile',
  'referenceCode', 'referenceLang',
];
// C5: authoring programs are capped like checker programs, never stored unbounded.
const PROGRAM_SOURCE_MAX = 512 * 1024;
const DIFF_TEXT_MAX = 4000;
const STRESS_MAX_ROUNDS = 50;
const STRESS_MAX_INPUT_BYTES = 64 * 1024;
// C12: these fields form a version snapshot when they change.
const VERSION_FIELDS = ['name', 'code', 'tags', 'difficulty', 'statementMd', 'statementMdEn', 'samples', 'limits'];
const TEST_NUMERIC_FIELDS = ['points', 'order', 'timeMs', 'memoryMb', 'subtask'];

function pickFields(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj || {}, f)) out[f] = obj[f];
  return out;
}
function groupMismatch(res) {
  return send(res, 403, { error: { code: 'GROUP_MISMATCH', message: 'Test group does not belong to this problem.', hint: 'Reload the problem tests.' } });
}
function caseMismatch(res) {
  return send(res, 403, { error: { code: 'CASE_MISMATCH', message: 'Test case does not belong to this problem.', hint: 'Reload the problem tests.' } });
}
function demoTriggers() {
  return process.env.SATORI_DEMO_TRIGGERS === '1';
}
function testGateExempt(pr) {
  return demoTriggers() || pr.demoFixture === true;
}
function hasTests(pr) {
  const groups = store.query('testGroups', (g) => String(g.problemId) === String(pr.id));
  return groups.some((g) => store.query('testCases', (c) => String(c.groupId) === String(g.id)).length > 0);
}
function noTests(res, status, message) {
  return send(res, status, {
    error: { code: 'NO_TESTS', message, hint: 'Add at least one test case in the problem editor, then publish or submit.' },
  });
}
// Shared admin gate for the C6/C12 authoring routes. Sends the rejection itself.
function managedProblem(req, res, id) {
  const pr = store.get('problems', id);
  if (!pr) { send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } }); return null; }
  const me = needAuth(req, res);
  if (!me) return null;
  if (!canManageProblem(me, pr)) { forbid(res); return null; }
  return { pr, me };
}
function numericFieldsOk(obj) {
  for (const field of TEST_NUMERIC_FIELDS) {
    if (obj[field] === undefined) continue;
    const n = Number(obj[field]);
    if (!Number.isFinite(n) || n < 0) return false;
  }
  return true;
}
function dateOrNull(value) {
  if (value == null || value === '') return { ok: true, value: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}
function groupsWithCases(problemId) {
  const groups = store.query('testGroups', (g) => String(g.problemId) === String(problemId))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || Number(a.id) - Number(b.id));
  return groups.map((g) => ({ ...g, cases: store.query('testCases', (c) => String(c.groupId) === String(g.id)) }));
}

// C5: every authoring run walks the same ordered test tree as the judge.
function allCaseRows(pr) {
  const groups = store.query('testGroups', (g) => String(g.problemId) === String(pr.id))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || Number(a.id) - Number(b.id));
  const rows = [];
  for (const g of groups) {
    const cases = store.query('testCases', (c) => String(c.groupId) === String(g.id))
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const tc of cases) rows.push({ tc, group: g });
  }
  return rows.map((row, i) => ({ ...row, n: i + 1 }));
}

function clipText(value, max = DIFF_TEXT_MAX) {
  const s = String(value == null ? '' : value);
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s;
}

// Case > group > problem, like checkers. Un-configured rows stay valid: a group
// validator can cover one group and leave the rest alone.
function validatorConfigFor(row, pr, override) {
  const overrideFields = override ? pickFields(override, VALIDATOR.VALIDATOR_FIELDS) : {};
  if (VALIDATOR.hasValidatorConfig(overrideFields)) {
    return VALIDATOR.resolveValidator(overrideFields, {}, pr);
  }
  return VALIDATOR.resolveValidator(row.tc, row.group, pr);
}

// Compile each distinct validator once, then run it over every case input.
// A configured validator with no runnable program fails closed (invalid).
function runValidatorOverCases(pr, override) {
  const rows = allCaseRows(pr);
  const compiled = new Map();
  const cases = [];
  let compileLog = '';
  for (const row of rows) {
    const cfg = validatorConfigFor(row, pr, override);
    if (!cfg.configured) {
      cases.push({ n: row.n, caseId: row.tc.id, caseName: row.tc.name || null, valid: true, message: '' });
      continue;
    }
    const key = `${cfg.lang || ''}\u0000${cfg.file || ''}\u0000${cfg.code}`;
    let desc = compiled.get(key);
    if (!desc) {
      desc = VALIDATOR.prepareValidator(cfg.code, cfg.lang || cfg.file, { memoryMb: pr.limits && pr.limits.memoryMb });
      compiled.set(key, desc);
      if (!desc.ok && !compileLog) compileLog = clipText(desc.log, 2000);
    }
    const r = VALIDATOR.runValidator({ program: desc, input: row.tc.input });
    cases.push({ n: row.n, caseId: row.tc.id, caseName: row.tc.name || null, valid: r.valid, message: r.message || '' });
  }
  for (const desc of compiled.values()) VALIDATOR.cleanupProgram(desc);
  return { ok: cases.every((x) => x.valid), cases, compileLog };
}

function referenceConfigFor(pr, override) {
  const has = (f) => override && Object.prototype.hasOwnProperty.call(override, f);
  const rawCode = has('referenceCode') ? override.referenceCode : (pr.referenceCode || '');
  const langRaw = has('referenceLang') ? override.referenceLang : pr.referenceLang;
  return { code: rawCode == null ? '' : String(rawCode), lang: CHECKER.normalizeLang(langRaw), langRaw: langRaw || null };
}

function caseLimitMs(pr, tc, lang) {
  const limits = (pr && pr.limits) || {};
  const perLang = (limits.perLang && limits.perLang[lang]) || limits.timeMs || 1000;
  return Number(tc && tc.timeMs) || Number(perLang) || 1000;
}

// One run of a compiled program with one input. Never throws.
function runProgramCase(desc, pr, tc, input) {
  const limit = caseLimitMs(pr, tc || {}, desc.lang);
  const run = J.runProcess(desc.cmd, desc.args, { input: String(input ?? ''), timeMs: limit, cwd: desc.dir });
  if (run.timedOut) return { ok: false, verdict: 'TLE', message: `exceeded ${limit}ms`, stdout: run.stdout || '', wallMs: run.wallMs };
  if (run.outputCapped) return { ok: false, verdict: 'RE', message: 'output limit exceeded (1 MB cap)', stdout: '', wallMs: run.wallMs };
  if (run.exitCode !== 0) {
    return { ok: false, verdict: 'RE', message: clipText(String(run.stderr || run.spawnError || `exit code ${run.exitCode}`), 500), stdout: run.stdout || '', wallMs: run.wallMs };
  }
  return { ok: true, verdict: 'OK', message: '', stdout: run.stdout || '', wallMs: run.wallMs };
}

// Reference verdicts use the same checker resolution as the judge (D7).
function evaluateReferenceCase(pr, tc, group, got, checkerCache) {
  const cfg = CHECKER.resolveChecker(tc, group, pr);
  if (cfg.kind === 'custom') {
    if (!cfg.code.trim()) return { ok: false, verdict: 'CHECKER_ERROR', message: 'custom checker has no program.' };
    const key = `${cfg.lang || ''}\u0000${cfg.code}`;
    if (!checkerCache.has(key)) {
      checkerCache.set(key, CHECKER.prepareChecker(cfg.code, cfg.lang, { memoryMb: pr.limits && pr.limits.memoryMb }));
    }
    const desc = checkerCache.get(key);
    if (!desc.ok) return { ok: false, verdict: 'CHECKER_ERROR', message: `checker compile failed: ${CHECKER.firstLine(desc.log) || 'unknown error'}` };
    const r = CHECKER.runChecker(desc, { input: tc.input, expected: tc.expected, output: got });
    if (r.accepted) return { ok: true, verdict: 'OK', message: '' };
    return { ok: false, verdict: r.status === 'CHECKER_ERROR' ? 'CHECKER_ERROR' : 'WA', message: r.message || 'wrong answer' };
  }
  const ok = cfg.kind === 'float'
    ? CHECKER.acceptFloat(tc.expected, got, cfg.tolerance)
    : CHECKER.acceptToken(tc.expected, got);
  return { ok, verdict: ok ? 'OK' : 'WA', message: '' };
}

function runReferenceOverCases(pr, cfg) {
  const desc = VALIDATOR.prepareProgram(cfg.code, cfg.lang, { label: 'reference solution', memoryMb: pr.limits && pr.limits.memoryMb });
  if (!desc.ok) {
    return { ok: false, cases: [], firstDiff: null, compileLog: clipText(desc.log, 4000), message: 'Reference solution failed to compile.' };
  }
  const rows = allCaseRows(pr);
  const checkerCache = new Map();
  const cases = [];
  try {
    for (const row of rows) {
      const run = runProgramCase(desc, pr, row.tc, row.tc.input);
      let verdict = run.verdict;
      let message = run.message;
      let got = run.stdout;
      if (run.ok) {
        got = run.stdout;
        const ev = evaluateReferenceCase(pr, row.tc, row.group, got, checkerCache);
        verdict = ev.verdict;
        message = ev.message;
      }
      const bad = verdict !== 'OK';
      if (bad && !message) {
        message = `expected ${clipText(JSON.stringify(String(row.tc.expected ?? '')), 200)} got ${clipText(JSON.stringify(got), 200)}`;
      }
      cases.push({
        n: row.n,
        caseId: row.tc.id,
        caseName: row.tc.name || null,
        verdict,
        timeMs: Math.max(1, Number(run.wallMs) || 1),
        message: bad ? message : '',
        ...(bad ? { expected: clipText(row.tc.expected), got: clipText(got) } : {}),
      });
    }
  } finally {
    VALIDATOR.cleanupProgram(desc);
    for (const d of checkerCache.values()) VALIDATOR.cleanupProgram(d);
  }
  const firstDiff = cases.find((x) => x.verdict !== 'OK') || null;
  return {
    ok: cases.length > 0 && !firstDiff,
    cases,
    firstDiff: firstDiff
      ? { n: firstDiff.n, caseId: firstDiff.caseId, caseName: firstDiff.caseName, verdict: firstDiff.verdict, expected: firstDiff.expected, got: firstDiff.got, message: firstDiff.message }
      : null,
    compileLog: clipText(desc.log, 4000),
    ...(cases.length ? {} : { message: 'This problem has no test cases.' }),
  };
}

function generateMissingExpected(pr, cfg) {
  const desc = VALIDATOR.prepareProgram(cfg.code, cfg.lang, { label: 'reference solution', memoryMb: pr.limits && pr.limits.memoryMb });
  if (!desc.ok) {
    return { ok: false, changed: 0, considered: 0, cases: [], compileLog: clipText(desc.log, 4000), message: 'Reference solution failed to compile.' };
  }
  const targets = allCaseRows(pr).filter((row) => String(row.tc.expected ?? '').trim() === '');
  const cases = [];
  let changed = 0;
  try {
    for (const row of targets) {
      const run = runProgramCase(desc, pr, row.tc, row.tc.input);
      if (!run.ok) {
        cases.push({ n: row.n, caseId: row.tc.id, changed: false, verdict: run.verdict, message: run.message });
        continue;
      }
      store.update('testCases', row.tc.id, { expected: run.stdout });
      changed += 1;
      cases.push({ n: row.n, caseId: row.tc.id, changed: true, verdict: 'OK', message: '' });
    }
  } finally {
    VALIDATOR.cleanupProgram(desc);
  }
  return { ok: cases.every((x) => x.changed), changed, considered: targets.length, cases, compileLog: '' };
}

// C5 optional stress: reference vs brute on generated small inputs.
function runStress(pr, body) {
  const refCfg = referenceConfigFor(pr, body);
  if (!refCfg.code.trim()) {
    return { error: { code: 'NO_REFERENCE', message: 'Reference solution is not configured.', hint: 'Set referenceLang and referenceCode first.' } };
  }
  if (!String(body.bruteCode || '').trim()) {
    return { error: { code: 'NO_BRUTE', message: 'bruteCode is required.', hint: 'Provide a brute-force program to compare against the reference.' } };
  }
  if (!String(body.generatorCode || '').trim()) {
    return { error: { code: 'NO_GENERATOR', message: 'generatorCode is required.', hint: 'Provide a program that prints one random input to stdout.' } };
  }
  const rounds = body.rounds == null || body.rounds === '' ? 10 : Number(body.rounds);
  if (!Number.isInteger(rounds) || rounds < 1) {
    return { error: { code: 'ROUNDS', message: 'rounds must be a positive integer.', hint: '' } };
  }
  if (rounds > STRESS_MAX_ROUNDS) {
    return { error: { code: 'TOO_LARGE', message: `Stress rounds must be at most ${STRESS_MAX_ROUNDS}.`, hint: 'Reduce rounds and run again.' } };
  }
  const bruteLang = body.bruteLang ? CHECKER.normalizeLang(body.bruteLang) : refCfg.lang;
  if (!bruteLang) {
    return { error: { code: 'BRUTE_LANG', message: 'Unknown bruteLang.', hint: 'Use C, C++17, Python, JavaScript, Java or Rust.' } };
  }
  const generatorLang = body.generatorLang ? CHECKER.normalizeLang(body.generatorLang) : bruteLang;
  if (!generatorLang) {
    return { error: { code: 'GENERATOR_LANG', message: 'Unknown generatorLang.', hint: 'Use C, C++17, Python, JavaScript, Java or Rust.' } };
  }
  const refDesc = VALIDATOR.prepareProgram(refCfg.code, refCfg.lang, { label: 'reference solution', memoryMb: pr.limits && pr.limits.memoryMb });
  const bruteDesc = VALIDATOR.prepareProgram(String(body.bruteCode), bruteLang, { label: 'brute solution', memoryMb: pr.limits && pr.limits.memoryMb });
  const genDesc = VALIDATOR.prepareProgram(String(body.generatorCode), generatorLang, { label: 'generator', memoryMb: pr.limits && pr.limits.memoryMb });
  const descs = [refDesc, bruteDesc, genDesc];
  const compileLog = descs.filter((d) => !d.ok).map((d) => d.log).filter(Boolean).join('\n');
  if (compileLog) {
    for (const d of descs) VALIDATOR.cleanupProgram(d);
    return { ok: false, rounds: 0, mismatches: [], errors: [], compileLog: clipText(compileLog, 4000), message: 'Stress programs failed to compile.' };
  }
  const mismatches = [];
  const errors = [];
  try {
    for (let i = 1; i <= rounds; i++) {
      const gen = runProgramCase(genDesc, pr, {}, '');
      if (!gen.ok) { errors.push({ n: i, message: `generator ${gen.verdict}: ${gen.message}` }); continue; }
      if (Buffer.byteLength(gen.stdout, 'utf8') > STRESS_MAX_INPUT_BYTES) {
        errors.push({ n: i, message: 'generated input exceeds 64KB; round skipped' });
        continue;
      }
      const input = gen.stdout;
      const ref = runProgramCase(refDesc, pr, {}, input);
      if (!ref.ok) {
        errors.push({ n: i, input: clipText(input, 1000), message: `reference ${ref.verdict}: ${ref.message}` });
        continue;
      }
      const brute = runProgramCase(bruteDesc, pr, {}, input);
      if (!brute.ok) {
        mismatches.push({ n: i, input: clipText(input, 1000), reference: clipText(ref.stdout, 1000), brute: '', message: `brute ${brute.verdict}: ${brute.message}` });
        continue;
      }
      if (!CHECKER.acceptToken(ref.stdout, brute.stdout)) {
        mismatches.push({ n: i, input: clipText(input, 1000), reference: clipText(ref.stdout, 1000), brute: clipText(brute.stdout, 1000), message: 'reference and brute disagree' });
      }
    }
  } finally {
    for (const d of descs) VALIDATOR.cleanupProgram(d);
  }
  return { ok: mismatches.length === 0 && errors.length === 0, rounds, mismatches, errors };
}

// C7: createSubmit() reads the body itself, so when the problem has no tests we
// inspect the body once (a sample run must still pass) and replay it for the handler.
function replayBody(req, raw) {
  const realOn = req.on;
  req.on = function on(event, cb) {
    if (event === 'data') {
      if (raw) process.nextTick(() => cb(raw));
      return this;
    }
    if (event === 'end') {
      process.nextTick(() => cb());
      return this;
    }
    return realOn.call(this, event, cb);
  };
}
async function readBodyForSubmitGate(req) {
  const raw = await new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', finish);
    req.on('error', finish);
    req.on('close', finish);
  });
  let body = {};
  if (raw) { try { body = JSON.parse(raw); } catch { body = {}; } }
  replayBody(req, raw);
  return body;
}

async function handle(req, res, url, p, m) {
  const u = url;
  let mt;

  // C6: update one test group (name, points, checker, checker lang/code, order…).
  mt = p.match(/^\/api\/problems\/(\d+)\/tests\/groups\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    const ctx = managedProblem(req, res, mt[1]);
    if (!ctx) return true;
    const { pr, me } = ctx;
    const direct = store.get('testGroups', mt[2]);
    const g = direct && String(direct.problemId) === String(pr.id)
      ? direct
      : store.query('testGroups', (x) => String(x.problemId) === String(pr.id) && String(x.name) === String(mt[2]))[0];
    if (direct && String(direct.problemId) !== String(pr.id)) return groupMismatch(res);
    if (!g) return send(res, 404, { error: { code: 'NO_GROUP', message: 'Test group not found.', hint: '' } });
    const b = await readBody(req);
    const patch = pickFields(b, GROUP_FIELDS);
    if (!Object.keys(patch).length) return send(res, 422, { error: { code: 'NO_FIELDS', message: 'No editable group fields supplied.', hint: 'PATCH name, points, checker, checkerLang, checkerCode, order…' } });
    if (!numericFieldsOk(patch)) return send(res, 422, { error: { code: 'NUMBER', message: 'points/order/timeMs/memoryMb must be non-negative numbers.', hint: '' } });
    const out = store.update('testGroups', g.id, patch);
    audit(me.id, 'problem.testgroup.update', `problem:${pr.id}`, { gid: g.id, fields: Object.keys(patch) });
    return send(res, 200, out);
  }

  // C6: edit or delete one test case.
  mt = p.match(/^\/api\/problems\/(\d+)\/tests\/cases\/([^/]+)$/);
  if (mt && (m === 'PATCH' || m === 'DELETE')) {
    const ctx = managedProblem(req, res, mt[1]);
    if (!ctx) return true;
    const { pr, me } = ctx;
    const tc = store.get('testCases', mt[2]);
    if (!tc) return send(res, 404, { error: { code: 'NO_CASE', message: 'Test case not found.', hint: '' } });
    const g = store.get('testGroups', tc.groupId);
    if (!g || String(g.problemId) !== String(pr.id)) return caseMismatch(res);
    if (m === 'DELETE') {
      store.remove('testCases', tc.id);
      audit(me.id, 'problem.testcase.delete', `problem:${pr.id}`, { caseId: tc.id, groupId: g.id });
      return send(res, 200, { ok: true, deleted: true });
    }
    const b = await readBody(req);
    if (b.groupId != null && String(b.groupId) !== String(g.id)) return caseMismatch(res);
    const patch = pickFields(b, CASE_FIELDS);
    delete patch.groupId;
    if (!Object.keys(patch).length) return send(res, 422, { error: { code: 'NO_FIELDS', message: 'No editable case fields supplied.', hint: 'PATCH input, expected, checker, timeMs, memoryMb or name.' } });
    if (!numericFieldsOk(patch)) return send(res, 422, { error: { code: 'NUMBER', message: 'timeMs/memoryMb/points must be non-negative numbers.', hint: '' } });
    const out = store.update('testCases', tc.id, patch);
    audit(me.id, 'problem.testcase.update', `problem:${pr.id}`, { caseId: tc.id, fields: Object.keys(patch) });
    return send(res, 200, out);
  }

  // C6: JSON export/import of the whole test tree (no ZIP).
  mt = p.match(/^\/api\/problems\/(\d+)\/tests\/(export|import)$/);
  if (mt && ((m === 'GET' && mt[2] === 'export') || (m === 'POST' && mt[2] === 'import'))) {
    const ctx = managedProblem(req, res, mt[1]);
    if (!ctx) return true;
    const { pr, me } = ctx;
    if (m === 'GET') {
      const bundle = {
        format: 'satori-tests-v1',
        exportedAt: new Date().toISOString(),
        problem: pickFields(pr, ['code', 'name', 'statementMd', 'statementMdEn', 'samples', 'limits', 'tags', 'difficulty', 'checker', 'checkerLang', 'checkerCode', 'checkerTolerance']),
        groups: groupsWithCases(pr.id),
      };
      return send(res, 200, bundle);
    }
    const b = await readBody(req);
    const incoming = Array.isArray(b && b.groups) ? b.groups : (Array.isArray(b) ? b : null);
    if (!incoming) return send(res, 422, { error: { code: 'INVALID_BUNDLE', message: 'Import needs { groups: [...] }.', hint: 'Export tests from another problem and import that JSON.' } });
    let groupsAdded = 0;
    let casesAdded = 0;
    const items = [];
    for (const rawGroup of incoming) {
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const groupFields = pickFields(rawGroup, GROUP_FIELDS);
      if (!groupFields.name) groupFields.name = `imported-${groupsAdded + 1}`;
      if (groupFields.points == null) groupFields.points = 100;
      const ng = store.insert('testGroups', { problemId: pr.id, ...groupFields });
      const newCases = [];
      for (const rawCase of (Array.isArray(rawGroup.cases) ? rawGroup.cases : [])) {
        if (!rawCase || typeof rawCase !== 'object') continue;
        const caseFields = pickFields(rawCase, CASE_FIELDS);
        delete caseFields.groupId;
        newCases.push(store.insert('testCases', { groupId: ng.id, ...caseFields }));
      }
      groupsAdded += 1;
      casesAdded += newCases.length;
      items.push({ ...ng, cases: newCases });
    }
    if (!groupsAdded) return send(res, 422, { error: { code: 'INVALID_BUNDLE', message: 'No groups in the bundle.', hint: 'Check the exported JSON.' } });
    audit(me.id, 'problem.tests.import', `problem:${pr.id}`, { groups: groupsAdded, cases: casesAdded });
    return send(res, 201, { ok: true, imported: { groups: groupsAdded, cases: casesAdded }, items });
  }

  // C12: limit history + content versions (editor history/diff).
  mt = p.match(/^\/api\/problems\/(\d+)\/(limitHistory|versions)$/);
  if (mt && m === 'GET') {
    const ctx = managedProblem(req, res, mt[1]);
    if (!ctx) return true;
    const { pr } = ctx;
    if (mt[2] === 'limitHistory') {
      const items = store.query('limitHistory', (x) => String(x.problemId) === String(pr.id))
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || Number(b.id) - Number(a.id));
      return send(res, 200, { items });
    }
    const items = store.query('problemVersions', (x) => String(x.problemId) === String(pr.id))
      .sort((a, b) => Number(b.id) - Number(a.id));
    return send(res, 200, { items });
  }

  // C5: validator / reference / stress authoring routes (admins only).
  mt = p.match(/^\/api\/problems\/(\d+)\/(validators\/run|reference\/(?:run|generate)|stress)$/);
  if (mt && m === 'POST') {
    const ctx = managedProblem(req, res, mt[1]);
    if (!ctx) return true;
    const { pr, me } = ctx;
    const b = await readBody(req);

    if (mt[2] === 'validators/run') {
      const out = runValidatorOverCases(pr, b);
      audit(me.id, 'problem.validator.run', `problem:${pr.id}`, { cases: out.cases.length, ok: out.ok });
      return send(res, 200, out);
    }

    const refCfg = referenceConfigFor(pr, b);
    if (!refCfg.code.trim()) {
      return send(res, 422, { error: { code: 'NO_REFERENCE', message: 'Reference solution is not configured.', hint: 'Set referenceLang and referenceCode, then save the problem.' } });
    }
    if (!refCfg.lang) {
      return send(res, 422, { error: { code: 'REFERENCE_LANG', message: 'Reference solution language is unknown.', hint: 'Use C, C++17, Python, JavaScript, Java or Rust.' } });
    }

    if (mt[2] === 'reference/run') {
      const out = runReferenceOverCases(pr, refCfg);
      audit(me.id, 'problem.reference.run', `problem:${pr.id}`, { cases: out.cases.length, ok: out.ok });
      return send(res, 200, out);
    }

    if (mt[2] === 'reference/generate') {
      // Deliberate guard: generation fills empty expected outputs only. Replacing
      // a teacher-authored expected output is an explicit case edit, never a click.
      if (b.overwrite === true) {
        return send(res, 422, { error: { code: 'OVERWRITE', message: 'Generate never overwrites existing expected outputs.', hint: 'It only fills empty expected values. Edit a case explicitly to replace its output.' } });
      }
      const out = generateMissingExpected(pr, refCfg);
      audit(me.id, 'problem.reference.generate', `problem:${pr.id}`, { changed: out.changed, considered: out.considered });
      return send(res, 200, out);
    }

    const out = runStress(pr, b);
    if (out.error) return send(res, 422, { error: out.error });
    audit(me.id, 'problem.stress.run', `problem:${pr.id}`, { rounds: out.rounds, mismatches: out.mismatches.length });
    return send(res, 200, out);
  }

  // test group delete
  mt = p.match(/^\/api\/problems\/(\d+)\/tests\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const prd = store.get('problems', mt[1]);
    if (!prd) return send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageProblem(me, prd)) return forbid(res);
    const gid = mt[2];
    const g = store.query('testGroups', (x) => String(x.problemId) === String(prd.id) && (String(x.id) === String(gid) || String(x.name) === String(gid)))[0];
    if (!g) return send(res, 404, { error: { code: 'NO_GROUP', message: 'Test group not found.', hint: '' } });
    for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) store.remove('testCases', tc.id);
    store.remove('testGroups', g.id);
    audit(me.id, 'problem.testgroup.delete', `problem:${prd.id}`, { gid: g.id });
    return send(res, 200, { ok: true, deleted: true });
  }

  // problems single + tests + best + heatmap + clone + rejudge
  mt = p.match(/^\/api\/problems\/(\d+)(\/(tests|best|heatmap|clone|rejudge|submit))?$/);
  if (mt && (m === 'GET' || m === 'POST' || m === 'PATCH' || m === 'DELETE')) {
    const pr = store.get('problems', mt[1]);
    if (!pr) return send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } });
    const sub = mt[3];
    if (!sub && m === 'GET') {
      const me = authUser(req);
      const visP = pr.visibility || 'visible';
      if (visP !== 'visible' && !canManageProblem(me, pr)) return send(res, 403, { error: { code: 'HIDDEN', message: 'Problem is not visible.', hint: 'Ask a contest admin to publish it.' } });
      const contest = pr.contestId ? store.get('contests', pr.contestId) : null;
      if (contest && !canReadContest(contest, me)) {
        return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      }
      // C10: the caller's best verdict/score travels with the problem, plus the
      // per-contest alias. Team mode aggregates the caller's team only.
      const out = contest ? enrichProblemWithDeadline(pr, contest) : { ...pr };
      out.alias = (pr.aliasLetters || {})[String(pr.contestId)] || pr.code || null;
      out._best = null;
      out._bestScore = 0;
      out._tries = 0;
      if (me) {
        const team = contest && contest.teamMode === true
          ? store.query('teams', (t) => String(t.contestId) === String(contest.id) && teamHasMember(t, me.id))[0]
          : null;
        const subs = store.query('submits', (s) => {
          if (String(s.problemId) !== String(pr.id) || s.sampleOnly) return false;
          if (String(s.userId) === String(me.id)) return true;
          return Boolean(team) && String(s.teamId) === String(team.id) && teamHasMember(team, s.userId);
        });
        let best = null;
        let score = 0;
        for (const s of subs) {
          score = Math.max(score, Number(s.points || 0));
          if (isAccepted(s.status)) best = best || s.status;
        }
        if (!best && subs.length) best = subs[subs.length - 1].status;
        out._best = best;
        out._bestScore = score;
        out._tries = subs.length;
      }
      // Editorial is a reward for solving, not a public statement section.
      if (out.editorialMd && !canManageProblem(me, pr) && !(out._best === 'OK' || out._best === 'ANS')) delete out.editorialMd;
      // Validators and the reference solution are authoring secrets: students must
      // never receive the model solution through a normal problem read.
      if (!canManageProblem(me, pr)) {
        for (const f of ['validator', 'validatorLang', 'validatorCode', 'validatorFile', 'referenceCode', 'referenceLang']) delete out[f];
      }
      return send(res, 200, out);
    }
    if (!sub && m === 'PATCH') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      const patch = pickFields(b, PROBLEM_PATCH_FIELDS);
      if (!Object.keys(patch).length) return send(res, 422, { error: { code: 'NO_FIELDS', message: 'No editable problem fields supplied.', hint: 'PATCH name, code, tags, difficulty, deadlineAt, setId, statement, limits…' } });
      if (patch.name !== undefined && !String(patch.name).trim()) return send(res, 422, { error: { code: 'NAME', message: 'Problem name cannot be empty.', hint: '' } });
      if (patch.code !== undefined && !String(patch.code).trim()) return send(res, 422, { error: { code: 'CODE', message: 'Problem code cannot be empty.', hint: '' } });
      if (patch.tags !== undefined && !Array.isArray(patch.tags)) return send(res, 422, { error: { code: 'TAGS', message: 'tags must be an array.', hint: '' } });
      if (patch.difficulty !== undefined) {
        const n = Number(patch.difficulty);
        if (!Number.isFinite(n) || n < 0) return send(res, 422, { error: { code: 'DIFFICULTY', message: 'difficulty must be a non-negative number.', hint: '' } });
        patch.difficulty = n;
      }
      if (patch.deadlineAt !== undefined) {
        const d = dateOrNull(patch.deadlineAt);
        if (!d.ok) return send(res, 422, { error: { code: 'DEADLINE', message: 'deadlineAt is not a valid date.', hint: 'Use ISO 8601.' } });
        patch.deadlineAt = d.value;
      }
      if (patch.aliasLetters !== undefined && (patch.aliasLetters === null || typeof patch.aliasLetters !== 'object' || Array.isArray(patch.aliasLetters))) {
        return send(res, 422, { error: { code: 'ALIASES', message: 'aliasLetters must be an object.', hint: '' } });
      }
      // C5: validator/reference programs are text, languages are canonical, code capped.
      for (const f of ['validator', 'validatorLang', 'validatorCode', 'validatorFile', 'referenceLang', 'referenceCode']) {
        if (patch[f] !== undefined && patch[f] !== null && typeof patch[f] !== 'string') {
          return send(res, 422, { error: { code: 'PROGRAM_FIELD', message: `${f} must be a string.`, hint: 'Send program source as a string.' } });
        }
      }
      for (const f of ['validatorCode', 'referenceCode']) {
        if (patch[f] !== undefined && String(patch[f] || '').length > PROGRAM_SOURCE_MAX) {
          return send(res, 422, { error: { code: 'PROGRAM_TOO_LARGE', message: `${f} exceeds 512KB.`, hint: 'Keep authoring programs under 512KB.' } });
        }
      }
      if (patch.validatorLang != null && patch.validatorLang !== '' && !CHECKER.normalizeLang(patch.validatorLang)) {
        return send(res, 422, { error: { code: 'VALIDATOR_LANG', message: 'Unknown validator language.', hint: 'Use C, C++17, Python, JavaScript, Java or Rust.' } });
      }
      if (patch.referenceLang != null && patch.referenceLang !== '' && !CHECKER.normalizeLang(patch.referenceLang)) {
        return send(res, 422, { error: { code: 'REFERENCE_LANG', message: 'Unknown reference solution language.', hint: 'Use C, C++17, Python, JavaScript, Java or Rust.' } });
      }
      // C10: a set must belong to this problem's contest — no cross-contest set ids.
      if (patch.setId !== undefined) {
        if (patch.setId == null || patch.setId === '') {
          patch.setId = null;
        } else {
          const ps = store.get('problemSets', patch.setId);
          if (!ps || String(ps.contestId) !== String(pr.contestId)) {
            return send(res, 422, { error: { code: 'SET_MISMATCH', message: 'Problem set does not belong to this contest.', hint: 'Pick a set from the same contest.' } });
          }
          patch.setId = ps.id;
        }
      }
      // C7: publishing requires at least one test case (demo fixtures opt out).
      if (patch.visibility === 'visible' && !hasTests(pr) && !testGateExempt(pr)) {
        return noTests(res, 422, 'Cannot publish a problem without test cases.');
      }
      // C5: a configured validator must accept every input before the problem is
      // visible. Compile/run errors also fail closed and name the bad case.
      if (patch.visibility === 'visible' && hasTests(pr)) {
        const next = { ...pr, ...patch };
        const check = runValidatorOverCases(next);
        const bad = check.cases.find((x) => !x.valid);
        if (bad) {
          const label = bad.caseName ? `${bad.n} (${bad.caseName})` : String(bad.n);
          return send(res, 422, {
            error: {
              code: 'INVALID_TESTS',
              message: `Test case ${label} is invalid${bad.message ? `: ${bad.message}` : '.'}`,
              hint: 'Fix the input or the validator, then run the validator from the problem editor.',
              field: 'validator',
              caseId: bad.caseId,
              caseN: bad.n,
              ...(check.compileLog ? { validatorLog: check.compileLog } : {}),
            },
          });
        }
      }
      const changed = VERSION_FIELDS.filter((f) => patch[f] !== undefined && JSON.stringify(patch[f]) !== JSON.stringify(pr[f]));
      if (changed.length) {
        store.insert('problemVersions', {
          problemId: pr.id,
          version: pr.version || 1,
          by: me.id,
          at: new Date().toISOString(),
          changed,
          snapshot: {
            name: pr.name ?? null,
            code: pr.code ?? null,
            tags: pr.tags || [],
            difficulty: pr.difficulty ?? null,
            statementMd: pr.statementMd || '',
            statementMdEn: pr.statementMdEn || '',
            samples: pr.samples || [],
            limits: pr.limits || null,
          },
        });
      }
      if (patch.limits && JSON.stringify(patch.limits) !== JSON.stringify(pr.limits)) {
        store.insert('limitHistory', { problemId: pr.id, from: pr.limits, to: patch.limits, by: me.id, at: new Date().toISOString() });
        fireWebhooks('limit.changed', { problemId: pr.id, contestId: pr.contestId, limits: patch.limits });
      }
      const out = store.update('problems', pr.id, { ...patch, version: (pr.version || 1) + 1 });
      audit(me.id, 'problem.update', `problem:${pr.id}`, patch);
      return send(res, 200, out);
    }
    if (!sub && m === 'DELETE') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      for (const g of store.query('testGroups', (x) => String(x.problemId) === String(pr.id))) {
        for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) store.remove('testCases', tc.id);
        store.remove('testGroups', g.id);
      }
      for (const n of store.query('notes', (x) => String(x.problemId) === String(pr.id))) store.remove('notes', n.id);
      store.remove('problems', pr.id);
      audit(me.id, 'problem.delete', `problem:${pr.id}`, {});
      return send(res, 200, { ok: true, deleted: true });
    }
    if (sub === 'tests' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      return send(res, 200, { items: groupsWithCases(pr.id) });
    }
    if (sub === 'tests' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      if (b.group) {
        if (b.group.problemId != null && String(b.group.problemId) !== String(pr.id)) return groupMismatch(res);
        return send(res, 201, store.insert('testGroups', { problemId: pr.id, points: 100, ...pickFields(b.group, GROUP_FIELDS) }));
      }
      if (b.case) {
        if (b.case.problemId != null && String(b.case.problemId) !== String(pr.id)) return groupMismatch(res);
        if (b.case.groupId != null) {
          const g = store.get('testGroups', b.case.groupId);
          if (!g || String(g.problemId) !== String(pr.id)) return groupMismatch(res);
        }
        return send(res, 201, store.insert('testCases', pickFields(b.case, CASE_FIELDS)));
      }
      return send(res, 422, { error: { code: 'TEST', message: 'Provide group or case.', hint: '' } });
    }
    if (sub === 'best' && m === 'GET') {
      const me = authUser(req);
      if (!me) return send(res, 200, { best: null, tries: 0 });
      const subs = store.query('submits', (s) => String(s.problemId) === String(pr.id) && String(s.userId) === String(me.id) && !s.sampleOnly);
      let best = null;
      for (const s of subs) if (isAccepted(s.status)) { best = s.status; break; }
      if (!best && subs.length) best = subs[subs.length - 1].status;
      return send(res, 200, { best, tries: subs.length, last: subs.slice(-3).map((x) => localizeRow(submitView(x, me), reqLang(req, u))) });
    }
    if (sub === 'heatmap' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const subs = store.query('submits', (s) => String(s.problemId) === String(pr.id) && !s.sampleOnly && s.perTestFull);
      const fails = {};
      for (const s of subs) for (const t of (s.perTestFull || [])) if (t.verdict !== 'OK') fails[t.n] = (fails[t.n] || 0) + 1;
      return send(res, 200, { fails });
    }
    if (sub === 'clone' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      const targetId = b.contestId != null && b.contestId !== '' ? b.contestId : pr.contestId;
      const target = store.get('contests', targetId);
      if (!target) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Target contest not found.', hint: '' } });
      if (String(target.id) !== String(pr.contestId) && !canManageContest(me, target)) return forbid(res);
      // C11: remap the set only when the target contest has one with the same
      // name; otherwise the clone drops the set instead of dangling an id.
      let setId = null;
      if (pr.setId) {
        const srcSet = store.get('problemSets', pr.setId);
        if (srcSet && String(target.id) === String(pr.contestId)) {
          setId = pr.setId;
        } else if (srcSet) {
          const match = store.query('problemSets', (s) => String(s.contestId) === String(target.id) && String(s.name) === String(srcSet.name))[0];
          setId = match ? match.id : null;
        }
      }
      const np = store.insert('problems', {
        contestId: target.id,
        setId,
        code: b.code || pr.code,
        name: b.name || pr.name,
        setterId: me.id,
        statementMd: pr.statementMd || '',
        statementMdEn: pr.statementMdEn || '',
        statementHtml: pr.statementHtml || '',
        samples: pr.samples || [],
        limits: pr.limits ? { ...pr.limits, perLang: { ...(pr.limits.perLang || {}) } } : { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: {} },
        visibility: pr.visibility || 'draft',
        tags: Array.isArray(pr.tags) ? [...pr.tags] : [],
        difficulty: pr.difficulty ?? 1,
        weight: pr.weight ?? 1,
        checker: pr.checker,
        checkerLang: pr.checkerLang,
        checkerCode: pr.checkerCode,
        checkerTolerance: pr.checkerTolerance,
        checkerFile: pr.checkerFile,
        validator: pr.validator,
        validatorLang: pr.validatorLang,
        validatorCode: pr.validatorCode,
        validatorFile: pr.validatorFile,
        referenceCode: pr.referenceCode,
        referenceLang: pr.referenceLang,
        pdfBadge: pr.pdfBadge || 'HTML',
        version: 1,
        aliasLetters: {},
        deadlineAt: pr.deadlineAt ?? null,
      });
      let groupCount = 0;
      let caseCount = 0;
      for (const g of store.query('testGroups', (x) => String(x.problemId) === String(pr.id))) {
        const ng = store.insert('testGroups', { problemId: np.id, ...pickFields(g, GROUP_FIELDS) });
        groupCount += 1;
        for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) {
          const caseFields = pickFields(tc, CASE_FIELDS);
          delete caseFields.groupId; // keep the clone's new group id
          store.insert('testCases', { groupId: ng.id, ...caseFields });
          caseCount += 1;
        }
      }
      audit(me.id, 'problem.clone', `problem:${np.id}`, { from: pr.id, groups: groupCount, cases: caseCount });
      return send(res, 201, { ...np, cloned: { groups: groupCount, cases: caseCount } });
    }
    if (sub === 'rejudge' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const subs = store.query('submits', (s) => String(s.problemId) === String(pr.id) && !s.sampleOnly);
      for (const s of subs) {
        store.update('submits', s.id, { status: 'QUE', testsDone: 0, judgedAt: null });
        J.QUEUE.push(Number(s.id));
      }
      audit(me.id, 'problem.rejudge', `problem:${pr.id}`, { count: subs.length });
      processQueue()
        .then(() => { if (subs.length) fireWebhooks('rejudge.done', { problemId: pr.id, contestId: pr.contestId, requeued: subs.length }); })
        .catch(() => {});
      return send(res, 200, { ok: true, requeued: subs.length });
    }
    if (sub === 'submit' && m === 'POST') {
      // C7: a real submit needs tests; a sample run (body.sampleOnly) does not.
      if (!hasTests(pr) && !testGateExempt(pr)) {
        const body = await readBodyForSubmitGate(req);
        if (!body.sampleOnly) return noTests(res, 409, 'This problem has no test cases yet.');
      }
      return createSubmit(req, res, { problemId: pr.id, contestId: pr.contestId });
    }
  }
  return false;
}

module.exports = { handle };
