// Satori V2 — contest communications: clarifications, news, subpages.
// Extracted from routes/contests.js so security rules (A2/A3) live in one place.
// F2 (Batch 2): scheduled announcements, in-app fan-out, RSS 2.0 feed, read state.
'use strict';
const { store } = require('../lib/store');
const { notifyUser } = require('../lib/notifications');
const { send, sendText, readBody, rateLimited } = require('../lib/http');
const { authUser, needAuth, forbid, audit, contestRole, canManageContest } = require('../lib/authz');
const { isConfigured, isValidEmail, sendMail, webBaseUrl } = require('../lib/mailer');

const NEWS_FIELDS = ['title', 'bodyMd', 'bodyHtml', 'scheduledAt', 'attachments', 'email', 'inApp', 'pinned', 'publishedAt', 'tags'];
const MAX_EMAIL_RECIPIENTS = 200;
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

// ---- F2 announcement helpers ----

// A post with scheduledAt in the future is invisible to non-admins until due.
// Admin views (manage page) still receive it so it can be edited/deleted.
function scheduledInFuture(row, nowMs) {
  if (!row || row.scheduledAt == null || row.scheduledAt === '') return false;
  const t = Date.parse(row.scheduledAt);
  return Number.isFinite(t) && t > (nowMs == null ? Date.now() : nowMs);
}
function newsTime(row) {
  const raw = row && (row.scheduledAt || row.publishedAt || row.createdAt);
  const t = Date.parse(raw || '');
  return Number.isFinite(t) ? t : 0;
}

// One notification per member (members + admins + legacy roles), author skipped.
function announcementRecipients(contest, authorId) {
  const ids = new Set();
  for (const id of (contest.members || [])) ids.add(String(id));
  for (const id of (contest.admins || [])) ids.add(String(id));
  for (const id of Object.keys(contest.roles || {})) ids.add(String(id));
  ids.delete(String(authorId));
  return [...ids];
}
function fanoutAnnouncement(contest, news, authorId) {
  if (!news || news.inApp === false) return 0;
  let notified = 0;
  for (const rawId of announcementRecipients(contest, authorId)) {
    const uid = Number(rawId);
    if (notifyUser(Number.isFinite(uid) ? uid : rawId, 'announcement', { contestId: contest.id, newsId: news.id, title: String(news.title || '') })) notified += 1;
  }
  return notified;
}

// Real e-mail fan-out for POST /news {email:true}. Eligibility is explicit:
// a valid stored address and notificationPrefs.email !== false. The author is
// skipped, recipients are capped, and failures are counted rather than thrown.
// Scheduled posts are not mailed early; that belongs to a future scheduler.
async function emailAnnouncement(contest, news) {
  if (!isConfigured()) return { emailed: 0, emailErrors: 0, emailSkipped: true };
  if (scheduledInFuture(news)) return { emailed: 0, emailErrors: 0, emailSkipped: true };

  const recipients = [];
  for (const rawId of announcementRecipients(contest, news.authorId)) {
    if (recipients.length >= MAX_EMAIL_RECIPIENTS) break;
    const user = store.get('users', rawId);
    if (!user || !isValidEmail(user.email)) continue;
    const prefs = user.notificationPrefs || {};
    if (prefs.email === false) continue;
    recipients.push(user);
  }
  if (recipients.length === 0) return { emailed: 0, emailErrors: 0, emailSkipped: true };

  const title = String(news.title || '').trim();
  const body = String(news.bodyMd || '').trim();
  const link = `${webBaseUrl()}/contests/${contest.id}/announcements#announcement-${news.id}`;
  const subject = `${contest.name ? `${contest.name}: ` : ''}${title}`.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const text = `${title}\n\n${body ? `${body}\n\n` : ''}Read the announcement: ${link}`;
  const html = `<h2>${xmlEscape(title)}</h2>${body ? `<pre style="white-space:pre-wrap">${xmlEscape(body)}</pre>` : ''}<p><a href="${xmlEscape(link)}">Read the announcement</a></p>`;

  const results = await Promise.allSettled(
    recipients.map((user) => sendMail({ to: user.email, subject, text, html }))
  );
  let emailed = 0;
  let emailErrors = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value && result.value.ok && result.value.delivered) emailed += 1;
    else emailErrors += 1;
  }
  return { emailed, emailErrors, emailSkipped: false };
}

