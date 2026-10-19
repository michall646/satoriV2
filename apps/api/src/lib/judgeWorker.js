// Satori V2 — in-process judge queue worker.
'use strict';
const { store } = require('./store');
const J = require('../../../../packages/judge/src/judge');
const { fireWebhooks } = require('../routes/webhooks');

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
function prepareExec(s, failCE) {
  if ((s.lang === 'C' || s.lang === 'C++17') && J.hasGpp()) {
    const c = J.compileCpp(s.code, { lang: s.lang });
    if (!c.ok) { failCE(c.log, c.dir); return false; }
    return { dir: c.dir, cmd: c.binary, args: [], log: c.log };
  }
  if (s.lang === 'Python' && J.hasPython()) {
    const py = J.preparePython(s.code);
    if (!py.ok) { failCE(py.log, py.dir); return false; }
    return { dir: py.dir, cmd: py.cmd[0], args: [...py.cmd.slice(1), py.script], log: '' };
  }
  if (s.lang === 'Java' && J.hasJava()) {
    const jv = J.compileJava(s.code);
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
  if (String(s.code).includes('CE-TRIGGER') || String(s.code).length < 2) {
    setStatus({ status: 'CE', judgedAt: new Date().toISOString(), compileLog: 'error: expected ; before } (line 3). Fix hint: check headers/flags.' });
    notify(s, 'CE');
    if (!s.sampleOnly) fireWebhooks('submit.judged', { submitId: s.id, verdict: 'CE', contestId: s.contestId, problemId: s.problemId });
    return;
  }
  setStatus({ status: 'TST', compileLog: '' });
  let cases = [];
  if (s.sampleOnly) {
    const sm = (problem && Array.isArray(problem.samples)) ? problem.samples : [];
    cases = sm.length
      ? sm.map((x) => ({ input: String(x.input ?? ''), expected: String(x.expected ?? x.output ?? ''), checker: 'token', group: { points: 100 } }))
      : [{ input: '2 3\n', expected: '5\n', checker: 'token', group: { points: 100 } }];
  } else {
    const groups = store.query('testGroups', (g) => String(g.problemId) === String(s.problemId));
    for (const g of groups) cases.push(...store.query('testCases', (c) => String(c.groupId) === String(g.id)).map((c) => ({ ...c, group: g })));
    if (cases.length === 0) cases = [{ input: '2 3\n', expected: '5\n', checker: 'token', group: { points: 100 } }];
  }
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
  const exec = prepareExec(s, failCE);
  if (exec === false) return;
  if (exec) setStatus({ status: 'TST', compileLog: String(exec.log || '') });
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    setStatus({ status: 'TST', testsTotal: cases.length, testsDone: i });
    await sleep(80);
    if (String(s.code).includes('TLE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'TLE', timeMs: effLimit, msg: 'fixture: simulate timeout', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (String(s.code).includes('MLE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'MLE', timeMs: 0, msg: 'fixture: simulate memory blowup', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (String(s.code).includes('RE-TRIGGER')) {
      perTest.push({ n: i + 1, verdict: 'RE', timeMs: 0, msg: 'fixture: simulate exit code 1', group: (tc.group && tc.group.name) || null, points: 0 });
      continue;
    }
    if (String(s.code).includes('WA-TRIGGER')) {
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
      const ok = J.checkOutput(tc.checker || 'token', tc.expected, run.stdout);
      const w = caseWeight(tc);
      perTest.push({
        n: i + 1, verdict: ok ? 'OK' : 'WA', timeMs: Math.max(1, run.wallMs),
        msg: ok ? '' : `expected ${JSON.stringify(String(tc.expected).slice(0, 40))} got ${JSON.stringify(String(run.stdout).slice(0, 40))}`,
        group: (tc.group && tc.group.name) || null, points: ok ? Math.round(w * 100) / 100 : 0,
        expected: ok ? null : String(tc.expected ?? ''), got: ok ? null : String(run.stdout ?? ''),
      });
      if (ok) points += w;
      continue;
    }
    const t0 = Date.now();
    const out = J.simulate(s.code, s.lang, tc.input);
    const ok = J.checkOutput(tc.checker || 'token', tc.expected, out);
    const w = caseWeight(tc);
    perTest.push({
      n: i + 1, verdict: ok ? 'OK' : 'WA', timeMs: Math.max(1, Date.now() - t0),
      msg: ok ? '' : `expected ${JSON.stringify(String(tc.expected).slice(0, 40))} got ${JSON.stringify(String(out).slice(0, 40))}`,
      group: (tc.group && tc.group.name) || null, points: ok ? Math.round(w * 100) / 100 : 0,
      expected: ok ? null : String(tc.expected ?? ''), got: ok ? null : String(out ?? ''),
    });
    if (ok) points += w;
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
  store.insert('notifications', { userId: s.userId, type: 'submit.judged', payload: { submitId: s.id, verdict }, read: false, at: new Date().toISOString() });
}

module.exports = { processQueue, sleep, prepareExec, judgeOne, notify };
