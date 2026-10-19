// Satori V2 — API server (stdlib http, zero deps).
// Run: node apps/api/src/server.js  (PORT default 3001)
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const { store } = require('./lib/store');
const { hashPassword, verifyPassword, needsRehash, signJwt, verifyJwt } = require('./lib/crypto');
const { validateLogin, validateEmail, validateFilename, sanitizeFilename, detectLanguage } = require('./lib/validators');
const { rankICPC, rankIOI, gradeLabs, isAccepted, resolveEffectiveDeadline, defaultDeadlinePolicy, isLateAt, lateUnitsBetween } = require('./lib/ranking');
const { t } = require('./lib/i18n');
const { similarityGraph, timelineFlags } = require('./lib/integrity');
const { zipStore } = require('./lib/zip');
const J = require('../../../packages/judge/src/judge');

const PORT = Number(process.env.PORT || 3001);

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function sendText(res, code, text, type = 'text/html; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({ _raw: buf }); }
    });
  });
}
function authUser(req) {
  const h = req.headers.authorization || '';
  const p = verifyJwt(h);
  if (!p) return null;
  const u = store.get('users', p.sub);
  if (!u) return null;
  const sess = store.query('sessions', (s) => s.jti === p.jti && !s.revoked)[0];
  if (!sess) return null;
  return u;
}
function tokenClaims(req) {
  return verifyJwt(req.headers.authorization || '');
}
function audit(actorId, action, target, meta) {
  store.insert('audit', { actorId, action, target, at: new Date().toISOString(), meta: meta || {} });
}
function contestDeadlines(contest) {
  const probs = store.query('problems', (x) => String(x.contestId) === String(contest.id));
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const deadlines = {};
  const meta = {};
  for (const pr of probs) {
    const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest });
    if (r.at) deadlines[pr.id] = r.at;
    meta[pr.id] = r;
  }
  return { deadlines, meta, policy: defaultDeadlinePolicy(contest) };
}

