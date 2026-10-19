// Satori V2 — contest communications: clarifications, news, subpages.
// Extracted from routes/contests.js so security rules (A2/A3) live in one place.
'use strict';
const { store } = require('../lib/store');
const { send, readBody, rateLimited } = require('../lib/http');
const { authUser, needAuth, forbid, audit, contestRole, canManageContest } = require('../lib/authz');

const NEWS_FIELDS = ['title', 'bodyMd', 'bodyHtml', 'scheduledAt', 'attachments', 'email', 'inApp', 'pinned', 'publishedAt', 'tags'];
const SUBPAGE_FIELDS = ['title', 'bodyMd', 'bodyHtml', 'attachments', 'order', 'slug', 'published', 'tags'];
function pickFields(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj || {}, f)) out[f] = obj[f];
  return out;
}
function isMember(contest, userId) {
  const role = contestRole(contest, userId);
  return role === 'participant' || role === 'contest_admin' || role === 'superadmin';
}
function notMember(res) {
  return send(res, 403, { error: { code: 'NOT_MEMBER', message: 'Contest membership required.', hint: 'Apply to the contest or ask the teacher.' } });
}
function badQuestion(res) {
  return send(res, 422, { error: { code: 'QUESTION', message: 'Question required.', hint: 'Type a question before sending.' } });
}
function badAnswer(res) {
  return send(res, 422, { error: { code: 'ANSWER', message: 'Answer required.', hint: 'Type the jury answer before saving.' } });
}
function badTitle(res) {
  return send(res, 422, { error: { code: 'TITLE', message: 'Title required.', hint: 'Add a title before publishing.' } });
}

async function handle(req, res, url, p, m) {
  let mt = p.match(/^\/api\/contests\/(\d+)\/(clarifications|news|subpages)$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    const act = mt[2];
    const col = act === 'clarifications' ? 'clarifications' : act;
    if (m === 'GET') {
      const me = authUser(req);
      const rows = store.query(col, (x) => String(x.contestId) === String(c.id));
      const items = rows.map((x) => ({
        ...x,
        mine: Boolean(me && String(x.authorId) === String(me.id)),
        answeredByLogin: x.answeredBy ? ((store.get('users', x.answeredBy) || {}).login || null) : null,
      }));
      const canAnswer = act === 'clarifications' && Boolean(me && canManageContest(me, c));
      return send(res, 200, { items, canAnswer });
    }
    const me = needAuth(req, res);
    if (!me) return true;
    if (act === 'clarifications' && !isMember(c, me.id)) return notMember(res);
    if (act !== 'clarifications' && !canManageContest(me, c)) return forbid(res);
    if (rateLimited(`${act}:${me.id}`, act === 'clarifications' ? 5 : 20, 60000)) {
      return send(res, 429, { error: { code: 'THROTTLE', message: 'Too many posts.', hint: 'Slow down and retry in a minute.', retryAfterSec: 60 } });
    }
    const b = await readBody(req);
    if (act === 'clarifications') {
      // A2: only these two fields are accepted. authorId/contestId/answer in the
      // body are ignored; the server owns them.
      const question = String(b.question != null ? b.question : (b.text || '')).trim();
      if (!question) return badQuestion(res);
      const row = { contestId: c.id, authorId: me.id, question: question.slice(0, 4000), createdAt: new Date().toISOString() };
      if (b.problem != null && b.problem !== '') {
        const pr = store.get('problems', b.problem);
        if (!pr || String(pr.contestId) !== String(c.id)) {
          return send(res, 422, { error: { code: 'PROBLEM', message: 'Problem does not belong to this contest.', hint: 'Pick a problem from this contest.' } });
        }
        row.problem = pr.id;
      }
      const out = store.insert('clarifications', row);
      audit(me.id, 'clarification.create', `contest:${c.id}`, { clarificationId: out.id });
      return send(res, 201, out);
    }
    if (act === 'news') {
      const row = pickFields(b, NEWS_FIELDS);
      if (!String(row.title || '').trim()) return badTitle(res);
      const out = store.insert('news', { ...row, contestId: c.id, authorId: me.id, createdAt: new Date().toISOString() });
      audit(me.id, 'contest.news.create', `contest:${c.id}`, { newsId: out.id });
      return send(res, 201, out);
    }
    const row = pickFields(b, SUBPAGE_FIELDS);
    if (!String(row.title || '').trim()) return badTitle(res);
    const out = store.insert('subpages', { ...row, contestId: c.id, authorId: me.id, createdAt: new Date().toISOString() });
    audit(me.id, 'contest.subpage.create', `contest:${c.id}`, { subpageId: out.id });
    return send(res, 201, out);
  }

  // A2: jury answers a clarification through a dedicated admin route.
  mt = p.match(/^\/api\/contests\/(\d+)\/clarifications\/(\d+)\/answer$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const row = store.get('clarifications', mt[2]);
    if (!row || String(row.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_CLARIFICATION', message: 'Clarification not found.', hint: '' } });
    const b = await readBody(req);
    const answer = String(b.answer != null ? b.answer : '').trim();
    if (!answer) return badAnswer(res);
    const out = store.update('clarifications', row.id, {
      answer: answer.slice(0, 8000), answeredBy: me.id, answeredAt: new Date().toISOString(),
    });
    if (String(row.authorId) !== String(me.id)) {
      store.insert('notifications', {
        userId: row.authorId, type: 'clarification.answered',
        payload: { contestId: c.id, clarificationId: row.id }, read: false, at: new Date().toISOString(),
      });
    }
    audit(me.id, 'clarification.answer', `contest:${c.id}`, { clarificationId: row.id });
    return send(res, 200, out);
  }

  // Deletes for news (old path preserved), subpages, and clarifications (admin only).
  mt = p.match(/^\/api\/contests\/(\d+)\/(clarifications|news|subpages)\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const col = mt[2] === 'clarifications' ? 'clarifications' : mt[2];
    const row = store.get(col, mt[3]);
    if (!row || String(row.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Item not found.', hint: '' } });
    store.remove(col, row.id);
    audit(me.id, `contest.${mt[2]}.delete`, `contest:${c.id}`, { id: row.id });
    return send(res, 200, { ok: true, deleted: true });
  }
  return false;
}

module.exports = { handle };
