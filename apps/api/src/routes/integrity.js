// Satori V2 — integrity, appeals, and exam controls.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');
const { normalizeExam } = require('../lib/contestAccess');
const { similarityGraph, timelineFlags } = require('../lib/integrity');

async function handle(req, res, url, p, m) {
  const u = url;
  // integrity (jury-only): similarity, timeline flags, appeals
  let mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/(similarity|timeline|appeals)$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
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
    const rows = store.query('appeals', (a) => String(a.contestId) === String(c.id) && a.status === 'open');
    const users = new Map(store.all('users').map((x) => [String(x.id), x.login]));
    return send(res, 200, { items: rows.map((a) => ({ id: a.id, student: users.get(String(a.userId)) || '?', text: a.text || '', at: a.at, status: a.status })) });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/integrity\/appeals\/(\d+)$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
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
    if (!me) return true;
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
    if (!me) return true;
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
  return false;
}

module.exports = { handle };
