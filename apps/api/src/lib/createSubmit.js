// Satori V2 — submission creation (validation, access checks, queueing).
'use strict';
const { store } = require('./store');
const { validateFilename, sanitizeFilename, detectLanguage } = require('./validators');
const J = require('../../../../packages/judge/src/judge');
const { send, readBody } = require('./http');
const { needAuth, canManageProblem, audit } = require('./authz');
const { contestDeadlines } = require('./contestAccess');
const { defaultDeadlinePolicy, isLateAt, lateUnitsBetween } = require('./ranking');
const { processQueue } = require('./judgeWorker');

async function createSubmit(req, res, preset) {
  const me = needAuth(req, res);
  if (!me) return true;
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

module.exports = { createSubmit };
