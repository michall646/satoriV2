// Lane J — announcements gate (F2): schedule visibility, in-app fan-out,
// RSS 2.0 shape, per-user read state, and search coverage.
// Uses tests/helpers.js (dynamic port, isolated DATA_DIR). No hardcoded ports.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, json } = require('./helpers');

let h;
let teacherTok;
let studentTok;
let otherTok;
let contestId;
let nowPostId;
let futurePostId;

const news = (path) => `/api/contests/${contestId}/news${path || ''}`;

before(async () => {
  h = await startServer({ prefix: 'satori-lane-j-' });
  teacherTok = await h.loginAs('g_herman', 'teacher123');
  studentTok = await h.loginAs('jan_kowalski', 'student123');

  const login = `lane_j_other_${Date.now().toString(36)}`;
  const reg = await h.api('/api/auth/register', { method: 'POST', ...json({ login, email: `${login}@uj.edu.pl`, password: 'secret12' }) });
  assert.equal(reg.status, 201, `register other: ${JSON.stringify(reg.body)}`);
  otherTok = await h.loginAs(login, 'secret12');

  const c = await h.createContest(teacherTok, {
    name: 'Lane J & <Contest>',
    mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z',
    endAt: '2030-01-01T00:00:00Z',
  });
  contestId = c.id;

  const added = await h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login: 'jan_kowalski' }) }, teacherTok);
  assert.equal(added.status, 201, JSON.stringify(added.body));
});

after(async () => {
  if (h) await h.close();
});

test('F2: future-scheduled news is hidden from non-admins and shown to admins', async () => {
  const future = await h.api(news(), {
    method: 'POST',
    ...json({ title: 'Future & secret', bodyMd: 'not yet', scheduledAt: new Date(Date.now() + 86400000).toISOString(), inApp: false }),
  }, teacherTok);
  assert.equal(future.status, 201, JSON.stringify(future.body));
  futurePostId = future.body.id;

  const due = await h.api(news(), {
    method: 'POST',
    ...json({ title: 'Now visible', bodyMd: 'Hello **world**, markdown works.', scheduledAt: new Date(Date.now() - 60000).toISOString(), inApp: true }),
  }, teacherTok);
  assert.equal(due.status, 201, JSON.stringify(due.body));
  nowPostId = due.body.id;

  const student = await h.api(news(), {}, studentTok);
  assert.equal(student.status, 200);
  const ids = student.body.items.map((n) => String(n.id));
  assert.ok(ids.includes(String(nowPostId)), 'due post visible to member');
  assert.ok(!ids.includes(String(futurePostId)), 'future post hidden from member');
  assert.equal(student.body.items[0].reads, undefined, 'read receipts map is never exposed');

  const anon = await h.api(news());
  assert.ok(!anon.body.items.some((n) => String(n.id) === String(futurePostId)), 'future post hidden from anon');

  const admin = await h.api(news(), {}, teacherTok);
  assert.ok(admin.body.items.some((n) => String(n.id) === String(futurePostId)), 'admin sees the scheduled post');
  assert.ok(admin.body.items.every((n) => n.reads === undefined), 'admin view also strips raw receipts');
});

test('F2: POST /news fans out in-app notifications to members, skipping the author', async () => {
  const studentNotifs = await h.api('/api/notifications', {}, studentTok);
  const row = studentNotifs.body.items.find((n) => n.type === 'announcement' && String(n.payload && n.payload.newsId) === String(nowPostId));
  assert.ok(row, 'member received the announcement notification');
  assert.equal(String(row.payload.contestId), String(contestId));
  assert.equal(row.payload.title, 'Now visible');
  assert.equal(row.read, false);

  const teacherNotifs = await h.api('/api/notifications', {}, teacherTok);
  assert.ok(!teacherNotifs.body.items.some((n) => n.type === 'announcement'), 'author is skipped');

  const otherNotifs = await h.api('/api/notifications', {}, otherTok);
  assert.ok(!otherNotifs.body.items.some((n) => n.type === 'announcement'), 'non-members are not notified');

  const silent = await h.api(news(), { method: 'POST', ...json({ title: 'Silent post', bodyMd: '', inApp: false }) }, teacherTok);
  assert.equal(silent.status, 201, JSON.stringify(silent.body));
  assert.equal(silent.body.notified, 0, 'inApp:false fans out nothing');
  const afterSilent = await h.api('/api/notifications', {}, studentTok);
  assert.ok(!afterSilent.body.items.some((n) => n.type === 'announcement' && String(n.payload && n.payload.newsId) === String(silent.body.id)));

  const missingTitle = await h.api(news(), { method: 'POST', ...json({ bodyMd: 'x' }) }, teacherTok);
  assert.equal(missingTitle.status, 422);
  const denied = await h.api(news(), { method: 'POST', ...json({ title: 'Nope' }) }, studentTok);
  assert.equal(denied.status, 403);
});

