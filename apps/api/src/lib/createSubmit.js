// Satori V2 — submission creation (validation, access checks, queueing).
'use strict';
const { store } = require('./store');
const { validateFilename, sanitizeFilename, detectLanguage } = require('./validators');
const J = require('../../../../packages/judge/src/judge');
const { send, readBody, submitRate, throttleResponse, clientIp } = require('./http');
const { needAuth, canManageProblem, teamHasMember, audit, contestVisibility, isContestMember } = require('./authz');
const { contestDeadlines, normalizeExam } = require('./contestAccess');
const { resolveContestEnd } = require('./contestTime');
const { defaultDeadlinePolicy, isLateAt, lateUnitsBetween } = require('./ranking');
const { processQueue } = require('./judgeWorker');

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function ipMatchesEntry(ip, entry) {
  const e = String(entry || '').trim();
  if (!e) return false;
  if (e === '*') return true;
  if (e.endsWith('*')) return String(ip).startsWith(e.slice(0, -1));
  if (e.includes('/')) {
    const [base, bitsRaw] = e.split('/');
    const bits = Number(bitsRaw);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(base);
    if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  }
  return String(ip) === e;
}
function ipAllowed(ip, csv) {
  const list = String(csv || '').split(/[\s,;]+/).filter(Boolean);
  if (!list.length) return true;
  return list.some((entry) => ipMatchesEntry(ip, entry));
}
function inTimeWindow(window, date) {
  const m = String(window || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return true;
  const toMin = (h, mm) => Number(h) * 60 + Number(mm);
  const now = date.getHours() * 60 + date.getMinutes();
  const start = toMin(m[1], m[2]);
  const end = toMin(m[3], m[4]);
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end; // overnight window
}

function extensionFor(contest, userId, problemId) {
  if (!contest) return null;
  return store.query('extensions', (e) => String(e.contestId) === String(contest.id)
    && String(e.userId) === String(userId)
    && (e.problemId == null || String(e.problemId) === String(problemId)))
    .sort((a, b) => new Date(b.until).getTime() - new Date(a.until).getTime())[0] || null;
}
function effectiveDeadline(contest, userId, problemId, fallback) {
  const ext = extensionFor(contest, userId, problemId);
  return ext && ext.until ? ext.until : fallback;
}

function allowsAfterEnd(contest) {
  const s = (contest && contest.settings) || {};
  return String((contest && contest.mode) || '').toUpperCase() === 'PLAYGROUND'
    || s.upsolve === true
    || s.allowUpsolve === true
    || contest.upsolve === true;
}

async function createSubmit(req, res, preset) {
  const me = needAuth(req, res);
  if (!me) return true;
  const rl = submitRate(me.id);
  if (rl.limited) return throttleResponse(res, rl, 'Too many submissions.', 'Wait before submitting again.');
  const b = await readBody(req);
  const problemId = preset.problemId || b.problemId;
  const requestedContestId = preset.contestId || b.contestId || null;
  if (!problemId) return send(res, 422, { error: { code: 'PROBLEM', message: 'problemId required.', hint: 'Pick problem row -> Submit.' } });
  const pr = store.get('problems', problemId);
  if (!pr) return send(res, 404, { error: { code: 'NO_PROBLEM', message: 'Problem not found.', hint: '' } });
  // A8: the problem and the requested contest must agree. A client cannot attach a
  // problem to an arbitrary contest id.
  if (requestedContestId != null && String(requestedContestId) !== String(pr.contestId ?? '')) {
    return send(res, 403, { error: { code: 'CONTEST_MISMATCH', message: 'Problem does not belong to that contest.', hint: 'Open the problem from its contest.' } });
  }
  const contestId = requestedContestId != null ? requestedContestId : (pr.contestId ?? null);
  const contest = contestId != null ? store.get('contests', contestId) : null;
  if (contestId != null && !contest) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
  const filename = b.filename || 'solution.cpp';
  const vf = validateFilename(filename);
  if (!vf.ok) return send(res, 422, { ...vf, suggestion: sanitizeFilename(filename) });
  const code = b.code ?? b.source ?? '';
  if (!code || String(code).length > 512 * 1024) return send(res, 422, { error: { code: 'SIZE', message: 'Code empty or >512KB.', hint: 'Paste source or shrink file.' } });
  const lang = detectLanguage(filename, b.lang || b.language);
  if (!J.LANGUAGES.includes(lang)) return send(res, 422, { error: { code: 'LANG_OFF', message: `${lang} submissions are retired in V2.`, hint: 'Use C, C++17, Python, Java, Rust or JavaScript.' } });
  if (contest && contest.lifecycle === 'archived') return send(res, 409, { error: { code: 'ARCHIVED', message: 'Contest archived.', hint: 'Upsolve in Playground.' } });
  const manage = canManageProblem(me, pr);
  // A8: private/exam contests require membership even for reading the problem.
  if (contest && !manage && contestVisibility(contest) !== 'public' && !isContestMember(contest, me.id)) {
    return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
  }
  // F3: exam mode is enforced server-side, not only by the browser guard.
  if (contest && !manage) {
    const exam = normalizeExam(contest);
    const examActive = Boolean(exam.fullscreen || exam.pasteBlock || exam.shuffle || exam.ipAllow || exam.timeWindow);
    if (examActive && exam.ipAllow && !ipAllowed(clientIp(req), exam.ipAllow)) {
      return send(res, 403, { error: { code: 'EXAM_IP', message: 'Submissions are restricted to the exam room network.', hint: 'Connect from the exam room or ask the jury.' } });
    }
    if (examActive && exam.timeWindow && !inTimeWindow(exam.timeWindow, new Date())) {
      return send(res, 403, { error: { code: 'EXAM_WINDOW', message: 'Submissions are outside the exam time window.', hint: `Allowed: ${exam.timeWindow}.` } });
    }
  }
  const visP = pr.visibility || 'visible';
  if (!manage && ['draft', 'hidden', 'quarantined'].includes(visP)) {
    return send(res, 403, { error: { code: 'HIDDEN', message: 'Problem is not visible yet.', hint: 'Ask a contest admin to publish it.' } });
  }
  if (contest && !manage && contest.lifecycle === 'draft') {
    return send(res, 403, { error: { code: 'CONTEST_DRAFT', message: 'Contest is still being prepared.', hint: 'Registration opens soon.' } });
  }
  if (contest && !manage && contest.startAt && Date.now() < new Date(contest.startAt).getTime()) {
    return send(res, 403, { error: { code: 'NOT_STARTED', message: 'Contest has not started yet.', hint: `Starts ${contest.startAt}.` } });
  }
  const sampleOnly = Boolean(preset.sampleOnly || b.sampleOnly);
  // C7: real submissions need real tests. The judge worker also fails closed,
  // but the API should reject with a clear fix hint before queueing.
  if (!sampleOnly && process.env.SATORI_DEMO_TRIGGERS !== '1' && pr.demoFixture !== true) {
    const groups = store.query('testGroups', (g) => String(g.problemId) === String(pr.id));
    const hasCases = groups.some((g) => store.query('testCases', (c) => String(c.groupId) === String(g.id)).length > 0);
    if (!hasCases) {
      return send(res, 409, { error: { code: 'NO_TESTS', message: 'This problem has no test cases.', hint: 'Add at least one test case in the problem editor, then submit.' } });
    }
  }
  // A8: endAt blocks real submissions; sample runs and upsolve/playground do not.
  const contestEnd = contest ? resolveContestEnd(contest) : null;
  if (contest && !manage && !sampleOnly && contestEnd && Date.now() > new Date(contestEnd).getTime() && !allowsAfterEnd(contest)) {
    return send(res, 409, { error: { code: 'ENDED', message: 'Contest has ended.', hint: 'Upsolve in Playground or ask the teacher.' } });
  }
  if (sampleOnly && contest && contest.settings && contest.settings.allowSampleRun === false) {
    return send(res, 409, { error: { code: 'SAMPLE_OFF', message: 'Sample runs are disabled for this contest.', hint: 'Test locally or ask the teacher.' } });
  }
  // A8: teamId must exist, belong to this contest, and include the caller.
  const rawTeamId = b.teamId ?? null;
  const teamId = rawTeamId === null || rawTeamId === '' ? null : rawTeamId;
  if (teamId != null) {
    const team = store.get('teams', teamId);
    if (!team) return send(res, 403, { error: { code: 'TEAM_NOT_FOUND', message: 'Team not found.', hint: 'Pick one of your teams.' } });
    if (!contest || String(team.contestId ?? '') !== String(contest.id)) {
      return send(res, 403, { error: { code: 'TEAM_CONTEST', message: 'Team does not belong to this contest.', hint: 'Pick one of your teams in this contest.' } });
    }
    if (!teamHasMember(team, me.id)) {
      return send(res, 403, { error: { code: 'TEAM_MEMBERSHIP', message: 'You are not a member of that team.', hint: 'Ask the team captain to add you.' } });
    }
  }
  if (contest && !sampleOnly) {
    const policy = defaultDeadlinePolicy(contest);
    if (policy.enabled) {
      const dl = contestDeadlines(contest);
      const at = effectiveDeadline(contest, me.id, pr.id, dl.deadlines[pr.id]);
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
      const at = effectiveDeadline(contest, me.id, pr.id, dl.deadlines[pr.id]);
      if (at && isLateAt(at, nowIso, policy.graceMin)) {
        isLate = true;
        lateUnits = lateUnitsBetween(at, nowIso, policy.penaltyKind, policy.graceMin);
      }
    }
  }
  const s = store.insert('submits', {
    contestId: contest ? contest.id : (contestId != null ? Number(contestId) : (pr.contestId ?? null)),
    problemId: Number(problemId), userId: me.id, teamId,
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
