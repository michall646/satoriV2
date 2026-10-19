// Satori V2 — notifications and notes.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid } = require('../lib/authz');

async function handle(req, res, url, p, m) {
  const u = url;
  // notifications / notes / webhooks
  if (p === '/api/notifications' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    return send(res, 200, { items: store.query('notifications', (n) => String(n.userId) === String(me.id)).slice(-50) });
  }
  if (p === '/api/notifications/read' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    const rows = store.all('notifications');
    let read = 0;
    for (const n of rows) {
      if (String(n.userId) !== String(me.id)) continue;
      if (!(b.all || ids.includes(String(n.id)))) continue;
      if (!n.read) { n.read = true; read += 1; }
    }
    store.replaceAll('notifications', rows);
    return send(res, 200, { ok: true, read });
  }
  if (p === '/api/notifications/prefs' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    return send(res, 200, { prefs: me.notificationPrefs || { inApp: true, email: false, webhook: '', watch: '' } });
  }
  if (p === '/api/notifications/prefs' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const prefs = { inApp: true, email: false, webhook: '', watch: '', ...(me.notificationPrefs || {}), ...b };
    delete prefs._raw;
    store.update('users', me.id, { notificationPrefs: prefs });
    return send(res, 200, { ok: true, prefs });
  }
  if (p === '/api/notes' && (m === 'GET' || m === 'POST')) {
    const me = needAuth(req, res);
    if (!me) return true;
    if (m === 'GET') {
      const problem = u.searchParams.get('problem');
      let items = store.query('notes', (n) => String(n.userId) === String(me.id));
      if (problem) items = items.filter((n) => String(n.problemId) === String(problem));
      return send(res, 200, { items });
    }
    const b = await readBody(req);
    return send(res, 201, store.insert('notes', { userId: me.id, problemId: b.problemId ?? b.problem ?? null, teamId: b.teamId || null, text: b.text || '', at: new Date().toISOString() }));
  }
  let mt = p.match(/^\/api\/notes\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const me = needAuth(req, res);
    if (!me) return true;
    const note = store.get('notes', mt[1]);
    if (!note) return send(res, 404, { error: { code: 'NO_NOTE', message: 'Note not found.', hint: '' } });
    const isSuper = (me.rolesGlobal || []).includes('superadmin');
    if (String(note.userId) !== String(me.id) && !isSuper) return forbid(res);
    store.remove('notes', note.id);
    return send(res, 200, { ok: true, deleted: true });
  }
  return false;
}

module.exports = { handle };
