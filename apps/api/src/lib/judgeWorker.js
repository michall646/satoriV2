// Satori V2 — in-process judge queue worker.
'use strict';
const { store } = require('./store');
const J = require('../../../../packages/judge/src/judge');
const CHECKER = require('../../../../packages/judge/src/checker');
const { fireWebhooks } = require('../routes/webhooks');
const { notifyUser } = require('./notifications');

// Fixture triggers are for demo/tests only. Production code must not be able to
// force a verdict by putting a magic string in a comment.
const DEMO_TRIGGERS = process.env.SATORI_DEMO_TRIGGERS === '1';

// ---- judge worker ----
let judging = false;
async function processQueue() {
  if (judging) return;
  judging = true;
  try {
    while (J.QUEUE.length > 0) {
      const id = J.QUEUE[0];
      const s = store.get('submits', id);
      if (!s) { J.QUEUE.shift(); continue; }
      await judgeOne(s);
      J.QUEUE.shift();
    }
  } finally { judging = false; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
// One descriptor per serviced language: { dir, cmd, args, log }.
// Toolchain missing -> null -> simulate (submit is flagged `simulated: true`).
function prepareExec(s, failCE, problem) {
  if (s.lang === 'C' && J.hasGcc()) {
    const c = J.compileC(s.code);
    if (!c.ok) { failCE(c.log, c.dir); return false; }
    return { dir: c.dir, cmd: c.binary, args: [], log: c.log };
  }
  if (s.lang === 'C++17' && J.hasGpp()) {
    const c = J.compileCpp(s.code);
    if (!c.ok) { failCE(c.log, c.dir); return false; }
    return { dir: c.dir, cmd: c.binary, args: [], log: c.log };
  }
  if (s.lang === 'Python' && J.hasPython()) {
    const py = J.preparePython(s.code);
    if (!py.ok) { failCE(py.log, py.dir); return false; }
    return { dir: py.dir, cmd: py.cmd[0], args: [...py.cmd.slice(1), py.script], log: '' };
  }
  if (s.lang === 'Java' && J.hasJava()) {
    const jv = J.compileJava(s.code, { memoryMb: problem && problem.limits ? problem.limits.memoryMb : undefined });
    if (!jv.ok) { failCE(jv.log, jv.dir); return false; }
    return { dir: jv.dir, cmd: jv.cmd, args: jv.args, log: '' };
  }
  if (s.lang === 'Rust' && J.hasRust()) {
    const rs = J.compileRust(s.code);
    if (!rs.ok) { failCE(rs.log, rs.dir); return false; }
    return { dir: rs.dir, cmd: rs.cmd, args: rs.args, log: rs.log };
  }
  if (s.lang === 'JavaScript' && J.hasNode()) {
    const js = J.prepareJs(s.code);
    if (!js.ok) { failCE(js.log, js.dir); return false; }
    return { dir: js.dir, cmd: js.cmd, args: js.args, log: '' };
  }
  return null;
}
async function judgeOne(s) {
  const problem = store.get('problems', s.problemId);
  const contest = s.contestId ? store.get('contests', s.contestId) : null;
  const setStatus = (patch) => {
    const cur = store.update('submits', s.id, { ...patch });
    J.pushEvent(s.id, { submitId: s.id, ...patch, phase: patch.status, at: new Date().toISOString() });
    return cur;
  };
  setStatus({ status: 'CMP', testsDone: 0 });
  await sleep(120);
  // compile-error simulation
  if ((DEMO_TRIGGERS && String(s.code).includes('CE-TRIGGER')) || String(s.code).length < 2) {
    setStatus({ status: 'CE', judgedAt: new Date().toISOString(), compileLog: 'error: expected ; before } (line 3). Fix hint: check headers/flags.' });
    notify(s, 'CE');
    if (!s.sampleOnly) fireWebhooks('submit.judged', { submitId: s.id, verdict: 'CE', contestId: s.contestId, problemId: s.problemId });
    return;
  }
  setStatus({ status: 'TST', compileLog: '' });
  let cases = [];
  // C7: sample runs use the problem/group checker (D7), never a hardcoded token.
  if (s.sampleOnly) {
    const sm = (problem && Array.isArray(problem.samples)) ? problem.samples : [];
    cases = sm.map((x) => ({
      input: String(x.input ?? ''),
      expected: String(x.expected ?? x.output ?? ''),
      checker: x.checker,
      checkerTolerance: x.checkerTolerance,
      checkerLang: x.checkerLang,
      checkerCode: x.checkerCode,
      group: { points: 100 },
    }));
  } else {
    const groups = store.query('testGroups', (g) => String(g.problemId) === String(s.problemId));
    for (const g of groups) cases.push(...store.query('testCases', (c) => String(c.groupId) === String(g.id)).map((c) => ({ ...c, group: g })));
  }
  // C7: a real submit with zero cases never reaches the judge (the API rejects
  // it). The only remaining fallback is the demo fixture, gated by C8.
  if (cases.length === 0 && DEMO_TRIGGERS) {
    cases = [{ input: '2 3\n', expected: '5\n', checker: 'token', group: { points: 100 } }];
  }
  // C7: sample runs have no group of their own — the problem checker wins, then
  // the first group's checker, never a hardcoded token.
  const sampleFirstGroup = store.query('testGroups', (g) => String(g.problemId) === String(s.problemId))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || Number(a.id) - Number(b.id))[0] || null;
  const problemHasChecker = Boolean(problem) && ['checker', 'checkerLang', 'checkerCode', 'checkerFile']
    .some((f) => problem[f] != null && problem[f] !== '');
  const groupCounts = new Map();
  for (const x of cases) {
    const k = x.group && x.group.id != null ? `g:${x.group.id}` : `p:${(x.group && x.group.points) || 100}`;
    groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
  }
  const caseWeight = (tc) => {
    const g = tc.group || {};
    const k = g.id != null ? `g:${g.id}` : `p:${g.points || 100}`;
    return Number(g.points || 100) / (groupCounts.get(k) || 1);
  };
  const perTest = [];
  let points = 0;
  const effLimit = (problem && problem.limits && problem.limits.perLang && problem.limits.perLang[s.lang]) || (problem && problem.limits && problem.limits.timeMs) || 1000;
  const failCE = (log, dir) => {
    J.cleanupDir(dir);
    setStatus({ status: 'CE', judgedAt: new Date().toISOString(), compileLog: String(log || 'error: compile failed.').slice(0, 8000) });
    notify(s, 'CE');
    if (!s.sampleOnly) fireWebhooks('submit.judged', { submitId: s.id, verdict: 'CE', contestId: s.contestId, problemId: s.problemId });
  };
  const exec = prepareExec(s, failCE, problem);
  if (exec === false) return;
  if (exec) setStatus({ status: 'TST', compileLog: String(exec.log || '') });
  if (cases.length === 0) {
    // No tests to run: refuse to fabricate an accepted result (C7). The API
    // blocks this for real submits; this is defence in depth for legacy/queued rows.
    setStatus({
      status: 'WA', testsTotal: 0, testsDone: 0, perTest: [], perTestFull: s.sampleOnly ? null : [],
      points: 0, cpuMs: 0, memMb: null, simulated: !exec, judgedAt: new Date().toISOString(),
    });
    notify(s, 'WA');
    if (exec) J.cleanupDir(exec.dir);
    if (!s.sampleOnly) fireWebhooks('submit.judged', { submitId: s.id, verdict: 'WA', contestId: s.contestId, problemId: s.problemId });
    return;
  }
  // Custom checkers are compiled once per submit/group and then executed per test.
  const checkerPrograms = new Map();
  const customChecker = (cfg) => {
    const key = `${cfg.lang || ''}\u0000${cfg.code}`;
    if (!checkerPrograms.has(key)) {
      checkerPrograms.set(key, CHECKER.prepareChecker(cfg.code, cfg.lang, { memoryMb: problem && problem.limits ? problem.limits.memoryMb : undefined }));
    }
    return checkerPrograms.get(key);
  };
  const evaluate = (tc, got) => {
    const checkerGroup = s.sampleOnly
      ? (problemHasChecker ? problem : (sampleFirstGroup || {}))
      : tc.group;
    const cfg = CHECKER.resolveChecker(tc, checkerGroup, problem);
    if (cfg.kind === 'custom') {
      if (!cfg.code.trim()) return { ok: false, cfg, msg: 'custom checker has no program.' };
      const desc = customChecker(cfg);
      if (!desc.ok) return { ok: false, cfg, msg: `checker compile failed: ${CHECKER.firstLine(desc.log) || 'unknown error'}`, checkerError: true };
      const r = CHECKER.runChecker(desc, { input: tc.input, expected: tc.expected, output: got });
      return { ok: r.accepted, cfg, msg: r.accepted ? '' : r.message, checkerError: r.status === 'CHECKER_ERROR' };
    }
    const ok = cfg.kind === 'float'
      ? CHECKER.acceptFloat(tc.expected, got, cfg.tolerance)
      : CHECKER.acceptToken(tc.expected, got);
    return { ok, cfg, msg: '', checkerError: false };
  };
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    setStatus({ status: 'TST', testsTotal: cases.length, testsDone: i });
    await sleep(80);
    if (DEMO_TRIGGERS && String(s.code).includes('TLE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'TLE', timeMs: effLimit, msg: 'fixture: simulate timeout', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (DEMO_TRIGGERS && String(s.code).includes('MLE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'MLE', timeMs: 0, msg: 'fixture: simulate memory blowup', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (DEMO_TRIGGERS && String(s.code).includes('RE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'RE', timeMs: 0, msg: 'fixture: simulate exit code 1', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (DEMO_TRIGGERS && String(s.code).includes('WA-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'WA', timeMs: 0, msg: `expected ${JSON.stringify(String(tc.expected).slice(0, 40))} got "wrong"`, group: (tc.group && tc.group.name) || null, points: 0, expected: String(tc.expected ?? ''), got: 'wrong' });
      continue;
    }
    if (exec) {
      const tcLimit = Number(tc.timeMs) || effLimit;
      const run = J.runProcess(exec.cmd, exec.args, { input: tc.input, timeMs: tcLimit, cwd: exec.dir });
      if (run.timedOut) {
        perTest.push({ n: i + 1, verdict: 'TLE', timeMs: Math.max(1, run.wallMs), msg: `exceeded ${tcLimit}ms` });
        continue;
      }
      if (run.outputCapped) {
        perTest.push({ n: i + 1, verdict: 'RE', timeMs: Math.max(1, run.wallMs), msg: 'output limit exceeded (1 MB cap)' });
        continue;
      }
      if (run.exitCode !== 0) {
        const msg = String(run.stderr || run.spawnError || `exit code ${run.exitCode}`).slice(0, 300);
        perTest.push({ n: i + 1, verdict: 'RE', timeMs: Math.max(1, run.wallMs), msg });
        continue;
      }
      const ev = evaluate(tc, run.stdout);
      const w = caseWeight(tc);
      const msg = ev.ok ? '' : (ev.msg || `expected ${JSON.stringify(String(tc.expected).slice(0, 40))} got ${JSON.stringify(String(run.stdout).slice(0, 40))}`);
      perTest.push({
        n: i + 1, verdict: ev.ok ? 'OK' : 'WA', timeMs: Math.max(1, run.wallMs),
        msg,
        ...(ev.cfg.kind === 'custom' ? { checker: { kind: 'custom', lang: ev.cfg.lang, error: ev.checkerError } } : {}),
        group: (tc.group && tc.group.name) || null, points: ev.ok ? Math.round(w * 100) / 100 : 0,
        expected: ev.ok ? null : String(tc.expected ?? ''), got: ev.ok ? null : String(run.stdout ?? ''),
      });
      if (ev.ok) points += w;
      continue;
    }
    const t0 = Date.now();
    const out = J.simulate(s.code, s.lang, tc.input, { demo: DEMO_TRIGGERS });
    const ev = evaluate(tc, out);
    const w = caseWeight(tc);
    const msg = ev.ok ? '' : (ev.msg || `expected ${JSON.stringify(String(tc.expected).slice(0, 40))} got ${JSON.stringify(String(out).slice(0, 40))}`);
    perTest.push({
      n: i + 1, verdict: ev.ok ? 'OK' : 'WA', timeMs: Math.max(1, Date.now() - t0),
      msg,
      ...(ev.cfg.kind === 'custom' ? { checker: { kind: 'custom', lang: ev.cfg.lang, error: ev.checkerError } } : {}),
      group: (tc.group && tc.group.name) || null, points: ev.ok ? Math.round(w * 100) / 100 : 0,
      expected: ev.ok ? null : String(tc.expected ?? ''), got: ev.ok ? null : String(out ?? ''),
    });
    if (ev.ok) points += w;
  }
  for (const desc of checkerPrograms.values()) {
    if (desc && desc.dir) J.cleanupDir(desc.dir);
  }
  let verdict = 'OK';
  const firstBad = perTest.find((x) => x.verdict !== 'OK');
  if (firstBad) verdict = firstBad.verdict;
  const vis = (contest && contest.settings && contest.settings.verdictVisibility) || 'all';
  const running = Boolean(contest) && ['draft', 'registration', 'running'].includes(contest.lifecycle);
  const restricted = !s.sampleOnly && running && vis !== 'all';
  const shownTests = restricted ? (vis === 'first-failed' ? (firstBad ? [firstBad] : []) : []) : perTest;
  const used = perTest.reduce((a, x) => a + Number(x.timeMs || 0), 0);
  setStatus({
    status: verdict, testsTotal: cases.length, testsDone: cases.length,
    perTest: shownTests,
    perTestFull: s.sampleOnly ? null : perTest, points: Math.round(points),
    cpuMs: used, memMb: null, simulated: !exec, judgedAt: new Date().toISOString(),
    ...(verdict === 'TLE' ? { explainKey: 'tleHelp', explainArgs: [`${used}ms`, `${effLimit}ms`] }
      : verdict === 'MLE' ? { explainKey: 'mleHelp', explainArgs: ['n/a', '256MB'] }
        : verdict === 'CE' ? { explainKey: 'ceHelp', explainArgs: [] }
          : exec ? {} : { explainKey: 'simulatedRun', explainArgs: [] }),
  });
  notify(s, verdict);
  if (exec) J.cleanupDir(exec.dir);
  if (!s.sampleOnly) fireWebhooks('submit.judged', { submitId: s.id, verdict, contestId: s.contestId, problemId: s.problemId });
}
function notify(s, verdict) {
  if (s.sampleOnly) return;
  notifyUser(s.userId, 'submit.judged', { submitId: s.id, verdict });
}

module.exports = { processQueue, sleep, prepareExec, judgeOne, notify };
