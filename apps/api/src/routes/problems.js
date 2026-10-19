// Satori V2 — problem reads/writes, tests, stats, clone, rejudge, submit.
'use strict';
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const { send, readBody } = require('../lib/http');
const { authUser, needAuth, forbid, audit, canManageProblem, canManageContest, canReadContest, reqLang, localizeRow, submitView } = require('../lib/authz');
const { enrichProblemWithDeadline } = require('../lib/contestAccess');
const { isAccepted } = require('../lib/ranking');
const { fireWebhooks } = require('./webhooks');
const { processQueue } = require('../lib/judgeWorker');
const { createSubmit } = require('../lib/createSubmit');

// A13: test authoring accepts only these fields; problemId/groupId are checked against
// the URL problem so an admin of contest A cannot write into contest B's tests.
const GROUP_FIELDS = ['name', 'points', 'subtask', 'checker', 'timeMs', 'memoryMb', 'order'];
const CASE_FIELDS = ['groupId', 'name', 'input', 'expected', 'checker', 'timeMs', 'memoryMb', 'points', 'subtask'];
function pickFields(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj || {}, f)) out[f] = obj[f];
  return out;
}
function groupMismatch(res) {
  return send(res, 403, { error: { code: 'GROUP_MISMATCH', message: 'Test group does not belong to this problem.', hint: 'Reload the problem tests.' } });
}

async function handle(req, res, url, p, m) {
  const u = url;
  // test group delete
  let mt = p.match(/^\/api\/problems\/(\d+)\/tests\/([^/]+)$/);
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
      const visP = pr.visibility || 'visible';
      if (visP !== 'visible' && !canManageProblem(authUser(req), pr)) return send(res, 403, { error: { code: 'HIDDEN', message: 'Problem is not visible.', hint: 'Ask a contest admin to publish it.' } });
      const contest = pr.contestId ? store.get('contests', pr.contestId) : null;
      if (contest && !canReadContest(contest, authUser(req))) {
        return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      }
      return send(res, 200, contest ? enrichProblemWithDeadline(pr, contest) : pr);
    }
    if (!sub && m === 'PATCH') {
      const me = needAuth(req, res);
      if (!me) return true;
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
      const groups = store.query('testGroups', (g) => String(g.problemId) === String(pr.id));
      const items = groups.map((g) => ({ ...g, cases: store.query('testCases', (c) => String(c.groupId) === String(g.id)) }));
      return send(res, 200, { items });
    }
    if (sub === 'tests' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      if (!canManageProblem(me, pr)) return forbid(res);
      const b = await readBody(req);
      if (b.group) {
        if (b.group.problemId != null && String(b.group.problemId) !== String(pr.id)) return groupMismatch(res);
        return send(res, 201, store.insert('testGroups', { problemId: pr.id, ...pickFields(b.group, GROUP_FIELDS) }));
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
      const targetId = b.contestId || pr.contestId;
      if (String(targetId) !== String(pr.contestId) && !canManageContest(me, store.get('contests', targetId))) return forbid(res);
      const np = store.insert('problems', { ...pr, id: undefined, contestId: targetId, code: b.code || pr.code });
      return send(res, 201, np);
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
    if (sub === 'submit' && m === 'POST') return createSubmit(req, res, { problemId: pr.id, contestId: pr.contestId });
  }
  return false;
}

module.exports = { handle };