function enrichProblemWithDeadline(pr, contest) {
  if (!contest) return { ...pr, effectiveDeadline: pr.deadlineAt || null, deadlineSource: pr.deadlineAt ? 'problem' : 'none', deadlinePolicy: { enabled: false } };
  const setsById = new Map(store.query('problemSets', (x) => String(x.contestId) === String(contest.id)).map((s) => [String(s.id), s]));
  const r = resolveEffectiveDeadline({ problem: pr, set: pr.setId ? setsById.get(String(pr.setId)) : null, contest });
  const policy = defaultDeadlinePolicy(contest);
  if (!policy.enabled) return { ...pr, effectiveDeadline: null, deadlineSource: 'disabled', deadlinePolicy: policy };
  return { ...pr, effectiveDeadline: r.at, deadlineSource: r.source, deadlinePolicy: policy };
}
function contestRole(contest, userId) {
  if (!contest || userId == null) return 'none';
  const u = store.get('users', userId);
  if (u && (u.rolesGlobal || []).includes('superadmin')) return 'superadmin';
  if ((contest.admins || []).map(String).includes(String(userId))) return 'contest_admin';
  if ((contest.members || []).map(String).includes(String(userId))) return 'participant';
  if ((contest.pending || []).map(String).includes(String(userId))) return 'pending';
  return 'none';
}
function needAuth(req, res) {
  const u = authUser(req);
  if (!u) { send(res, 401, { error: { code: 'AUTH', message: 'Login required.', hint: 'POST /api/auth/token.' } }); return null; }
  return u;
}
function forbid(res) {
  return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Contest admins only.', hint: 'Ask a contest admin for access.' } });
}
function canManageContest(me, contest) {
  if (!me || !contest) return false;
  const role = contestRole(contest, me.id);
  return role === 'contest_admin' || role === 'superadmin';
}
function canManageProblem(me, problem) {
  if (!me || !problem || problem.contestId == null) return false;
  return canManageContest(me, store.get('contests', problem.contestId));
}
function sharesTeam(contest, aId, bId) {
  if (!contest || aId == null || bId == null) return false;
  const teams = store.query('teams', (t) => String(t.contestId) === String(contest.id));
  return teams.some((t) => {
    const ids = (t.memberIds || []).map(String);
    return ids.includes(String(aId)) && ids.includes(String(bId));
  });
}
// Public shape of a submit: code + full per-test data only for owner/jury, per verdict visibility.
function reqLang(req, url) {
  const q = url && url.searchParams.get('lang');
  if (q === 'pl' || q === 'en') return q;
  const first = String(req.headers['accept-language'] || '').split(',')[0].trim().toLowerCase();
  return first.startsWith('pl') ? 'pl' : 'en';
}
function localizeRow(row, lang) {
  if (!row || !row.explainKey) return row;
  const { explainKey, explainArgs, ...rest } = row;
  return { ...rest, explain: t(lang, explainKey, ...(explainArgs || [])) };
}
function submitView(s, me) {
  const contest = s.contestId ? store.get('contests', s.contestId) : null;
  const problem = s.problemId ? store.get('problems', s.problemId) : null;
  const limits = (problem && problem.limits) || {};
  const team = s.teamId ? store.get('teams', s.teamId) : null;
  const members = team
    ? (team.members || []).map((id) => { const u = store.get('users', id); return u ? u.login : null; }).filter(Boolean)
    : undefined;
  const decorate = (o) => {
    const out = { ...o, limitMs: limits.timeMs ?? null, limitMb: limits.memoryMb ?? null };
    if (members) out.members = members;
    return out;
  };
  if (contest && canManageContest(me, contest)) return decorate(s);
  const teamMember = me != null && team && (team.members || []).map(String).includes(String(me.id));
  const isOwner = me != null && (String(s.userId) === String(me.id) || teamMember);
  if (!isOwner) { const { code, perTestFull, ...rest } = s; return decorate(rest); }
  const vis = (contest && contest.settings && contest.settings.verdictVisibility) || 'all';
  const running = Boolean(contest) && ['draft', 'registration', 'running'].includes(contest.lifecycle);
  if (running && vis !== 'all') { const { perTestFull, ...rest } = s; return decorate(rest); }
  const fail = (s.perTest || []).find((x) => x.expected != null || x.got != null);
  return decorate({
    ...s,
    expected: fail && fail.expected != null ? fail.expected : null,
    got: fail && fail.got != null ? fail.got : null,
  });
}
// ---- simple in-memory throttles ----
const THROTTLE = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const hits = (THROTTLE.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { THROTTLE.set(key, hits); return true; }
  hits.push(now);
  THROTTLE.set(key, hits);
  return false;
}
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
function noteLoginFail(key) {
  const k = `login:${key}`;
  const now = Date.now();
  const hits = (THROTTLE.get(k) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  hits.push(now);
  THROTTLE.set(k, hits);
}
function loginBlocked(key) {
  const k = `login:${key}`;
  const now = Date.now();
  const hits = (THROTTLE.get(k) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (hits.length !== (THROTTLE.get(k) || []).length) THROTTLE.set(k, hits);
  return hits.length >= LOGIN_MAX_FAILS;
}
function clearLoginFails(key) { THROTTLE.delete(`login:${key}`); }

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
// ---- webhook delivery (S2-7): POST + timeout + retries with backoff + delivery log ----
const WEBHOOK_TIMEOUT_MS = Number(process.env.SATORI_WEBHOOK_TIMEOUT_MS || 5000);
const WEBHOOK_DELAY_MS = Number(process.env.SATORI_WEBHOOK_DELAY_MS || 500);
const WEBHOOK_ATTEMPTS = Math.max(1, Number(process.env.SATORI_WEBHOOK_ATTEMPTS || 4));
async function deliverToHook(hook, event, body) {
  let lastError = null;
  let lastHttp = null;
  for (let i = 0; i < WEBHOOK_ATTEMPTS; i++) {
    if (i > 0) await sleep(WEBHOOK_DELAY_MS * 2 ** (i - 1));
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Satori-Event': event },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return { ok: true, httpStatus: res.status, attempts: i + 1, ms: Date.now() - started };
      lastHttp = res.status;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastError = String((e && e.message) || e);
    }
  }
  return { ok: false, httpStatus: lastHttp, attempts: WEBHOOK_ATTEMPTS, error: lastError };
}
function pruneDeliveries() {
  const all = store.all('deliveries');
  if (all.length <= 300) return;
  const sorted = [...all].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  store.replaceAll('deliveries', sorted.slice(-300));
}
function fireWebhooks(event, payload) {
  const hooks = store.all('webhooks').filter((h) => (h.events || ['submit.judged']).includes(event));
  if (hooks.length === 0) return;
  const targets = hooks.filter((h) => !h.contestId || (payload.contestId != null && String(h.contestId) === String(payload.contestId)));
  for (const hook of targets) {
    const body = { event, at: new Date().toISOString(), payload };
    deliverToHook(hook, event, body).then((r) => {
      try {
        store.insert('deliveries', {
          hookId: hook.id, contestId: hook.contestId || null, event, url: hook.url,
          ok: r.ok, httpStatus: r.httpStatus || null, attempts: r.attempts,
          error: r.error || null, ms: r.ms || null, at: new Date().toISOString(),
        });
        pruneDeliveries();
      } catch { /* never break judging on a delivery-log write */ }
    }).catch(() => { /* delivery already recorded best-effort */ });
  }
  audit(null, 'webhook.fire', event, { event, contestId: (payload && payload.contestId) || null, targets: targets.length });
}
// One source of truth for LABS scoring: used by /grade and the LABS board, so they cannot drift.
function computeLabsGrade(c, probs, matchSubmit) {
  const weights = {};
  probs.forEach((x) => { weights[x.id] = x.weight ?? 1; });
  const scores = {};
  const submittedAt = {};
  const misses = {};
  const dl = contestDeadlines(c);
  const scoring = ((c.settings || {}).scoring) || {};
  for (const x of probs) {
    const subs = store.query('submits', (s) => String(s.problemId) === String(x.id) && !s.sampleOnly && matchSubmit(s));
    let best = 0;
    let bestAt = null;
    let miss = 0;
    for (const s of subs) {
      const v = Number(s.points || (isAccepted(s.status) ? 100 : 0));
      if (!isAccepted(s.status) && (s.status !== 'CE' || scoring.exemptCE === false)) miss += 1;
      if (scoring.rule === 'latest') { best = v; bestAt = s.createdAt; }
      else if (v >= best) { best = v; bestAt = s.createdAt; }
    }
    scores[x.id] = best;
    misses[x.id] = miss;
    if (bestAt) submittedAt[x.id] = bestAt;
  }
  const policy = dl.policy;
  const out = gradeLabs({
    weights, scores, bestOfK: (c.settings || {}).bestOfK, dropWorstN: scoring.dropWorstN,
    latePenaltyPerDay: policy.penaltyValue || (c.settings || {}).latePenaltyPerDay,
    submittedAt, deadlines: policy.enabled ? dl.deadlines : null,
    penaltyKind: policy.penaltyKind, graceMin: policy.graceMin, capZeroAfterDays: policy.capZeroAfterDays,
    floorPct: scoring.floorPct ?? undefined, tiers: policy.tiers,
    misses, missDeduction: scoring.missDeduction || undefined,
  });
  return { out, deadlines: dl.deadlines, policy, submittedAt };
}
function mySessions(me, currentJti) {
  const rows = store.query('sessions', (s) => String(s.userId) === String(me.id) && !s.revoked)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const out = rows.map((s) => ({ id: s.jti, device: s.device || 'web', at: s.at || null, current: Boolean(currentJti && s.jti === currentJti) }));
  out.sort((a, b) => Number(b.current) - Number(a.current));
  return out;
}
function myTeams(userId) {
  const uid = String(userId);
  const inTeam = (t) => (t.memberIds || []).map(String).includes(uid) || (t.members || []).map(String).includes(uid);
  const teams = store.query('teams', inTeam);
  const viaRows = store.query('teamMembers', (r) => String(r.userId) === uid).map((r) => String(r.teamId));
  const extra = viaRows.length ? store.all('teams').filter((t) => viaRows.includes(String(t.id)) && !inTeam(t)) : [];
  return [...teams, ...extra].map((t) => ({ id: t.id, name: t.name, contestId: t.contestId ?? null }));
}
function normalizeExam(contest, extra) {
  const s = (contest && contest.settings) || {};
  const canonical = (o) => {
    if (!o) return {};
    const out = { ...o };
    if (out.ipAllow == null && out.ips != null) out.ipAllow = out.ips;
    if (out.timeWindow == null && out.tokens != null) out.timeWindow = out.tokens;
    delete out.ips;
    delete out.tokens;
    return out;
  };
  const src = { ...canonical(s.exam), ...canonical(extra) };
  return {
    fullscreen: Boolean(src.fullscreen),
    pasteBlock: Boolean(src.pasteBlock),
    shuffle: Boolean(src.shuffle),
    ipAllow: String(src.ipAllow ?? s.ips ?? '').trim(),
    timeWindow: String(src.timeWindow ?? s.tokens ?? '').trim(),
  };
}
function parseGradeScale(raw) {
  const defaults = [{ min: 90, grade: 5 }, { min: 75, grade: 4 }, { min: 50, grade: 3 }, { min: 0, grade: 2 }];
  if (!raw) return defaults;
  const out = [];
  for (const part of String(raw).split(',')) {
    const [a, b2] = part.split(':').map((x) => Number(String(x).trim()));
    if (Number.isFinite(a) && Number.isFinite(b2)) out.push({ min: a, grade: b2 });
  }
  return out.length ? out.sort((x, y) => y.min - x.min) : defaults;
}
function gradeFromScale(scale, pct) {
  for (const s of scale) if (pct >= s.min) return s.grade;
  return scale.length ? scale[scale.length - 1].grade : 2;
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
}
function rankMe(rows, me) {
  if (!me) return null;
  const idx = (rows || []).findIndex((r) => r.name === me.login);
  if (idx < 0) return null;
  const r = rows[idx];
  return { rank: r.rank ?? idx + 1, name: me.login, total: r.total ?? r.points ?? r.solved ?? null };
}
function buildRanking(c, me) {
  const mode = String(c.mode || 'ICPC').toUpperCase();
  const settings = c.settings || {};
  const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
  const teams = store.query('teams', (x) => String(x.contestId) === String(c.id));
  const contestants = teams.length
    ? teams.map((x) => ({ id: `t:${x.id}`, name: x.scoreboardName }))
    : (c.members || []).map((id) => { const x = store.get('users', id); return { id: `u:${id}`, name: x ? x.login : String(id) }; });
  const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly).map((s) => ({
    ...s,
    contestantId: s.teamId ? `t:${s.teamId}` : `u:${s.userId}`,
  }));
  const dl = contestDeadlines(c);
  const scoring = settings.scoring || {};
  const penaltyMin = settings.penaltyMin ?? scoring.wrongTryMin ?? scoring.penaltyMin ?? c.penalty ?? 20;
  const scoreOpts = {
    deadlines: dl.policy.enabled ? dl.deadlines : null, policy: dl.policy,
    scoreRule: scoring.rule || 'best', floorPct: scoring.floorPct ?? undefined,
    tiebreak: scoring.tiebreak || undefined,
    penaltyMin,
    exemptStatuses: scoring.exemptCE === false ? [] : ['CE'],
    missDeduction: scoring.missDeduction || undefined,
    maxTries: scoring.maxTries || undefined,
  };
  const problems = [...probs].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''))).map((x) => ({ id: x.id, code: x.code, name: x.name }));
  const unfreezeAt = c.freezeAt ? (settings.unfreezeAt || c.endAt || null) : null;
  const base = { contestMode: c.mode, problems, freezeAt: c.freezeAt, unfreezeAt, penaltyMin, deadlines: dl.deadlines, deadlinePolicy: dl.policy };
  if (mode === 'IOI') {
    const rows = rankIOI({ contestants, submits: subs, problems: probs, ...scoreOpts });
    return { ...base, mode, rows, me: rankMe(rows, me) };
  }
  if (mode === 'LABS' || mode === 'COURSE') {
    const rows = contestants.map((ct) => {
      const match = (s) => (s.teamId ? `t:${s.teamId}` : `u:${s.userId}`) === ct.id;
      const { out } = computeLabsGrade(c, probs, match);
      const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
      const cells = {};
      for (const p2 of probs) {
        const d = detail.get(String(p2.id));
        const pts = d ? Math.round(Number(d.points) * 10) / 10 : 0;
        cells[p2.id] = { text: d && d.lateUnits > 0 ? `${pts} †` : String(pts), points: pts, late: Boolean(d && d.lateUnits > 0) };
      }
      return { contestantId: ct.id, name: ct.name, total: out.total, grade: out.grade, cells };
    });
    rows.sort((a, b2) => b2.total - a.total);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { ...base, mode: 'LABS', rows, me: rankMe(rows, me) };
  }
  const rows = rankICPC({ contestants, submits: subs, problems: probs, contestStart: c.startAt, freezeAtIso: c.freezeAt, ...scoreOpts });
  return { ...base, mode: 'ICPC', rows, me: rankMe(rows, me) };
}

