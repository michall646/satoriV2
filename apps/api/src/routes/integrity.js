// Satori V2 — integrity, appeals, and exam controls.
'use strict';
const { store } = require('../lib/store');
const { notifyUser } = require('../lib/notifications');
const { send, readBody, clientIp, violationRate, throttleResponse } = require('../lib/http');
const { needAuth, forbid, canManageContest, contestRole, audit } = require('../lib/authz');
const { normalizeExam } = require('../lib/contestAccess');
const { similarityGraph, timelineFlags } = require('../lib/integrity');
const { getAvailableTools, runPlagiarismCheck } = require('../lib/plagiarism');

const MEMBER_ROLES = new Set(['participant', 'contest_admin', 'superadmin']);

function isMember(contest, me) {
  return MEMBER_ROLES.has(contestRole(contest, me.id));
}

// EXAM contests (mode/visibility) are guarded even when every browser flag is off.
// A contest with any settings.exam key is treated as exam-mode too, so enabling a
// single lock in Manage → Integrity turns the client guard on.
function examActive(contest) {
  if (!contest) return false;
  if (String(contest.mode || '').toUpperCase() === 'EXAM') return true;
  if (String(contest.visibility || '').toLowerCase() === 'exam') return true;
  const exam = contest.settings && contest.settings.exam;
  return Boolean(exam && typeof exam === 'object' && Object.keys(exam).length);
}

function adminUserIds(contest) {
  const ids = new Set((contest.admins || []).map(String));
  for (const [id, role] of Object.entries(contest.roles || {})) {
    if (role === 'teacher' || role === 'jury') ids.add(String(id));
  }
  return [...ids];
}

function notify(contest, type, payload, exceptUserId) {
  const at = new Date().toISOString();
  for (const id of adminUserIds(contest)) {
    if (exceptUserId != null && String(id) === String(exceptUserId)) continue;
    notifyUser(id, type, payload);
  }
}

function noContest(res) {
  return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
}
function notMember(res) {
  return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
}

function publicViolation(v, users) {
  return {
    id: v.id,
    who: users.get(String(v.userId)) || '?',
    userId: v.userId,
    type: v.type,
    detail: v.detail || '',
    at: v.at,
    ip: v.ip || null,
  };
}

// F5: appeals are append-only student records. A student may appeal their own
// judged submission only; the jury resolves it through the existing admin route.
function publicAppeal(a) {
  return {
    id: a.id,
    submitId: a.submitId ?? null,
    text: a.text || '',
    status: a.status || 'open',
    verdict: a.verdict ?? null,
    at: a.at,
    resolvedAt: a.resolvedAt ?? null,
  };
}

