// Satori V2 — problem reads/writes, tests, stats, clone, rejudge, submit.
'use strict';
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const { send, readBody } = require('../lib/http');
const { authUser, needAuth, forbid, audit, canManageProblem, canManageContest, canReadContest, reqLang, localizeRow, submitView, teamHasMember } = require('../lib/authz');
const { enrichProblemWithDeadline } = require('../lib/contestAccess');
const { isAccepted } = require('../lib/ranking');
const { fireWebhooks } = require('./webhooks');
const { processQueue } = require('../lib/judgeWorker');
const { createSubmit } = require('../lib/createSubmit');

// A13: test authoring accepts only these fields; problemId/groupId are checked against
// the URL problem so an admin of contest A cannot write into contest B's tests.
const GROUP_FIELDS = ['name', 'points', 'subtask', 'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile', 'timeMs', 'memoryMb', 'order'];
const CASE_FIELDS = ['groupId', 'name', 'input', 'expected', 'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile', 'timeMs', 'memoryMb', 'points', 'subtask'];
// C10: PATCH is whitelisted — a client cannot overwrite contestId, setterId or version.
const PROBLEM_PATCH_FIELDS = [
  'name', 'code', 'tags', 'difficulty', 'deadlineAt', 'setId', 'weight',
  'statementMd', 'statementMdEn', 'statementHtml', 'samples', 'limits',
  'visibility', 'aliasLetters', 'quarantineReason',
  'checker', 'checkerLang', 'checkerCode', 'checkerTolerance', 'checkerFile',
];
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