// ---- router ----
async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const m = req.method;
  if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); res.end(); return; }

  // health / meta
  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, time: new Date().toISOString(), queue: J.QUEUE.length });
  if (p === '/api/status' && m === 'GET') {
    const avail = J.languageAvailability();
    return send(res, 200, {
      queue: J.QUEUE.length,
      etaSec: J.QUEUE.length * 4,
      etaNote: 'estimate (no worker telemetry yet)',
      workers: ['local-spawn'],
      local: true,
      languages: Object.entries(avail).filter(([, v]) => v).map(([k]) => k),
      missingToolchains: Object.entries(avail).filter(([, v]) => !v).map(([k]) => k),
      maintenance: null,
      sandbox: 'interim local runner — memory limits not enforced yet (docs/JUDGE_SANDBOX.md)',
    });
  }
  if (p === '/api/languages' && m === 'GET') {
    const avail = J.languageAvailability();
    return send(res, 200, { matrix: J.LANGUAGE_MATRIX.map((x) => ({ ...x, available: Boolean(avail[x.lang]) })) });
  }
  if (p === '/api/openapi.json' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = require('node:path').join(__dirname, '..', '..', '..', 'openapi.yaml');
      if (fs.existsSync(f)) return sendText(res, 200, fs.readFileSync(f, 'utf8'), 'text/yaml; charset=utf-8');
    } catch { /* fallthrough */ }
    return send(res, 200, openapi());
  }
  if (p === '/api/orgs' && m === 'GET') return send(res, 200, { items: store.all('organizations') });
  if (p === '/api/search' && m === 'GET') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    if (!q) return send(res, 200, { contests: [], problems: [], users: [] });
    return send(res, 200, {
      contests: store.all('contests').filter((c) => (c.name + c.description).toLowerCase().includes(q)).slice(0, 20),
      problems: store.all('problems').filter((x) => x.name.toLowerCase().includes(q)).slice(0, 20),
      users: store.all('users').filter((x) => x.login.includes(q)).map((x) => ({ id: x.id, login: x.login })).slice(0, 20),
    });
  }

  // auth
  if (p === '/api/auth/register' && m === 'POST') {
    const b = await readBody(req);
    const vl = validateLogin(b.login);
    if (!vl.ok) return send(res, 422, vl);
    const ve = validateEmail(b.email);
    if (!ve.ok) return send(res, 422, ve);
    if (!b.password || String(b.password).length < 6) return send(res, 422, { error: { code: 'PASS', message: 'Password min 6 chars.', hint: 'Use 6+ chars.' } });
    if (store.query('users', (x) => x.login === b.login)[0]) return send(res, 409, { error: { code: 'TAKEN', message: 'Login taken.', hint: 'Pick another login.' } });
    const user = store.insert('users', { login: b.login, firstName: b.firstName || '', lastName: b.lastName || '', email: b.email, pass: hashPassword(b.password), affiliationOrgId: b.affiliationOrgId || null, rolesGlobal: ['student'], accessCode: b.accessCode || '', createdAt: new Date().toISOString() });
    audit(user.id, 'auth.register', `user:${user.id}`, {});
    return send(res, 201, { id: user.id, login: user.login });
  }
  if (p === '/api/auth/token' && m === 'POST') {
    const b = await readBody(req);
    const tkey = `${b.login || ''}|${(req.socket && req.socket.remoteAddress) || 'x'}`;
    if (loginBlocked(tkey)) return send(res, 429, { error: { code: 'THROTTLE', message: 'Too many failed logins.', hint: 'Wait 15 minutes, then retry.' } });
    const user = store.query('users', (x) => x.login === b.login)[0];
    if (!user) { noteLoginFail(tkey); return send(res, 401, { error: { code: 'BAD_CRED', message: 'Bad login/password.', hint: 'Check login, or register.' } }); }
    if (!verifyPassword(b.password, user.pass)) { noteLoginFail(tkey); return send(res, 401, { error: { code: 'BAD_CRED', message: 'Bad login/password.', hint: 'Check password.' } }); }
    clearLoginFails(tkey);
    if (needsRehash(user.pass)) store.update('users', user.id, { pass: hashPassword(b.password) });
    const jti = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const device = b.device || 'cli';
    store.insert('sessions', { jti, userId: user.id, device, revoked: false, at: new Date().toISOString() });
    const token = signJwt({ sub: user.id, login: user.login, jti }, 3600 * 12);
    const refresh = signJwt({ sub: user.id, jti, refresh: true }, 3600 * 24 * 14);
    return send(res, 200, { token, refresh, expiresIn: 43200, tokenType: 'Bearer' });
  }
  if (p === '/api/auth/refresh' && m === 'POST') {
    const b = await readBody(req);
    const v = verifyJwt(b.refresh || '');
    if (!v || !v.refresh) return send(res, 401, { error: { code: 'BAD_REFRESH', message: 'Bad refresh token.', hint: 'Login again.' } });
    const sess = store.query('sessions', (s) => s.jti === v.jti && !s.revoked)[0];
    if (!sess) return send(res, 401, { error: { code: 'REVOKED', message: 'Session revoked.', hint: 'Login again.' } });
    const user = store.get('users', v.sub);
    if (!user) return send(res, 401, { error: { code: 'NO_USER', message: 'User gone.', hint: 'Register again.' } });
    const token = signJwt({ sub: user.id, login: user.login, jti: v.jti }, 3600 * 12);
    return send(res, 200, { token, expiresIn: 43200 });
  }
  if (p === '/api/auth/revoke' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    const rows = store.all('sessions');
    for (const s of rows) if (s.userId === me.id && (!b.jti || s.jti === b.jti)) s.revoked = true;
    store.replaceAll('sessions', rows);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    const { pass, ...pub } = me;
    const claims = tokenClaims(req);
    pub.sessions = mySessions(me, claims && claims.jti);
    pub.teams = myTeams(me.id);
    return send(res, 200, pub);
  }
  if (p === '/api/me' && m === 'PATCH') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    const patch = {};
    if (b.firstName != null) patch.firstName = b.firstName;
    if (b.lastName != null) patch.lastName = b.lastName;
    if (b.email != null) patch.email = b.email;
    if (b.affiliationOrgId !== undefined) patch.affiliationOrgId = b.affiliationOrgId;
    const out = store.update('users', me.id, patch);
    const { pass, ...pub } = out;
    return send(res, 200, pub);
  }
  if (p === '/api/me/sessions' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    const claims = tokenClaims(req);
    return send(res, 200, { items: mySessions(me, claims && claims.jti) });
  }
  const ms = p.match(/^\/api\/me\/sessions\/([A-Za-z0-9_.-]+)$/);
  if (ms && m === 'DELETE') {
    const me = needAuth(req, res);
    if (!me) return;
    const claims = tokenClaims(req);
    const row = store.query('sessions', (s) => s.jti === ms[1] && String(s.userId) === String(me.id))[0];
    if (!row) return send(res, 404, { error: { code: 'NO_SESSION', message: 'Session not found.', hint: '' } });
    store.update('sessions', row.id, { revoked: true, revokedAt: new Date().toISOString() });
    audit(me.id, 'session.revoke', `session:${row.id}`, { device: row.device || null });
    return send(res, 200, { ok: true, current: Boolean(claims && claims.jti === row.jti) });
  }
  if (p === '/api/me/teams' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    return send(res, 200, { items: myTeams(me.id) });
  }
  if (p === '/api/me/password' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    if (!verifyPassword(b.old || '', me.pass)) return send(res, 403, { error: { code: 'BAD_OLD_PASS', message: 'Current password is wrong.', hint: 'Try again.' } });
    const np = String(b.new || '');
    if (np.length < 6) return send(res, 422, { error: { code: 'PASS', message: 'New password min 6 chars.', hint: 'Use 6+ chars.' } });
    store.update('users', me.id, { pass: hashPassword(np) });
    const claims = tokenClaims(req);
    let revokedOthers = 0;
    const rows = store.all('sessions');
    for (const s of rows) {
      if (String(s.userId) !== String(me.id) || s.revoked) continue;
      if (claims && s.jti === claims.jti) continue;
      s.revoked = true;
      revokedOthers += 1;
    }
    store.replaceAll('sessions', rows);
    audit(me.id, 'user.password.change', `user:${me.id}`, { revokedOthers });
    return send(res, 200, { ok: true, revokedOthers });
  }

  // contests list/create
  if (p === '/api/contests' && m === 'GET') {
    const me = authUser(req);
    const role = u.searchParams.get('role') || '';
    const arch = String(u.searchParams.get('archived') || '').toLowerCase();
    const showArchived = ['yes', 'true', '1'].includes(arch);
    const q = (u.searchParams.get('q') || '').toLowerCase();
    let items = store.all('contests');
    if (!showArchived) items = items.filter((c) => !c.archived);
    if (q) items = items.filter((c) => (c.name + ' ' + (c.description || '')).toLowerCase().includes(q));
    const has = (arr, id) => (arr || []).map(String).includes(String(id));
    if (me && role === 'joined') items = items.filter((c) => has(c.members, me.id));
    if (me && role === 'pending') items = items.filter((c) => has(c.pending, me.id));
    if (me && role === 'managed') items = items.filter((c) => has(c.admins, me.id));
    if (me && role === 'other') items = items.filter((c) => !has(c.members, me.id) && !has(c.pending, me.id));
    return send(res, 200, { items, total: items.length });
  }
  if (p === '/api/contests' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Name required.', hint: 'e.g. UZI, 2026.' } });
    const c = store.insert('contests', {
      name: b.name, description: b.description || '', mode: b.mode || 'ICPC',
      lifecycle: 'draft', registration: b.registration || 'approval', archived: false,
      startAt: b.startAt || null, endAt: b.endAt || null, freezeAt: b.freezeAt || null,
      settings: b.settings || { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true, deadlinePolicy: { enabled: false, lateMode: 'soft', penaltyKind: 'perDay', penaltyValue: 5, graceMin: 0 } },
      members: [], pending: [], admins: [me.id], template: b.template || null,
    });
    audit(me.id, 'contest.create', `contest:${c.id}`, {});
    return send(res, 201, c);
  }

  // contest sub-routes
  let mt = p.match(/^\/api\/contests\/(\d+)\/(apply|members|members\/approve|members\/csv|duplicate|teams|problems|rankings\/live|ranking|ranking\.csv|grade|grade\.ics|deadlines\/bulk-extend|audit|clarifications|news|subpages)$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const cid = mt[1];
    const act = mt[2];
    const c = store.get('contests', cid);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    if (act === 'apply' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      if ((c.members || []).map(String).includes(String(me.id))) return send(res, 200, { ok: true, state: 'joined' });
      if (c.registration === 'open') {
        c.members.push(me.id);
        store.update('contests', c.id, { members: c.members });
        return send(res, 200, { ok: true, state: 'joined' });
      }
      if (!(c.pending || []).map(String).includes(String(me.id))) {
        c.pending.push(me.id);
        store.update('contests', c.id, { pending: c.pending });
      }
      audit(me.id, 'contest.apply', `contest:${c.id}`, {});
      return send(res, 200, { ok: true, state: 'pending' });
    }
    if (act === 'members' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: 'Ask contest admin.' } });
      const users = (c.members || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login } : { id }; });
      const pending = (c.pending || []).map((id) => { const x = store.get('users', id); return x ? { id: x.id, login: x.login } : { id }; });
      return send(res, 200, { members: users, pending });
    }
    if (act === 'members' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const login = String(b.login || '').trim();
      const wanted = String(b.role || 'participant');
      if (!login) return send(res, 422, { error: { code: 'LOGIN', message: 'login required.', hint: '' } });
      if (!['participant', 'teacher', 'jury'].includes(wanted)) return send(res, 422, { error: { code: 'ROLE', message: 'role must be participant|teacher|jury.', hint: '' } });
      const u = store.query('users', (x) => x.login === login)[0];
      if (!u) return send(res, 404, { error: { code: 'NO_USER', message: `No user "${login}".`, hint: 'They must register first.' } });
      if (wanted === 'participant') {
        if ((c.members || []).map(String).includes(String(u.id))) return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
        store.update('contests', c.id, {
          members: [...(c.members || []), u.id],
          pending: (c.pending || []).filter((x) => String(x) !== String(u.id)),
        });
        audit(me.id, 'contest.member.add', `contest:${c.id}`, { login, role: wanted });
        return send(res, 201, { ok: true, role: wanted, userId: u.id });
      }
      if ((c.admins || []).map(String).includes(String(u.id))) return send(res, 200, { ok: true, already: true, role: wanted, userId: u.id });
      store.update('contests', c.id, {
        admins: [...(c.admins || []), u.id],
        members: [...(c.members || []).filter((x) => String(x) !== String(u.id)), u.id],
        pending: (c.pending || []).filter((x) => String(x) !== String(u.id)),
      });
      audit(me.id, 'contest.admin.grant', `contest:${c.id}`, { login, role: wanted });
      return send(res, 201, { ok: true, role: wanted, userId: u.id });
    }
    if (act === 'members/approve' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const ids = b.userIds || (b.userId ? [b.userId] : []) || [];
      const approve = b.approve !== false;
      let pend = c.pending || [];
      let mem = c.members || [];
      if (!approve) {
        for (const id of ids) pend = pend.filter((x) => String(x) !== String(id));
        store.update('contests', c.id, { pending: pend, members: mem });
        audit(me.id, 'contest.reject', `contest:${c.id}`, { ids });
        return send(res, 200, { ok: true, rejected: ids.length, members: mem.length, pending: pend.length });
      }
      if (b.approveAllByFilter) {
        const q = String(b.q || '').toLowerCase();
        const keep = [];
        for (const id of pend) {
          const u2 = store.get('users', id);
          const login = u2 ? String(u2.login) : '';
          if (q && !login.toLowerCase().includes(q)) { keep.push(id); continue; }
          if (!mem.map(String).includes(String(id))) mem.push(id);
        }
        pend = keep;
      } else {
        for (const id of ids) {
          pend = pend.filter((x) => String(x) !== String(id));
          if (!mem.map(String).includes(String(id))) mem.push(Number(id) || id);
        }
      }
      store.update('contests', c.id, { pending: pend, members: mem });
      audit(me.id, 'contest.approve', `contest:${c.id}`, { ids });
      return send(res, 200, { ok: true, members: mem.length, pending: pend.length });
    }
    if (act === 'members/csv' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return forbid(res);
      const b = await readBody(req);
      const logins = String(b.csv || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      let added = 0;
      const unknown = [];
      const mem = c.members || [];
      for (const lg of logins) {
        const x = store.query('users', (u2) => u2.login === lg)[0];
        if (!x) { unknown.push(lg); continue; }
        if (!mem.map(String).includes(String(x.id))) { mem.push(x.id); added += 1; }
      }
      store.update('contests', c.id, { members: mem });
      audit(me.id, 'contest.members.csv', `contest:${c.id}`, { added, unknown: unknown.length });
      return send(res, 200, { ok: true, added, unknown });
    }
    if (act === 'duplicate' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      if (!canManageContest(me, c)) return forbid(res);
      const b = await readBody(req);
      const nc = store.insert('contests', { ...c, id: undefined, name: b.name || `${c.name} (copy)`, lifecycle: 'draft', members: [], pending: [], archived: false });
      const setMap = new Map();
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) {
        const nps = store.insert('problemSets', { ...ps, id: undefined, contestId: nc.id });
        setMap.set(String(ps.id), nps.id);
      }
      const probMap = new Map();
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        const npr = store.insert('problems', { ...pr, id: undefined, contestId: nc.id, setId: pr.setId ? (setMap.get(String(pr.setId)) || null) : null });
        probMap.set(String(pr.id), npr.id);
      }
      for (const g of store.query('testGroups', (x) => probMap.has(String(x.problemId)))) {
        const ng = store.insert('testGroups', { ...g, id: undefined, problemId: probMap.get(String(g.problemId)) });
        for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) {
          store.insert('testCases', { ...tc, id: undefined, groupId: ng.id });
        }
      }
      for (const nw of store.query('news', (x) => String(x.contestId) === String(c.id))) {
        store.insert('news', { ...nw, id: undefined, contestId: nc.id });
      }
      audit(me.id, 'contest.duplicate', `contest:${nc.id}`, { from: c.id, problems: probMap.size });
      return send(res, 201, nc);
    }
    if (act === 'teams' && m === 'GET') return send(res, 200, { items: store.query('teams', (x) => String(x.contestId) === String(c.id)) });
    if (act === 'teams' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const b = await readBody(req);
      if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Team name required.', hint: '' } });
      const tm = store.insert('teams', { name: b.name, contestId: c.id, memberIds: b.memberIds || [me.id], loginIdentity: b.loginIdentity || b.name, scoreboardName: b.name });
      return send(res, 201, tm);
    }
    if (act === 'problems' && m === 'GET') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const tag = u.searchParams.get('tag') || '';
      const statusF = u.searchParams.get('status') || 'all';
      const me = authUser(req);
      const sets = store.query('problemSets', (x) => String(x.contestId) === String(c.id)).sort((a, b) => (a.order || 0) - (b.order || 0));
      let probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const canManage = canManageContest(me, c);
      if (!canManage) probs = probs.filter((x) => (x.visibility || 'visible') === 'visible');
      if (q) probs = probs.filter((x) => (x.code + ' ' + x.name).toLowerCase().includes(q));
      if (tag) probs = probs.filter((x) => (x.tags || []).includes(tag));
      // solvesPct: unique accepted solvers / contest members (real difficulty signal)
      const acceptedBy = new Map();
      for (const s of store.query('submits', (x) => String(x.contestId) === String(c.id) && !x.sampleOnly)) {
        if (!isAccepted(s.status)) continue;
        const k = String(s.problemId);
        if (!acceptedBy.has(k)) acceptedBy.set(k, new Set());
        acceptedBy.get(k).add(String(s.userId));
      }
      const memberDenom = Math.max(1, (c.members || []).length);
      const setById = new Map(sets.map((x) => [String(x.id), x.name]));
      // inline verdict chip + score per problem for caller
      const items = probs.map((x) => {
        let best = null;
        let tries = 0;
        let score = 0;
        if (me) {
          const subs = store.query('submits', (s) => String(s.problemId) === String(x.id) && String(s.userId) === String(me.id) && !s.sampleOnly);
          tries = subs.length;
          for (const s of subs) {
            score = Math.max(score, Number(s.points || 0));
            if (isAccepted(s.status)) { best = s.status; break; }
          }
          if (!best && subs.length) best = subs[subs.length - 1].status;
        }
        const solvesPct = Math.round((((acceptedBy.get(String(x.id)) || new Set()).size) / memberDenom) * 100);
        const setterUser = (x.setterId || x.by) ? store.get('users', x.setterId || x.by) : null;
        return {
          ...enrichProblemWithDeadline(x, c),
          _best: best, _tries: tries, _score: score, solvesPct,
          alias: (x.aliasLetters || {})[String(c.id)] || x.code || null,
          setter: setterUser ? setterUser.login : null,
          group: setById.get(String(x.setId)) || null,
        };
      });
      const dl = contestDeadlines(c);
      if (me && statusF === 'solved') return send(res, 200, { sets, items: items.filter((x) => x._best && isAccepted(x._best)), deadlinePolicy: dl.policy });
      if (me && statusF === 'todo') return send(res, 200, { sets, items: items.filter((x) => !x._best || !isAccepted(x._best)), deadlinePolicy: dl.policy });
      return send(res, 200, { sets, items, deadlinePolicy: dl.policy });
    }
    if (act === 'problems' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
      const b = await readBody(req);
      if (!b.name) return send(res, 422, { error: { code: 'NAME', message: 'Problem name required.', hint: '' } });
      const pr = store.insert('problems', {
        contestId: c.id, setId: b.setId || null, code: b.code || 'A', name: b.name,
        setterId: me.id,
        statementMd: b.statementMd || '', statementHtml: b.statementHtml || '',
        samples: b.samples || [], limits: b.limits || { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: {} },
        visibility: b.visibility || 'draft', tags: b.tags || [], difficulty: b.difficulty || 1,
        pdfBadge: b.pdfBadge || 'HTML', version: 1, aliasLetters: {}, deadlineAt: b.deadlineAt || null,
      });
      audit(me.id, 'problem.create', `problem:${pr.id}`, {});
      return send(res, 201, pr);
    }
    if (act === 'rankings/live' && m === 'GET') {
      const me = authUser(req);
      const boardMode = ((c.settings || {}).board || {}).mode || 'everyone';
      if (boardMode === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      const snap = () => {
        try {
          const body = buildRanking(c, me);
          res.write(`data: ${JSON.stringify({ at: Date.now(), rows: body.rows, problems: body.problems, mode: body.mode, freezeAt: body.freezeAt, unfreezeAt: body.unfreezeAt, me: body.me })}\n\n`);
        } catch { /* client gone */ }
      };
      snap();
      const iv = setInterval(snap, 15000);
      req.on('close', () => clearInterval(iv));
      return;
    }
    if ((act === 'ranking' || act === 'ranking.csv') && m === 'GET') {
      const me = authUser(req);
      const boardMode = ((c.settings || {}).board || {}).mode || 'everyone';
      if (boardMode === 'hidden' && !canManageContest(me, c)) {
        return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
      }
      const body = buildRanking(c, me);
      if (act === 'ranking') return send(res, 200, body);
      const cellText = (cell) => (cell == null ? '' : typeof cell === 'object' ? String(cell.text ?? cell.points ?? '') : String(cell));
      const head = ['rank', 'contestant', ...body.problems.map((p2) => p2.code || `P${p2.id}`), 'total'];
      const lines = [head.join(',')];
      (body.rows || []).forEach((row, i) => {
        lines.push([
          row.rank ?? (i + 1),
          csvCell(row.name || row.contestantId || ''),
          ...body.problems.map((p2) => csvCell(cellText((row.cells || {})[p2.id]))),
          row.total ?? row.points ?? row.solved ?? '',
        ].join(','));
      });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ranking-contest-${c.id}.csv"`, 'Access-Control-Allow-Origin': '*' });
      return res.end(lines.join('\n'));
    }
    if (act === 'grade' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return;
      const uid = u.searchParams.get('user') || me.id;
      if (String(uid) !== String(me.id) && !canManageContest(me, c) && !sharesTeam(c, me.id, uid)) return forbid(res);
      const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const { out, deadlines, policy, submittedAt } = computeLabsGrade(c, probs, (s) => String(s.userId) === String(uid));
      return send(res, 200, { ...out, deadlines, deadlinePolicy: policy, submittedAt });
    }
    if (act === 'grade.ics' && m === 'GET') {
      const dl = contestDeadlines(c);
      const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SatoriV2//grade//EN'];
      const stampOf = (at) => new Date(at).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const ev = (uid, at, summary, desc) => {
        lines.push('BEGIN:VEVENT', `UID:${uid}@satori`, `DTSTAMP:${stampOf(at)}`, `DTSTART:${stampOf(at)}`, `SUMMARY:${icsText(summary)}`);
        if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
        lines.push('END:VEVENT');
      };
      for (const pr of probs) {
        const at = dl.deadlines[pr.id] || pr.deadlineAt || ((c.settings || {}).defaultDeadline) || c.endAt;
        if (!at) continue;
        ev(`problem-${pr.id}`, at, `${c.name} — ${pr.code} ${pr.name} due`, dl.policy.enabled ? `Late policy ${dl.policy.lateMode} ${dl.policy.penaltyKind} ${dl.policy.penaltyValue}` : 'Default deadline');
      }
      if (c.startAt) ev('contest-start', c.startAt, `${c.name} — start`, '');
      if (c.endAt) ev('contest-end', c.endAt, `${c.name} — end`, '');
      if (c.freezeAt) ev('contest-freeze', c.freezeAt, `${c.name} — scoreboard freeze`, '');
      lines.push('END:VCALENDAR');
      return sendText(res, 200, lines.join('\r\n') + '\r\n', 'text/calendar');
    }
    if (act === 'deadlines/bulk-extend' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      const role = contestRole(c, me.id);
      if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
      const b = await readBody(req);
      const days = Number(b.days || 0);
      if (!Number.isFinite(days) || days === 0) return send(res, 422, { error: { code: 'DAYS', message: 'days (+/-) required.', hint: 'e.g. {days: 7}.' } });
      const ms = days * 86400000;
      const shift = (iso) => (iso ? new Date(new Date(iso).getTime() + ms).toISOString() : null);
      const settings = { ...(c.settings || {}) };
      if (settings.defaultDeadline) settings.defaultDeadline = shift(settings.defaultDeadline);
      const patch = { settings };
      if (c.startAt) patch.startAt = shift(c.startAt);
      if (c.endAt) patch.endAt = shift(c.endAt);
      if (c.freezeAt) patch.freezeAt = shift(c.freezeAt);
      store.update('contests', c.id, patch);
      let shifted = 0;
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) {
        if (!ps.deadlineAt) continue;
        store.update('problemSets', ps.id, { deadlineAt: shift(ps.deadlineAt) });
        shifted += 1;
      }
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        if (!pr.deadlineAt) continue;
        store.update('problems', pr.id, { deadlineAt: shift(pr.deadlineAt) });
        shifted += 1;
      }
      audit(me.id, 'contest.bulk-extend', `contest:${c.id}`, { days, shifted });
      return send(res, 200, { ok: true, shifted, days, startAt: patch.startAt || c.startAt || null, endAt: patch.endAt || c.endAt || null });
    }
    if (act === 'audit' && m === 'GET') {
      const me = needAuth(req, res);
      if (!me) return;
      return send(res, 200, { items: store.query('audit', (a) => String(a.target).includes(String(c.id))).slice(-200) });
    }
    if ((act === 'clarifications' || act === 'news' || act === 'subpages') && m === 'GET') {
      const col = act === 'clarifications' ? 'clarifications' : act;
      return send(res, 200, { items: store.query(col, (x) => String(x.contestId) === String(c.id)) });
    }
    if ((act === 'clarifications' || act === 'news' || act === 'subpages') && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      if (act !== 'clarifications' && !canManageContest(me, c)) return forbid(res);
      if (rateLimited(`${act}:${me.id}`, act === 'clarifications' ? 5 : 20, 60000)) return send(res, 429, { error: { code: 'THROTTLE', message: 'Too many posts.', hint: 'Slow down and retry in a minute.' } });
      const b = await readBody(req);
      const col = act === 'clarifications' ? 'clarifications' : act;
      const row = store.insert(col, { contestId: c.id, authorId: me.id, ...b, createdAt: new Date().toISOString() });
      return send(res, 201, row);
    }
  }

  // integrity (jury-only): similarity, timeline flags, appeals
  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/(similarity|timeline|appeals)$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    if (mt[2] === 'similarity') {
      const threshold = Number(u.searchParams.get('threshold') || 0.6);
      const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly).slice(-200);
      const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
      const pairs = similarityGraph(subs)
        .filter((p2) => p2.score >= threshold)
        .map((p2) => {
          const a = subs.find((s) => String(s.id) === String(p2.a)) || {};
          const bb = subs.find((s) => String(s.id) === String(p2.b)) || {};
          return { ...p2, userA: users.get(String(a.userId)) || '?', userB: users.get(String(bb.userId)) || '?', codeA: a.code || '', codeB: bb.code || '' };
        })
        .sort((x, y) => y.score - x.score);
      return send(res, 200, { pairs, count: pairs.length, threshold, scanned: subs.length });
    }
    if (mt[2] === 'timeline') {
      const subs = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly);
      const flags = timelineFlags(subs).map((f) => ({ ...f, text: `submit #${f.submitId} — ${f.reason}${f.dtMs != null ? ` (${Math.round(f.dtMs / 1000)}s)` : ''}` }));
      return send(res, 200, { flags, count: flags.length });
    }
    const rows = store.query('appeals', (a) => String(a.contestId) === String(c.id) && a.status === 'open');
    const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
    return send(res, 200, { items: rows.map((a) => ({ id: a.id, student: users.get(String(a.userId)) || '?', text: a.text || '', at: a.at, status: a.status })) });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/appeals\/(\d+)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const row = store.get('appeals', mt[2]);
    if (!row || String(row.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_APPEAL', message: 'Appeal not found.', hint: '' } });
    const b = await readBody(req);
    const verdict = String(b.verdict || 'resolved');
    store.update('appeals', row.id, { status: 'resolved', verdict, resolvedBy: me.id, resolvedAt: new Date().toISOString() });
    audit(me.id, 'contest.appeal.resolve', `contest:${c.id}`, { appealId: row.id, verdict });
    return send(res, 200, { ok: true, verdict });
  }
  // exam controls: canonical settings.exam { fullscreen, pasteBlock, shuffle, ipAllow, timeWindow }
  mt = p.match(/^\/api\/contests\/(\d+)\/exam$/);
  if (mt && (m === 'GET' || m === 'PATCH')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    const isMember = canManageContest(me, c) || (c.members || []).map(String).includes(String(me.id));
    if (!isMember) return forbid(res);
    if (m === 'GET') return send(res, 200, { settings: normalizeExam(c) });
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const next = normalizeExam(c, b.settings || b);
    store.update('contests', c.id, { settings: { ...(c.settings || {}), exam: next } });
    audit(me.id, 'contest.exam.update', `contest:${c.id}`, next);
    return send(res, 200, { ok: true, settings: next });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/exam\/violations$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    const isMember = canManageContest(me, c) || (c.members || []).map(String).includes(String(me.id));
    if (!isMember) return forbid(res);
    if (m === 'POST') {
      const b = await readBody(req);
      const row = store.insert('violations', { contestId: c.id, userId: me.id, type: String(b.type || 'unknown').slice(0, 40), detail: String(b.detail || '').slice(0, 500), at: new Date().toISOString() });
      return send(res, 201, { ok: true, id: row.id });
    }
    if (!canManageContest(me, c)) return forbid(res);
    const items = store.query('violations', (v) => String(v.contestId) === String(c.id));
    return send(res, 200, { items, count: items.length });
  }

  // contest-scoped members / news / webhooks management
  mt = p.match(/^\/api\/contests\/(\d+)\/members\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const uid = mt[2];
    const members = (c.members || []).filter((x) => String(x) !== String(uid));
    const pending = (c.pending || []).filter((x) => String(x) !== String(uid));
    store.update('contests', c.id, { members, pending });
    audit(me.id, 'contest.member.remove', `contest:${c.id}`, { uid });
    return send(res, 200, { ok: true, members: members.length });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/news\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const row = store.get('news', mt[2]);
    if (!row || String(row.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_NEWS', message: 'Announcement not found.', hint: '' } });
    store.remove('news', row.id);
    audit(me.id, 'contest.news.delete', `contest:${c.id}`, { newsId: row.id });
    return send(res, 200, { ok: true, deleted: true });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    if (m === 'GET') return send(res, 200, { items: store.query('webhooks', (h) => String(h.contestId) === String(c.id)) });
    const b = await readBody(req);
    if (!b.url) return send(res, 422, { error: { code: 'URL', message: 'Webhook URL required.', hint: 'https://…' } });
    const row = store.insert('webhooks', { contestId: c.id, url: b.url, events: b.events || ['submit.judged'], by: me.id, at: new Date().toISOString() });
    audit(me.id, 'contest.webhook.register', `contest:${c.id}`, { url: b.url });
    return send(res, 201, row);
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/deliveries$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const items = store.query('deliveries', (d) => String(d.contestId) === String(c.id))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 50);
    return send(res, 200, { items });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/(\d+)\/ping$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const hook = store.get('webhooks', mt[2]);
    if (!hook || String(hook.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_HOOK', message: 'Webhook not found.', hint: '' } });
    const result = await deliverToHook(hook, 'ping', { event: 'ping', at: new Date().toISOString(), payload: { contestId: c.id } });
    try {
      store.insert('deliveries', {
        hookId: hook.id, contestId: hook.contestId || null, event: 'ping', url: hook.url,
        ok: result.ok, httpStatus: result.httpStatus || null, attempts: result.attempts,
        error: result.error || null, ms: result.ms || null, at: new Date().toISOString(),
      });
      pruneDeliveries();
    } catch { /* log best-effort */ }
    audit(me.id, 'contest.webhook.ping', `contest:${c.id}`, { url: hook.url, ok: result.ok });
    return send(res, 200, {
      ok: true, delivered: result.ok, httpStatus: result.httpStatus || null,
      attempts: result.attempts, error: result.error || null,
      message: result.ok
        ? `Delivered (HTTP ${result.httpStatus}) in ${result.ms}ms.`
        : `Delivery failed after ${result.attempts} attempt(s): ${result.error || `HTTP ${result.httpStatus}`}`,
    });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const hook = store.get('webhooks', mt[2]);
    if (!hook || String(hook.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_HOOK', message: 'Webhook not found.', hint: '' } });
    store.remove('webhooks', hook.id);
    audit(me.id, 'contest.webhook.delete', `contest:${c.id}`, { url: hook.url });
    return send(res, 200, { ok: true, deleted: true });
  }

  // grading: what-if preview, bulk feedback, grade CSV export (USOS-style)
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/(preview|feedback)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
    const has = (v) => v !== '' && v != null;
    if (mt[2] === 'preview') {
      const dp = { ...(((c.settings || {}).deadlinePolicy) || {}) };
      if (has(b.penaltyKind)) dp.penaltyKind = String(b.penaltyKind);
      if (has(b.latePenalty)) dp.penaltyValue = Number(b.latePenalty);
      if (has(b.graceMin)) dp.graceMin = Number(b.graceMin);
      if (has(b.capZeroAfterDays)) dp.capZeroAfterDays = Number(b.capZeroAfterDays);
      const scoring = { ...(((c.settings || {}).scoring) || {}) };
      if (has(b.floorPct)) scoring.floorPct = Number(b.floorPct);
      if (has(b.dropWorstN)) scoring.dropWorstN = Number(b.dropWorstN);
      const bestOfK = has(b.bestOfK) ? Number(b.bestOfK) : (c.settings || {}).bestOfK;
      const c2 = { ...c, settings: { ...(c.settings || {}), deadlinePolicy: dp, scoring, bestOfK } };
      const probs2 = probs.map((p2) => (b.weights && has(b.weights[p2.id]) ? { ...p2, weight: Number(b.weights[p2.id]) } : p2));
      const members = (c.members || []).map((id) => store.get('users', id)).filter(Boolean);
      const rows = members.map((u2) => {
        const { out } = computeLabsGrade(c2, probs2, (s) => String(s.userId) === String(u2.id));
        return { login: u2.login, total: out.total, grade: out.grade };
      }).sort((a, b2) => b2.total - a.total);
      const login = String(b.login || b.student || b.previewStudent || '').toLowerCase();
      const student = rows.find((r) => String(r.login).toLowerCase() === login) || null;
      const avg = rows.length ? Math.round((rows.reduce((a, r) => a + r.total, 0) / rows.length) * 10) / 10 : 0;
      audit(me.id, 'contest.grade.preview', `contest:${c.id}`, { overrides: Object.keys(b) });
      return send(res, 200, {
        applied: {
          bestOfK: bestOfK ?? null, penaltyKind: dp.penaltyKind ?? null, penaltyValue: dp.penaltyValue ?? null,
          graceMin: dp.graceMin ?? null, capZeroAfterDays: dp.capZeroAfterDays ?? null,
          floorPct: scoring.floorPct ?? null, dropWorstN: scoring.dropWorstN ?? null,
        },
        rows: rows.slice(0, 100), student, summary: { students: rows.length, avg },
      });
    }
    const text = String(b.text || '').slice(0, 2000);
    if (!text) return send(res, 422, { error: { code: 'TEXT', message: 'Feedback text required.', hint: '' } });
    const filter = String(b.filter || '').trim().replace(/^problem\s+/i, '');
    let matched = store.query('submits', (s) => String(s.contestId) === String(c.id) && !s.sampleOnly);
    if (filter) {
      const fl = filter.toUpperCase();
      const byProblem = probs.filter((p2) => String(p2.code).toUpperCase() === fl);
      matched = byProblem.length
        ? matched.filter((s) => byProblem.some((p2) => String(p2.id) === String(s.problemId)))
        : matched.filter((s) => String(s.status).toUpperCase() === fl);
    }
    const userIds = [...new Set(matched.map((s) => String(s.userId)))];
    for (const uid of userIds) store.insert('notifications', { userId: uid, type: 'grade.feedback', payload: { contestId: c.id, filter, text }, read: false, at: new Date().toISOString() });
    audit(me.id, 'contest.grade.feedback', `contest:${c.id}`, { filter, submits: matched.length, users: userIds.length });
    return send(res, 200, { ok: true, count: matched.length, users: userIds.length });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/grade\/export\.csv$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
    if (!canManageContest(me, c)) return forbid(res);
    const probs = store.query('problems', (x) => String(x.contestId) === String(c.id));
    const scale = parseGradeScale(u.searchParams.get('scale'));
    const members = (c.members || []).map((id) => store.get('users', id)).filter(Boolean).sort((a, b2) => String(a.login).localeCompare(String(b2.login)));
    const lines = [];
    lines.push(['login', 'usos_id', 'first_name', 'last_name', 'email', 'total', 'pct', 'grade', ...probs.map((p2) => p2.code || `P${p2.id}`)].join(','));
    for (const u2 of members) {
      const { out } = computeLabsGrade(c, probs, (s) => String(s.userId) === String(u2.id));
      const detail = new Map((out.detail || []).map((d) => [String(d.problemId), d]));
      const cells = probs.map((p2) => { const d = detail.get(String(p2.id)); return d ? Math.round(Number(d.points) * 10) / 10 : 0; });
      lines.push([csvCell(u2.login), csvCell(u2.usosId || ''), csvCell(u2.firstName || ''), csvCell(u2.lastName || ''), csvCell(u2.email || ''), out.total, out.total, gradeFromScale(scale, out.total), ...cells].join(','));
    }
    audit(me.id, 'contest.grade.export', `contest:${c.id}`, { scale: scale.map((s) => `${s.min}:${s.grade}`).join(' ') });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="grades-contest-${c.id}.csv"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(lines.join('\n'));
  }

  // single contest get/patch/delete (DELETE: archive-first, second call purges)
  mt = p.match(/^\/api\/contests\/(\d+)$/);
  if (mt && (m === 'GET' || m === 'PATCH' || m === 'DELETE')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Not found.', hint: '' } });
    if (m === 'GET') return send(res, 200, c);
    const me = needAuth(req, res);
    if (!me) return;
    if (m === 'DELETE') {
      if (!canManageContest(me, c)) return forbid(res);
      if (!c.archived && c.lifecycle !== 'archived') {
        store.update('contests', c.id, { archived: true });
        audit(me.id, 'contest.archive', `contest:${c.id}`, {});
        return send(res, 200, { ok: true, archived: true, hint: 'Call DELETE again to purge permanently.' });
      }
      for (const pr of store.query('problems', (x) => String(x.contestId) === String(c.id))) {
        for (const g of store.query('testGroups', (x) => String(x.problemId) === String(pr.id))) {
          for (const tc of store.query('testCases', (x) => String(x.groupId) === String(g.id))) store.remove('testCases', tc.id);
          store.remove('testGroups', g.id);
        }
        store.remove('problems', pr.id);
      }
      for (const ps of store.query('problemSets', (x) => String(x.contestId) === String(c.id))) store.remove('problemSets', ps.id);
      for (const t of store.query('teams', (x) => String(x.contestId) === String(c.id))) store.remove('teams', t.id);
      for (const col of ['news', 'subpages', 'clarifications']) {
        for (const r2 of store.query(col, (x) => String(x.contestId) === String(c.id))) store.remove(col, r2.id);
      }
      store.remove('contests', c.id);
      audit(me.id, 'contest.delete', `contest:${c.id}`, {});
      return send(res, 200, { ok: true, deleted: true });
    }
    const role = contestRole(c, me.id);
    if (!['contest_admin', 'superadmin'].includes(role)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Admins only.', hint: '' } });
    const b = await readBody(req);
    const out = store.update('contests', c.id, b);
    audit(me.id, 'contest.update', `contest:${c.id}`, b);
    return send(res, 200, out);
  }

  // test group delete
  mt = p.match(/^\/api\/problems\/(\d+)\/tests\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const prd = store.get('problems', mt[1]);
    if (!prd) return send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return;
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
      const visP = pr.visibility || 'visible';
      if (visP !== 'visible' && !canManageProblem(authUser(req), pr)) return send(res, 403, { error: { code: 'HIDDEN', message: 'Problem is not visible.', hint: 'Ask a contest admin to publish it.' } });
      const contest = pr.contestId ? store.get('contests', pr.contestId) : null;
      return send(res, 200, contest ? enrichProblemWithDeadline(pr, contest) : pr);
    }
    if (!sub && m === 'PATCH') {
      const me = needAuth(req, res);
      if (!me) return;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      if (b.limits && JSON.stringify(b.limits) !== JSON.stringify(pr.limits)) {
        store.insert('limitHistory', { problemId: pr.id, from: pr.limits, to: b.limits, by: me.id, at: new Date().toISOString() });
        fireWebhooks('limit.changed', { problemId: pr.id, contestId: pr.contestId, limits: b.limits });
      }
      const out = store.update('problems', pr.id, { ...b, version: (pr.version || 1) + 1 });
      audit(me.id, 'problem.update', `problem:${pr.id}`, b);
      return send(res, 200, out);
    }
    if (!sub && m === 'DELETE') {
      const me = needAuth(req, res);
      if (!me) return;
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
      if (!me) return;
      if (!canManageProblem(me, pr)) return forbid(res);
      const groups = store.query('testGroups', (g) => String(g.problemId) === String(pr.id));
      const items = groups.map((g) => ({ ...g, cases: store.query('testCases', (c) => String(c.groupId) === String(g.id)) }));
      return send(res, 200, { items });
    }
    if (sub === 'tests' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      if (b.group) return send(res, 201, store.insert('testGroups', { problemId: pr.id, ...b.group }));
      if (b.case) return send(res, 201, store.insert('testCases', { ...b.case }));
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
      if (!me) return;
      if (!canManageProblem(me, pr)) return forbid(res);
      const subs = store.query('submits', (s) => String(s.problemId) === String(pr.id) && !s.sampleOnly && s.perTestFull);
      const fails = {};
      for (const s of subs) for (const t of (s.perTestFull || [])) if (t.verdict !== 'OK') fails[t.n] = (fails[t.n] || 0) + 1;
      return send(res, 200, { fails });
    }
    if (sub === 'clone' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      const targetId = b.contestId || pr.contestId;
      if (String(targetId) !== String(pr.contestId) && !canManageContest(me, store.get('contests', targetId))) return forbid(res);
      const np = store.insert('problems', { ...pr, id: undefined, contestId: targetId, code: b.code || pr.code });
      return send(res, 201, np);
    }
    if (sub === 'rejudge' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
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
    if (sub === 'submit' && m === 'POST') return createSubmit(req, res, { problemId: pr.id, contestId: pr.contestId });
  }

  // submits
  if (p === '/api/submits' && m === 'POST') return createSubmit(req, res, {});
  if (p === '/api/submits/sample-run' && m === 'POST') return createSubmit(req, res, { sampleOnly: true });
  if (p === '/api/submits' && m === 'GET') {
    const me = authUser(req);
    const contest = u.searchParams.get('contest');
    const problem = u.searchParams.get('problem');
    const verdict = u.searchParams.get('verdict');
    const mine = u.searchParams.get('me');
    const limit = Math.min(Number(u.searchParams.get('limit') || 50), 1000);
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0));
    const team = u.searchParams.get('team');
    let items = store.all('submits').sort((a, b) => Number(b.id) - Number(a.id));
    if (contest) items = items.filter((s) => String(s.contestId) === String(contest));
    if (problem) items = items.filter((s) => String(s.problemId) === String(problem));
    if (verdict) items = items.filter((s) => s.status === verdict);
    if (team) items = items.filter((s) => String(s.teamId) === String(team));
    if (mine && me) items = items.filter((s) => String(s.userId) === String(me.id));
    const total = items.length;
    // code + full per-test data: owner/jury only, per verdict visibility
    const lang = reqLang(req, u);
    items = items.slice(offset, offset + limit).map((s) => localizeRow(submitView(s, me), lang));
    return send(res, 200, { items, total, limit, offset });
  }
  if (p === '/api/submits/codes.zip' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    const contest = u.searchParams.get('contest');
    const problem = u.searchParams.get('problem');
    let rows = store.all('submits').sort((a, b) => Number(b.id) - Number(a.id));
    if (contest) rows = rows.filter((s) => String(s.contestId) === String(contest));
    if (problem) rows = rows.filter((s) => String(s.problemId) === String(problem));
    rows = rows.filter((s) => String(s.userId) === String(me.id) && !s.sampleOnly).slice(0, 100);
    if (rows.length === 0) return send(res, 404, { error: { code: 'NO_CODES', message: 'No submissions of yours match.', hint: 'Adjust filters.' } });
    const files = rows.map((s) => ({
      name: `submit-${s.id}-${String(s.filename || 'code.txt').replace(/[^A-Za-z0-9._-]/g, '_')}`,
      data: Buffer.from(String(s.code || ''), 'utf8'),
    }));
    const zip = zipStore(files);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="my-codes.zip"',
      'Content-Length': zip.length,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(zip);
  }
  mt = p.match(/^\/api\/submits\/(\d+)(\/(events|rejudge))?$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const s = store.get('submits', mt[1]);
    if (!s) return send(res, 404, { error: { code: 'NO_SUBMIT', message: 'Submit not found.', hint: '' } });
    if (mt[3] === 'events' && m === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify({ submitId: s.id, status: s.status })}\n\n`);
      J.subscribe(s.id, res);
      req.on('close', () => J.unsubscribe(s.id, res));
      return;
    }
    if (mt[3] === 'rejudge' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return;
      store.update('submits', s.id, { status: 'QUE', testsDone: 0 });
      J.QUEUE.push(Number(s.id));
      processQueue()
        .then(() => fireWebhooks('rejudge.done', { submitId: s.id, contestId: s.contestId || null, problemId: s.problemId }))
        .catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (!mt[3] && m === 'GET') {
      return send(res, 200, localizeRow(submitView(s, authUser(req)), reqLang(req, u)));
    }
  }

  // notifications / notes / webhooks
  if (p === '/api/notifications' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    return send(res, 200, { items: store.query('notifications', (n) => String(n.userId) === String(me.id)).slice(-50) });
  }
  if (p === '/api/notifications/read' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    const rows = store.all('notifications');
    let read = 0;
    for (const n of rows) {
      if (String(n.userId) !== String(me.id)) continue;
      if (!(b.all || ids.includes(String(n.id)))) continue;
      if (!n.read) { n.read = true; read += 1; }
    }
    store.replaceAll('notifications', rows);
    return send(res, 200, { ok: true, read });
  }
  if (p === '/api/notifications/prefs' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return;
    return send(res, 200, { prefs: me.notificationPrefs || { inApp: true, email: false, webhook: '', watch: '' } });
  }
  if (p === '/api/notifications/prefs' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    const prefs = { inApp: true, email: false, webhook: '', watch: '', ...(me.notificationPrefs || {}), ...b };
    delete prefs._raw;
    store.update('users', me.id, { notificationPrefs: prefs });
    return send(res, 200, { ok: true, prefs });
  }
  if (p === '/api/notes' && (m === 'GET' || m === 'POST')) {
    const me = needAuth(req, res);
    if (!me) return;
    if (m === 'GET') {
      const problem = u.searchParams.get('problem');
      let items = store.query('notes', (n) => String(n.userId) === String(me.id));
      if (problem) items = items.filter((n) => String(n.problemId) === String(problem));
      return send(res, 200, { items });
    }
    const b = await readBody(req);
    return send(res, 201, store.insert('notes', { userId: me.id, problemId: b.problemId ?? b.problem ?? null, teamId: b.teamId || null, text: b.text || '', at: new Date().toISOString() }));
  }
  mt = p.match(/^\/api\/notes\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const me = needAuth(req, res);
    if (!me) return;
    const note = store.get('notes', mt[1]);
    if (!note) return send(res, 404, { error: { code: 'NO_NOTE', message: 'Note not found.', hint: '' } });
    const isSuper = (me.rolesGlobal || []).includes('superadmin');
    if (String(note.userId) !== String(me.id) && !isSuper) return forbid(res);
    store.remove('notes', note.id);
    return send(res, 200, { ok: true, deleted: true });
  }
  if (p === '/api/webhooks' && m === 'GET') return send(res, 200, { items: store.all('webhooks') });
  if (p === '/api/webhooks' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = await readBody(req);
    return send(res, 201, store.insert('webhooks', { url: b.url, events: b.events || ['submit.judged'], by: me.id }));
  }

  // V1 compat redirects (protect CLI-in-source comments: keep /contest/<id>/problems/<pid>)
  mt = p.match(/^\/contest\/(\d+)\/?$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}`, redirect: `/contests/${mt[1]}` });
  mt = p.match(/^\/contest\/(\d+)\/problems(?:\/(\d+))?$/);
  if (mt && m === 'GET') {
    if (mt[2]) {
      const pr = store.get('problems', mt[2]);
      return send(res, 200, { v1: p, v2: `/api/problems/${mt[2]}`, problem: pr });
    }
    return send(res, 302, { v1: p, v2: `/api/contests/${mt[1]}/problems` });
  }
  mt = p.match(/^\/contest\/(\d+)\/ranking\/(\d+)$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}/ranking` });
  mt = p.match(/^\/contest\/(\d+)\/results$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/submits?contest=${mt[1]}` });
  mt = p.match(/^\/subpage\/(\d+)$/);
  if (mt && m === 'GET') {
    const sp = store.get('subpages', mt[1]);
    return send(res, 200, { v1: p, subpage: sp });
  }
  if (p === '/demo' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = require('node:path').join(__dirname, 'demo.html');
      return sendText(res, 200, fs.readFileSync(f, 'utf8'));
    } catch { return send(res, 500, { error: { code: 'DEMO', message: 'demo.html missing.', hint: '' } }); }
  }
  if ((p === '/' || p === '/api') && m === 'GET') {
    return sendText(res, 200, `<h1>Satori V2 API</h1><ul><li><a href="/demo">Demo UI (no install)</a></li><li><a href="/api/openapi.json">OpenAPI</a></li><li><a href="/api/health">health</a></li><li><a href="/api/languages">languages</a></li><li><a href="/api/status">status</a></li></ul>`);
  }
  return send(res, 404, { error: { code: 'NOT_FOUND', message: `No route ${m} ${p}.`, hint: 'See /api/openapi.json.' } });
}