async function handle(req, res, url, p, m) {
  const u = url;

  // ---- F6: student appeals (member) ----
  let mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/appeals\/mine$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!isMember(c, me)) return notMember(res);
    const items = store.query('appeals', (a) => String(a.contestId) === String(c.id) && String(a.userId) === String(me.id))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .map(publicAppeal);
    return send(res, 200, { items, count: items.length });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/appeals$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!isMember(c, me)) return notMember(res);
    const b = await readBody(req);
    const submitId = b.submitId;
    const text = String(b.text != null ? b.text : '').trim();
    if (submitId == null || submitId === '') {
      return send(res, 422, { error: { code: 'SUBMIT', message: 'Submission is required.', hint: 'Open a failed submission and appeal from there.' } });
    }
    if (!text) {
      return send(res, 422, { error: { code: 'TEXT', message: 'Appeal text is required.', hint: 'Explain what the jury should re-check.' } });
    }
    const submit = store.get('submits', submitId);
    if (!submit || String(submit.contestId) !== String(c.id)) {
      return send(res, 404, { error: { code: 'NO_SUBMIT', message: 'Submission not found in this contest.', hint: 'Appeal from your own result page.' } });
    }
    if (String(submit.userId) !== String(me.id)) {
      return send(res, 403, { error: { code: 'NOT_OWNER', message: 'You can appeal only your own submission.', hint: 'Ask the submit owner to appeal.' } });
    }
    const appealable = submit.status !== 'OK' || submit.flagged === true || submit.integrityFlag === true;
    if (!appealable) {
      return send(res, 422, { error: { code: 'NOT_APPEALABLE', message: 'Only failed or flagged submissions can be appealed.', hint: 'Appeals are for verdicts and integrity flags.' } });
    }
    const existing = store.query('appeals', (a) => String(a.contestId) === String(c.id)
      && String(a.userId) === String(me.id)
      && String(a.submitId) === String(submit.id)
      && (a.status || 'open') === 'open')[0];
    if (existing) {
      return send(res, 409, { error: { code: 'APPEAL_EXISTS', message: 'An open appeal already exists for this submission.', hint: 'Wait for the jury to resolve it.' } });
    }
    const at = new Date().toISOString();
    const row = store.insert('appeals', {
      contestId: c.id,
      userId: me.id,
      submitId: submit.id,
      text: text.slice(0, 4000),
      status: 'open',
      at,
    });
    notify(c, 'appeal.created', { contestId: c.id, appealId: row.id, submitId: submit.id, userId: me.id }, me.id);
    audit(me.id, 'contest.appeal.create', `contest:${c.id}`, { appealId: row.id, submitId: submit.id });
    return send(res, 201, { ok: true, ...publicAppeal(row) });
  }

  // ---- jury integrity views: similarity, timeline, open appeals, external check ----
  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/external-tools$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    return send(res, 200, { tools: getAvailableTools() });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/external-check$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const result = await runPlagiarismCheck(c.id, b.problemId, b);
    audit(me.id, 'contest.integrity.external_check', `contest:${c.id}`, { problemId: b.problemId, tool: result.tool, matchCount: result.matchCount });
    return send(res, 200, { ok: true, result });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/(similarity|timeline|appeals)$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
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
    const rows = store.query('appeals', (a) => String(a.contestId) === String(c.id) && (a.status || 'open') === 'open');
    const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
    return send(res, 200, {
      items: rows.map((a) => ({
        id: a.id,
        student: users.get(String(a.userId)) || '?',
        userId: a.userId,
        submitId: a.submitId ?? null,
        text: a.text || '',
        at: a.at,
        status: a.status || 'open',
      })),
    });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/appeals\/(\d+)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const row = store.get('appeals', mt[2]);
    if (!row || String(row.contestId) !== String(c.id)) {
      return send(res, 404, { error: { code: 'NO_APPEAL', message: 'Appeal not found.', hint: '' } });
    }
    const b = await readBody(req);
    const verdict = String(b.verdict || 'resolved');
    const updated = store.update('appeals', row.id, { status: 'resolved', verdict, resolvedBy: me.id, resolvedAt: new Date().toISOString() });
    store.insert('notifications', {
      userId: row.userId,
      type: 'appeal.resolved',
      payload: { contestId: c.id, appealId: row.id, submitId: row.submitId ?? null, verdict },
      read: false,
      at: new Date().toISOString(),
    });
    audit(me.id, 'contest.appeal.resolve', `contest:${c.id}`, { appealId: row.id, verdict });
    return send(res, 200, { ok: true, verdict, item: publicAppeal(updated) });
  }

  // ---- exam controls: canonical settings.exam { fullscreen, pasteBlock, shuffle, ipAllow, timeWindow } ----
  mt = p.match(/^\/api\/contests\/(\d+)\/exam$/);
  if (mt && (m === 'GET' || m === 'PATCH')) {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!isMember(c, me)) return forbid(res);
    if (m === 'GET') return send(res, 200, { settings: normalizeExam(c), exam: examActive(c), endAt: c.endAt ?? null });
    if (!canManageContest(me, c)) return forbid(res);
    const b = await readBody(req);
    const next = normalizeExam(c, b.settings || b);
    const updated = store.update('contests', c.id, { settings: { ...(c.settings || {}), exam: next } });
    audit(me.id, 'contest.exam.update', `contest:${c.id}`, next);
    return send(res, 200, { ok: true, settings: next, exam: examActive(updated) });
  }

  // ---- F5: exam violations ----
  mt = p.match(/^\/api\/contests\/(\d+)\/exam\/violations$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return noContest(res);
    const me = needAuth(req, res);
    if (!me) return true;
    if (!isMember(c, me)) return forbid(res);
    if (m === 'POST') {
      if (!examActive(c)) {
        return send(res, 422, { error: { code: 'NOT_EXAM', message: 'This contest is not in exam mode.', hint: 'Ask the jury to enable exam controls.' } });
      }
      const limited = violationRate(c.id, me.id);
      if (limited.limited) return throttleResponse(res, limited, 'Too many violation reports.', 'Browser events are throttled.');
      const b = await readBody(req);
      const type = String(b.type || 'unknown').slice(0, 40);
      const detail = String(b.detail || '').slice(0, 500);
      const row = store.insert('violations', {
        contestId: c.id,
        userId: me.id,
        type,
        detail,
        ip: clientIp(req),
        at: new Date().toISOString(),
      });
      return send(res, 201, { ok: true, id: row.id });
    }
    if (!canManageContest(me, c)) return forbid(res);
    const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
    const items = store.query('violations', (v) => String(v.contestId) === String(c.id))
      .map((v) => publicViolation(v, users))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return send(res, 200, { items, count: items.length });
  }
  return false;
}

module.exports = { handle, examActive };
