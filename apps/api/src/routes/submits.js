// Satori V2 — submission creation, listing, SSE events, and rejudge.
'use strict';
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const { send } = require('../lib/http');
const {
  authUser, needAuth, forbid, canManageProblem, boardModeOf, canManageContest, canReadContest,
  submitVisibleOnBoard, teamHasMember, reqLang, localizeRow, submitView,
} = require('../lib/authz');
const { zipStore } = require('../lib/zip');
const { fireWebhooks } = require('./webhooks');
const { processQueue } = require('../lib/judgeWorker');
const { createSubmit } = require('../lib/createSubmit');

function boardHiddenReject(res) {
  return send(res, 403, { error: { code: 'BOARD_HIDDEN', message: 'The scoreboard is hidden during this contest.', hint: 'It becomes visible after the contest.' } });
}
function meOnlyReject(res, me) {
  if (!me) return send(res, 401, { error: { code: 'AUTH', message: 'Login required to view this board.', hint: 'POST /api/auth/token.' } });
  return send(res, 403, { error: { code: 'BOARD_ME_ONLY', message: 'This board is private to each contestant.', hint: 'Open your own results.' } });
}
function boardGate(res, contest, me) {
  if (!contest || boardModeOf(contest) !== 'hidden') return false;
  if (canManageContest(me, contest)) return false;
  return boardHiddenReject(res);
}
function isSubmitOwner(s, me) {
  if (!me) return false;
  if (String(s.userId) === String(me.id)) return true;
  const team = s.teamId ? store.get('teams', s.teamId) : null;
  return Boolean(team) && teamHasMember(team, me.id);
}
// Individual results stay visible to their owner; only the board/list is hidden.
function canViewIndividual(s, contest, me) {
  if (!contest) return true;
  if (canManageContest(me, contest)) return true;
  if (boardModeOf(contest) === 'everyone') return true;
  return isSubmitOwner(s, me);
}
function individualReject(res, contest, me) {
  return boardModeOf(contest) === 'hidden' ? boardHiddenReject(res) : meOnlyReject(res, me);
}

async function handle(req, res, url, p, m) {
  const u = url;
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
    const prob = problem ? store.get('problems', problem) : null;
    const scopeContest = contest
      ? store.get('contests', contest)
      : (prob && prob.contestId != null ? store.get('contests', prob.contestId) : null);
    // D4: submissions of a non-public contest are contest content.
    if (scopeContest && !canReadContest(scopeContest, me)) {
      return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
    }
    if (scopeContest && boardGate(res, scopeContest, me)) return true;
    let items = store.all('submits').sort((a, b) => Number(b.id) - Number(a.id));
    if (contest) items = items.filter((s) => String(s.contestId) === String(contest));
    if (problem) items = items.filter((s) => String(s.problemId) === String(problem));
    if (verdict) items = items.filter((s) => s.status === verdict);
    if (team) items = items.filter((s) => String(s.teamId) === String(team));
    if (mine && me) items = items.filter((s) => String(s.userId) === String(me.id));
    // A10: hidden/me-only applies to every row, including the unfiltered list.
    if (scopeContest && boardModeOf(scopeContest) === 'me-only' && !canManageContest(me, scopeContest)) {
      if (!me) return meOnlyReject(res, me);
      items = items.filter((s) => String(s.userId) === String(me.id));
    }
    if (!scopeContest) {
      items = items.filter((s) => {
        const c = s.contestId != null ? store.get('contests', s.contestId) : null;
        if (c && !canReadContest(c, me)) return false;
        return submitVisibleOnBoard(c, me, s);
      });
    }
    const total = items.length;
    // code + full per-test data: owner/jury only, per verdict visibility
    const lang = reqLang(req, u);
    items = items.slice(offset, offset + limit).map((s) => localizeRow(submitView(s, me), lang));
    return send(res, 200, { items, total, limit, offset });
  }
  if (p === '/api/submits/codes.zip' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
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
    res.end(zip);
    return true;
  }
  let mt = p.match(/^\/api\/submits\/(\d+)(\/(events|rejudge))?$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const s = store.get('submits', mt[1]);
    if (!s) return send(res, 404, { error: { code: 'NO_SUBMIT', message: 'Submit not found.', hint: '' } });
    const sContest = s.contestId != null ? store.get('contests', s.contestId) : null;
    if (mt[3] === 'events' && m === 'GET') {
      const me = authUser(req);
      if (sContest && !canReadContest(sContest, me)) {
        return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      }
      if (!canViewIndividual(s, sContest, me)) return individualReject(res, sContest, me);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify({ submitId: s.id, status: s.status })}\n\n`);
      J.subscribe(s.id, res);
      req.on('close', () => J.unsubscribe(s.id, res));
      return true;
    }
    if (mt[3] === 'rejudge' && m === 'POST') {
      const me = needAuth(req, res);
      if (!me) return true;
      const pr = store.get('problems', s.problemId);
      if (!canManageProblem(me, pr)) return forbid(res);
      // A9: clear stale judge output so the next view cannot show the old verdict.
      store.update('submits', s.id, { status: 'QUE', testsDone: 0, judgedAt: null, perTest: [], perTestFull: null, compileLog: '', points: 0 });
      J.QUEUE.push(Number(s.id));
      processQueue()
        .then(() => fireWebhooks('rejudge.done', { submitId: s.id, contestId: s.contestId || null, problemId: s.problemId }))
        .catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (!mt[3] && m === 'GET') {
      const me = authUser(req);
      if (sContest && !canReadContest(sContest, me)) {
        return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
      }
      if (!canViewIndividual(s, sContest, me)) return individualReject(res, sContest, me);
      return send(res, 200, localizeRow(submitView(s, me), reqLang(req, u)));
    }
  }
  return false;
}

module.exports = { handle };