async function createSubmit(req, res, preset) {
  const me = needAuth(req, res);
  if (!me) return;
  const b = await readBody(req);
  const problemId = preset.problemId || b.problemId;
  const contestId = preset.contestId || b.contestId || null;
  if (!problemId) return send(res, 422, { error: { code: 'PROBLEM', message: 'problemId required.', hint: 'Pick problem row -> Submit.' } });
  const pr = store.get('problems', problemId);
  if (!pr) return send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } });
  const filename = b.filename || 'solution.cpp';
  const vf = validateFilename(filename);
  if (!vf.ok) return send(res, 422, { ...vf, suggestion: sanitizeFilename(filename) });
  const code = b.code ?? b.source ?? '';
  if (!code || String(code).length > 512 * 1024) return send(res, 422, { error: { code: 'SIZE', message: 'Code empty or >512KB.', hint: 'Paste source or shrink file.' } });
  const lang = detectLanguage(filename, b.lang || b.language);
  if (!J.LANGUAGES.includes(lang)) return send(res, 422, { error: { code: 'LANG_OFF', message: `${lang} submissions are retired in V2.`, hint: 'Use C, C++17, Python, Java, Rust or JavaScript.' } });
  const contest = contestId ? store.get('contests', contestId) : (pr.contestId ? store.get('contests', pr.contestId) : null);
  if (contest && (contest.lifecycle === 'archived')) return send(res, 409, { error: { code: 'ARCHIVED', message: 'Contest archived.', hint: 'Upsolve in Playground.' } });
  const manage = canManageProblem(me, pr);
  const visP = pr.visibility || 'visible';
  if (!manage && (visP === 'draft' || visP === 'quarantined')) {
    return send(res, 403, { error: { code: 'HIDDEN', message: 'Problem is not visible yet.', hint: 'Ask a contest admin to publish it.' } });
  }
  if (contest && !manage && contest.lifecycle === 'draft') {
    return send(res, 403, { error: { code: 'CONTEST_DRAFT', message: 'Contest is still being prepared.', hint: 'Registration opens soon.' } });
  }
  if (contest && !manage && contest.startAt && Date.now() < new Date(contest.startAt).getTime()) {
    return send(res, 403, { error: { code: 'NOT_STARTED', message: 'Contest has not started yet.', hint: `Starts ${contest.startAt}.` } });
  }
  const sampleOnly = Boolean(preset.sampleOnly || b.sampleOnly);
  if (sampleOnly && contest && contest.settings && contest.settings.allowSampleRun === false) {
    return send(res, 409, { error: { code: 'SAMPLE_OFF', message: 'Sample runs are disabled for this contest.', hint: 'Test locally or ask the teacher.' } });
  }
  if (contest && !sampleOnly) {
    const policy = defaultDeadlinePolicy(contest);
    if (policy.enabled) {
      const dl = contestDeadlines(contest);
      const at = dl.deadlines[pr.id];
      if (at && isLateAt(at, new Date().toISOString(), policy.graceMin) && policy.lateMode === 'hard') {
        return send(res, 409, { error: { code: 'LATE', message: `Deadline passed (${at}).`, hint: 'Upsolve in Playground or ask teacher for extension.', deadlineAt: at } });
      }
    }
  }
  const nowIso = new Date().toISOString();
  let isLate = false;
  let lateUnits = 0;
  if (contest && !sampleOnly) {
    const policy = defaultDeadlinePolicy(contest);
    if (policy.enabled) {
      const dl = contestDeadlines(contest);
      const at = dl.deadlines[pr.id];
      if (at && isLateAt(at, nowIso, policy.graceMin)) {
        isLate = true;
        lateUnits = lateUnitsBetween(at, nowIso, policy.penaltyKind, policy.graceMin);
      }
    }
  }
  const s = store.insert('submits', {
    contestId: contestId ? Number(contestId) : pr.contestId,
    problemId: Number(problemId), userId: me.id, teamId: b.teamId || null,
    lang, filename, code: String(code), status: 'QUE',
    testsTotal: 0, testsDone: 0, perTest: [], points: 0,
    createdAt: nowIso, judgedAt: null, sampleOnly, isLate, lateUnits,
  });
  const pos = J.queuePosition(null);
  J.QUEUE.push(Number(s.id));
  J.pushEvent(s.id, { submitId: s.id, status: 'QUE', phase: 'QUE', position: J.QUEUE.length });
  audit(me.id, 'submit.create', `submit:${s.id}`, { problemId });
  processQueue();
  return send(res, 201, { ...s, queue: { position: J.QUEUE.length, etaSec: J.QUEUE.length * 4, hint: pos } });
}

