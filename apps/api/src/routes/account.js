// Satori V2 — notifications and notes.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid } = require('../lib/authz');

const PREF_BOOLEANS = ['inApp', 'email'];
const PREF_STRINGS = ['watch', 'webhook'];

function prefsError(res, field, message) {
  const hints = {
    inApp: 'Send true or false.',
    email: 'Send true or false.',
    watch: 'Send a comma-separated string of problem IDs.',
    webhook: 'Send a URL string.',
  };
  return send(res, 422, {
    error: {
      code: 'PREFS',
      message,
      hint: hints[field] || 'Send a JSON object with inApp, email and watch.',
      ...(field ? { field } : {}),
    },
  });
}

// Merge only the documented preference keys. Unknown body keys (including raw
// JSON fallbacks) never reach the stored user row.
function mergePrefs(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: null, message: 'Preferences must be an object.' };
  if (body._raw !== undefined) return { ok: false, field: null, message: 'Preferences body must be valid JSON.' };
  const prefs = { inApp: true, email: false, webhook: '', watch: '', ...(current || {}) };
  for (const field of PREF_BOOLEANS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') return { ok: false, field, message: `${field} must be a boolean.` };
    prefs[field] = body[field];
  }
  for (const field of PREF_STRINGS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') return { ok: false, field, message: `${field} must be a string.` };
    prefs[field] = body[field].slice(0, 2000);
  }
  return { ok: true, prefs };
}

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
  if (p === '/api/notifications/prefs' && (m === 'POST' || m === 'PATCH')) {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const merged = mergePrefs(b, me.notificationPrefs);
    if (!merged.ok) return prefsError(res, merged.field, merged.message);
    store.update('users', me.id, { notificationPrefs: merged.prefs });
    return send(res, 200, { ok: true, prefs: merged.prefs });
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