test('F2: GET /news.rss returns a valid RSS 2.0 feed with escaped text', async () => {
  const rss = await h.api(`/api/contests/${contestId}/news.rss`);
  assert.equal(rss.status, 200, rss.text);
  assert.match(rss.headers.get('content-type') || '', /application\/rss\+xml/);
  assert.ok(rss.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(rss.text.includes('<rss version="2.0">'));
  assert.ok(rss.text.includes('</channel>'));
  assert.ok(rss.text.includes('<title>Lane J &amp; &lt;Contest&gt; - Announcements</title>'), 'channel title escaped');
  assert.ok(rss.text.includes('Now visible'), 'due post in feed');
  assert.ok(!rss.text.includes('Future &amp; secret'), 'future post excluded for anon');
  assert.ok(rss.text.includes(`/contests/${contestId}/announcements#announcement-${nowPostId}`), 'item link points at the student page');
  assert.match(rss.text, /<pubDate>[^<]+<\/pubDate>/, 'pubDate present');
  assert.ok(!Number.isNaN(Date.parse((rss.text.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || '')), 'pubDate parses');

  const adminRss = await h.api(`/api/contests/${contestId}/news.rss`, {}, teacherTok);
  assert.ok(adminRss.text.includes('Future &amp; secret'), 'admin feed includes the scheduled post');

  const viaFormat = await h.api(news('?format=rss'));
  assert.match(viaFormat.headers.get('content-type') || '', /application\/rss\+xml/);

  const missing = await h.api('/api/contests/999999/news.rss');
  assert.equal(missing.status, 404);
});

test('F2: read state is per user and survives a reload', async () => {
  const beforeRead = await h.api(news(), {}, studentTok);
  const row = beforeRead.body.items.find((n) => String(n.id) === String(nowPostId));
  assert.equal(row.read, false);

  const anon = await h.api(news(`/${nowPostId}/read`), { method: 'POST', ...json({}) });
  assert.equal(anon.status, 401);

  const nonMember = await h.api(news(`/${nowPostId}/read`), { method: 'POST', ...json({}) }, otherTok);
  assert.equal(nonMember.status, 403);
  assert.equal(nonMember.body.error.code, 'NOT_MEMBER');

  const wrongId = await h.api(news('/999999/read'), { method: 'POST', ...json({}) }, studentTok);
  assert.equal(wrongId.status, 404);

  const hidden = await h.api(news(`/${futurePostId}/read`), { method: 'POST', ...json({}) }, studentTok);
  assert.equal(hidden.status, 404, 'scheduled posts cannot be marked read before they are visible');

  const mark = await h.api(news(`/${nowPostId}/read`), { method: 'POST', ...json({}) }, studentTok);
  assert.equal(mark.status, 200, JSON.stringify(mark.body));
  assert.equal(mark.body.read, true);

  const afterRead = await h.api(news(), {}, studentTok);
  const marked = afterRead.body.items.find((n) => String(n.id) === String(nowPostId));
  assert.equal(marked.read, true, 'read state round-trips through GET /news');
  assert.equal(marked.reads, undefined);

  const teacherView = await h.api(news(), {}, teacherTok);
  const adminRow = teacherView.body.items.find((n) => String(n.id) === String(nowPostId));
  assert.equal(adminRow.readCount, 1, 'admin sees a read count, not identities');

  const stillUnread = await h.api(news(), {}, otherTok);
  const otherRow = stillUnread.body.items.find((n) => String(n.id) === String(nowPostId));
  assert.equal(otherRow.read, false, 'other users keep their own state');
});

test('F2/E8: search includes visible announcements and keeps the existing keys', async () => {
  const hit = await h.api('/api/search?q=visible');
  assert.equal(hit.status, 200);
  assert.deepEqual(Object.keys(hit.body).sort(), ['announcements', 'contests', 'problems', 'users']);
  assert.ok(hit.body.announcements.some((a) => String(a.id) === String(nowPostId)), 'title match found');
  const entry = hit.body.announcements.find((a) => String(a.id) === String(nowPostId));
  assert.equal(String(entry.contestId), String(contestId));

  const byBody = await h.api('/api/search?q=markdown');
  assert.ok(byBody.body.announcements.some((a) => String(a.id) === String(nowPostId)), 'body match found');

  const futureHit = await h.api('/api/search?q=future');
  assert.ok(!futureHit.body.announcements.some((a) => String(a.id) === String(futurePostId)), 'future announcements are not searchable');

  const empty = await h.api('/api/search');
  assert.deepEqual(Object.keys(empty.body).sort(), ['announcements', 'contests', 'problems', 'users']);
  assert.deepEqual(empty.body.announcements, []);
});