// ---- F2 RSS 2.0 ----

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function rssDate(value) {
  const t = Date.parse(value || '');
  return (Number.isFinite(t) ? new Date(t) : new Date()).toUTCString();
}
// Links point at the web app, not the API host. Deployment sets SATORI_WEB_BASE;
// otherwise the caller's Origin/Host is the best available guess.
function webBase(req) {
  const env = String(process.env.SATORI_WEB_BASE || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const origin = String((req.headers && req.headers.origin) || '').trim();
  if (/^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, '');
  const host = String((req.headers && req.headers.host) || '').trim();
  return host ? `http://${host}` : '';
}
function newsRssXml(req, contest, rows) {
  const base = webBase(req);
  const home = `${base}/contests/${contest.id}/announcements`;
  const items = [...rows]
    .sort((a, b) => newsTime(b) - newsTime(a))
    .map((n) => {
      const date = n.scheduledAt || n.publishedAt || n.createdAt;
      return [
        '    <item>',
        `      <title>${xmlEscape(n.title || '(untitled)')}</title>`,
        `      <link>${xmlEscape(`${home}#announcement-${n.id}`)}</link>`,
        `      <description>${xmlEscape(n.bodyMd || n.bodyHtml || '')}</description>`,
        `      <pubDate>${rssDate(date)}</pubDate>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${xmlEscape(`${contest.name || 'Contest'} - Announcements`)}</title>`,
    `    <link>${xmlEscape(home)}</link>`,
    `    <description>${xmlEscape(contest.description || `Announcements for ${contest.name || 'this contest'}`)}</description>`,
    '    <language>en</language>',
  ];
  if (items) lines.push(items);
  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}
function sendNewsRss(req, res, contest) {
  const me = authUser(req);
  const admin = canManageContest(me, contest);
  const now = Date.now();
  const rows = store.query('news', (x) => String(x.contestId) === String(contest.id) && (admin || !scheduledInFuture(x, now)));
  return sendText(res, 200, newsRssXml(req, contest, rows), 'application/rss+xml; charset=utf-8');
}

async function handle(req, res, url, p, m) {
  // F2: RSS feed. contests.js forwards only the exact /news path to this module,
  // so the canonical .rss route is also reachable through routes/meta.js.
  let mt = p.match(/^\/api\/contests\/(\d+)\/news\.rss$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    return sendNewsRss(req, res, c);
  }

  // F2: per-user read state. Stored on the news row as { userId: readAt };
  // never returned raw (GET /news projects a boolean `read` instead).
  mt = p.match(/^\/api\/contests\/(\d+)\/news\/(\d+)\/read$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!isMember(c, me.id)) return notMember(res);
    const row = store.get('news', mt[2]);
    // Scheduled posts stay invisible, so they cannot be marked read either.
    if (!row || String(row.contestId) !== String(c.id) || (!canManageContest(me, c) && scheduledInFuture(row))) {
      return send(res, 404, { error: { code: 'NO_NEWS', message: 'Announcement not found.', hint: 'Reload the announcements list.' } });
    }
    const reads = { ...(row.reads || {}), [String(me.id)]: new Date().toISOString() };
    store.update('news', row.id, { reads });
    return send(res, 200, { ok: true, newsId: row.id, read: true });
  }

  mt = p.match(/^\/api\/contests\/(\d+)\/(clarifications|news|subpages)$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: 'Check /api/contests.' } });
    const act = mt[2];
    const col = act === 'clarifications' ? 'clarifications' : act;
    if (m === 'GET') {
      // RSS is also reachable on the delegated /news path (?format=rss).
      if (act === 'news' && url.searchParams.get('format') === 'rss') return sendNewsRss(req, res, c);
      const me = authUser(req);
      const admin = act === 'news' && canManageContest(me, c);
      const now = Date.now();
      const rows = store.query(col, (x) => String(x.contestId) === String(c.id) && (act !== 'news' || admin || !scheduledInFuture(x, now)));
      const items = rows.map((x) => {
        const out = {
          ...x,
          mine: Boolean(me && String(x.authorId) === String(me.id)),
          answeredByLogin: x.answeredBy ? ((store.get('users', x.answeredBy) || {}).login || null) : null,
        };
        if (act !== 'news') return out;
        // Never leak other users' read receipts; expose only the caller's state.
        const reads = x.reads || {};
        delete out.reads;
        out.read = Boolean(me && reads[String(me.id)]);
        if (admin) out.readCount = Object.keys(reads).length;
        return out;
      });
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
      const notified = fanoutAnnouncement(c, out, me.id);
      // email is an API-only flag; the web UI hides it. Mail is attempted only
      // when asked, and never blocks the response on a sequential per-user loop.
      const emailResult = b.email === true ? await emailAnnouncement(c, out) : null;
      audit(me.id, 'contest.news.create', `contest:${c.id}`, {
        newsId: out.id, notified, ...(emailResult || {}),
      });
      return send(res, 201, { ...out, notified, ...(emailResult || {}) });
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
      notifyUser(row.authorId, 'clarification.answered', { contestId: c.id, clarificationId: row.id });
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