function openapi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Satori V2 API', version: '2.0.0' },
    paths: {
      '/api/auth/token': { post: { summary: 'Login, get JWT+refresh' } },
      '/api/contests': { get: { summary: 'List ?role=joined|pending|managed&q&archived' } },
      '/api/contests/{id}/problems': { get: { summary: 'Problem cockpit + inline verdict chips' } },
      '/api/submits': { post: { summary: 'Submit paste|file|gist (multipart|json)' }, get: { summary: 'Results table ?contest&problem&verdict&me&limit' } },
      '/api/submits/{id}/events': { get: { summary: 'SSE live queued→compiling→testing→judged' } },
      '/api/contests/{id}/rankings/live': { get: { summary: 'WS/SSE live scoreboard + freeze' } },
    },
  };
}

const server = http.createServer(handler);
function autoSeedIfEmpty() {
  if (store.all('contests').length > 0) return;
  try {
    require('./seed').main();
    console.log('Auto-seeded demo data (Playground 251519, Rust 8677128, UZI 10193118).');
  } catch (e) {
    console.log(`Seed skipped: ${e.message}`);
  }
}
if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && !process.env.SATORI_JWT_SECRET) {
    console.error('Refusing to start: set SATORI_JWT_SECRET in production.');
    process.exit(1);
  }
  const { DATA_DIR } = require('./lib/store');
  autoSeedIfEmpty();
  server.listen(PORT, () => console.log(`Satori V2 API on http://localhost:${PORT} (DATA_DIR=${DATA_DIR})`));
}
module.exports = { server, handler };
