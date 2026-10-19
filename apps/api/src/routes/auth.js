// Satori V2 — authentication, sessions, profile, and password routes.
'use strict';
const { store } = require('../lib/store');
const { hashPassword, verifyPassword, needsRehash, signJwt, verifyJwt } = require('../lib/crypto');
const { validateLogin, validateEmail } = require('../lib/validators');
const { send, readBody, noteLoginFail, loginBlocked, clearLoginFails } = require('../lib/http');
const { needAuth, tokenClaims, audit } = require('../lib/authz');
const { mySessions, myTeams } = require('../lib/contestAccess');

async function handle(req, res, url, p, m) {
  const u = url;
  // auth
  if (p === '/api/auth/register' && m === 'POST') {
    const b = await readBody(req);
    const vl = validateLogin(b.login);
    if (!vl.ok) return send(res, 422, vl);
    const ve = validateEmail(b.email);
    if (!ve.ok) return send(res, 422, ve);
    if (!b.password || String(b.password).length < 6) return send(res, 422, { error: { code: 'PASS', message: 'Password min 6 chars.', hint: 'Use 6+ chars.' } });
    if (store.query('users', (x) => x.login === b.login)[0]) return send(res, 409, { error: { code: 'TAKEN', message: 'Login taken.', hint: 'Pick another login.' } });
    const user = store.insert('users', { login: b.login, firstName: b.firstName || '', lastName: b.lastName || '', email: b.email, pass: hashPassword(b.password), affiliationOrgId: b.affiliationOrgId || null, rolesGlobal: ['student'], accessCode: b.accessCode || '', createdAt: new Date().toISOString() });
    audit(user.id, 'auth.register', `user:${user.id}`, {});
    return send(res, 201, { id: user.id, login: user.login });
  }
  if (p === '/api/auth/token' && m === 'POST') {
    const b = await readBody(req);
    const tkey = `${b.login || ''}|${(req.socket && req.socket.remoteAddress) || 'x'}`;
    if (loginBlocked(tkey)) return send(res, 429, { error: { code: 'THROTTLE', message: 'Too many failed logins.', hint: 'Wait 15 minutes, then retry.' } });
    const user = store.query('users', (x) => x.login === b.login)[0];
    if (!user) { noteLoginFail(tkey); return send(res, 401, { error: { code: 'BAD_CRED', message: 'Bad login/password.', hint: 'Check login, or register.' } }); }
    if (!verifyPassword(b.password, user.pass)) { noteLoginFail(tkey); return send(res, 401, { error: { code: 'BAD_CRED', message: 'Bad login/password.', hint: 'Check password.' } }); }
    clearLoginFails(tkey);
    if (needsRehash(user.pass)) store.update('users', user.id, { pass: hashPassword(b.password) });
    const jti = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const device = b.device || 'cli';
    store.insert('sessions', { jti, userId: user.id, device, revoked: false, at: new Date().toISOString() });
    const token = signJwt({ sub: user.id, login: user.login, jti }, 3600 * 12);
    const refresh = signJwt({ sub: user.id, jti, refresh: true }, 3600 * 24 * 14);
    return send(res, 200, { token, refresh, expiresIn: 43200, tokenType: 'Bearer' });
  }
  if (p === '/api/auth/refresh' && m === 'POST') {
    const b = await readBody(req);
    const v = verifyJwt(b.refresh || '');
    if (!v || !v.refresh) return send(res, 401, { error: { code: 'BAD_REFRESH', message: 'Bad refresh token.', hint: 'Login again.' } });
    const sess = store.query('sessions', (s) => s.jti === v.jti && !s.revoked)[0];
    if (!sess) return send(res, 401, { error: { code: 'REVOKED', message: 'Session revoked.', hint: 'Login again.' } });
    const user = store.get('users', v.sub);
    if (!user) return send(res, 401, { error: { code: 'NO_USER', message: 'User gone.', hint: 'Register again.' } });
    const token = signJwt({ sub: user.id, login: user.login, jti: v.jti }, 3600 * 12);
    return send(res, 200, { token, expiresIn: 43200 });
  }
  if (p === '/api/auth/revoke' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const rows = store.all('sessions');
    for (const s of rows) if (s.userId === me.id && (!b.jti || s.jti === b.jti)) s.revoked = true;
    store.replaceAll('sessions', rows);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    const { pass, ...pub } = me;
    const claims = tokenClaims(req);
    pub.sessions = mySessions(me, claims && claims.jti);
    pub.teams = myTeams(me.id);
    return send(res, 200, pub);
  }
  if (p === '/api/me' && m === 'PATCH') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const patch = {};
    if (b.firstName != null) patch.firstName = b.firstName;
    if (b.lastName != null) patch.lastName = b.lastName;
    if (b.email != null) patch.email = b.email;
    if (b.affiliationOrgId !== undefined) patch.affiliationOrgId = b.affiliationOrgId;
    const out = store.update('users', me.id, patch);
    const { pass, ...pub } = out;
    return send(res, 200, pub);
  }
  if (p === '/api/me/sessions' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    const claims = tokenClaims(req);
    return send(res, 200, { items: mySessions(me, claims && claims.jti) });
  }
  const ms = p.match(/^\/api\/me\/sessions\/([A-Za-z0-9_.-]+)$/);
  if (ms && m === 'DELETE') {
    const me = needAuth(req, res);
    if (!me) return true;
    const claims = tokenClaims(req);
    const row = store.query('sessions', (s) => s.jti === ms[1] && String(s.userId) === String(me.id))[0];
    if (!row) return send(res, 404, { error: { code: 'NO_SESSION', message: 'Session not found.', hint: '' } });
    store.update('sessions', row.id, { revoked: true, revokedAt: new Date().toISOString() });
    audit(me.id, 'session.revoke', `session:${row.id}`, { device: row.device || null });
    return send(res, 200, { ok: true, current: Boolean(claims && claims.jti === row.jti) });
  }
  if (p === '/api/me/teams' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    return send(res, 200, { items: myTeams(me.id) });
  }
  if (p === '/api/me/password' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    if (!verifyPassword(b.old || '', me.pass)) return send(res, 403, { error: { code: 'BAD_OLD_PASS', message: 'Current password is wrong.', hint: 'Try again.' } });
    const np = String(b.new || '');
    if (np.length < 6) return send(res, 422, { error: { code: 'PASS', message: 'New password min 6 chars.', hint: 'Use 6+ chars.' } });
    store.update('users', me.id, { pass: hashPassword(np) });
    const claims = tokenClaims(req);
    let revokedOthers = 0;
    const rows = store.all('sessions');
    for (const s of rows) {
      if (String(s.userId) !== String(me.id) || s.revoked) continue;
      if (claims && s.jti === claims.jti) continue;
      s.revoked = true;
      revokedOthers += 1;
    }
    store.replaceAll('sessions', rows);
    audit(me.id, 'user.password.change', `user:${me.id}`, { revokedOthers });
    return send(res, 200, { ok: true, revokedOthers });
  }
  return false;
}

module.exports = { handle };
