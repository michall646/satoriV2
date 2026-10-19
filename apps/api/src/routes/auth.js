// Satori V2 — authentication, sessions, profile, password reset, and TOTP 2FA routes.
'use strict';
const crypto = require('node:crypto');
const { store } = require('../lib/store');
const { hashPassword, verifyPassword, needsRehash, signJwt, verifyJwt, sha256 } = require('../lib/crypto');
const { generateSecret, verifyTotp, otpauthUrl } = require('../lib/totp');
const { validateLogin, validateEmail } = require('../lib/validators');
const { send, readBody, noteLoginFail, loginBlocked, clearLoginFails, registerRate, throttleResponse } = require('../lib/http');
const { needAuth, tokenClaims, audit } = require('../lib/authz');
const { mySessions, myTeams } = require('../lib/contestAccess');

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TFA_MAX_FAILS = Number(process.env.SATORI_2FA_MAX_FAILS || 5);
const TFA_WINDOW_MS = Number(process.env.SATORI_2FA_WINDOW_MS || 60 * 1000);
const TFA_FAILS = new Map();

function nowIso() { return new Date().toISOString(); }

function publicUser(user) {
  const out = { ...user };
  delete out.pass;
  delete out.totpSecret;
  out.totpEnabled = Boolean(user.totpEnabledAt);
  return out;
}

function issueTokens(user, device) {
  const jti = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  store.insert('sessions', { jti, userId: user.id, device, revoked: false, at: nowIso() });
  const token = signJwt({ sub: user.id, login: user.login, jti }, 3600 * 12);
  const refresh = signJwt({ sub: user.id, jti, refresh: true }, 3600 * 24 * 14);
  return { token, refresh, expiresIn: 43200, tokenType: 'Bearer' };
}

function findUserByLoginOrEmail(value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return null;
  return store.query('users', (u) => String(u.login || '').toLowerCase() === needle || String(u.email || '').toLowerCase() === needle)[0] || null;
}

// A new reset request invalidates every earlier live token for the same account.
function invalidateResets(userId, atIso) {
  const rows = store.all('passwordResets');
  let changed = false;
  for (const row of rows) {
    if (String(row.userId) !== String(userId) || row.usedAt || row.invalidatedAt) continue;
    row.invalidatedAt = atIso;
    changed = true;
  }
  if (changed) store.replaceAll('passwordResets', rows);
}

function issueResetToken(userId) {
  const now = Date.now();
  const raw = crypto.randomBytes(32).toString('hex');
  invalidateResets(userId, new Date(now).toISOString());
  store.insert('passwordResets', {
    userId,
    tokenHash: sha256(raw),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RESET_TTL_MS).toISOString(),
    usedAt: null,
    invalidatedAt: null,
  });
  return raw;
}

function findResetToken(raw) {
  return store.query('passwordResets', (row) => row.tokenHash === sha256(raw))[0] || null;
}

// Only the latest 2FA challenge is live; an earlier one cannot be replayed.
function invalidateChallenges(userId, atIso) {
  const rows = store.all('twoFactorChallenges');
  let changed = false;
  for (const row of rows) {
    if (String(row.userId) !== String(userId) || row.usedAt || row.invalidatedAt) continue;
    row.invalidatedAt = atIso;
    changed = true;
  }
  if (changed) store.replaceAll('twoFactorChallenges', rows);
}

function twoFactorFailState(userId) {
  const key = String(userId);
  const now = Date.now();
  const hits = (TFA_FAILS.get(key) || []).filter((at) => now - at < TFA_WINDOW_MS);
  if (hits.length) TFA_FAILS.set(key, hits); else TFA_FAILS.delete(key);
  const retryAfterSec = hits.length ? Math.max(1, Math.ceil((TFA_WINDOW_MS - (now - hits[0])) / 1000)) : 0;
  return { limited: hits.length >= TFA_MAX_FAILS, retryAfterSec };
}

function noteTwoFactorFail(userId) {
  const key = String(userId);
  const now = Date.now();
  const hits = (TFA_FAILS.get(key) || []).filter((at) => now - at < TFA_WINDOW_MS);
  hits.push(now);
  TFA_FAILS.set(key, hits);
}

function clearTwoFactorFails(userId) { TFA_FAILS.delete(String(userId)); }

async function handle(req, res, url, p, m) {
  const u = url;
  // auth
  if (p === '/api/auth/register' && m === 'POST') {
    const limited = registerRate(req);
    if (limited.limited) return throttleResponse(res, limited, 'Too many registrations.', 'Try again later.');
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
    // Password was correct, but an enabled authenticator replaces the token pair with
    // a short-lived, single-use challenge; /api/auth/2fa/verify completes the login.
    if (user.totpEnabledAt) {
      const now = Date.now();
      const challenge = crypto.randomBytes(32).toString('hex');
      invalidateChallenges(user.id, new Date(now).toISOString());
      store.insert('twoFactorChallenges', {
        userId: user.id,
        challengeHash: sha256(challenge),
        device: b.device || 'cli',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
        usedAt: null,
        invalidatedAt: null,
      });
      audit(user.id, 'auth.2fa.challenge', `user:${user.id}`, {});
      return send(res, 200, { twoFactorRequired: true, challenge, expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000) });
    }
    return send(res, 200, issueTokens(user, b.device || 'cli'));
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
  // Password reset: the request is deliberately indistinguishable for known and
  // unknown accounts. A real mail transport is a handoff; dev mode returns the
  // token so the flow is testable without pretending an e-mail was sent.
  if (p === '/api/auth/forgot' && m === 'POST') {
    const b = await readBody(req);
    const user = findUserByLoginOrEmail(b.login || b.email);
    if (!user) return send(res, 200, { ok: true });
    const raw = issueResetToken(user.id);
    audit(user.id, 'auth.password.reset.request', `user:${user.id}`, {});
    if (process.env.SATORI_DEV_RESET_TOKEN === '1') return send(res, 200, { ok: true, devToken: raw, expiresIn: Math.floor(RESET_TTL_MS / 1000) });
    console.error(`[auth] password reset token for ${user.login}: ${raw} (valid 30 min)`);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    const b = await readBody(req);
    const raw = String(b.token || '').trim();
    if (!raw) return send(res, 401, { error: { code: 'BAD_RESET', message: 'Reset token is required.', hint: 'Open the link from your reset e-mail.' } });
    const row = findResetToken(raw);
    if (!row) return send(res, 401, { error: { code: 'BAD_RESET', message: 'Reset token is invalid.', hint: 'Request a new reset link.' } });
    if (row.usedAt) return send(res, 401, { error: { code: 'RESET_USED', message: 'Reset token was already used.', hint: 'Request a new reset link.' } });
    if (row.invalidatedAt) return send(res, 401, { error: { code: 'RESET_USED', message: 'Reset token is no longer valid.', hint: 'Request a new reset link.' } });
    const expiresAt = Date.parse(row.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return send(res, 401, { error: { code: 'RESET_EXPIRED', message: 'Reset token expired.', hint: 'Request a new reset link.' } });
    const user = store.get('users', row.userId);
    if (!user) return send(res, 401, { error: { code: 'BAD_RESET', message: 'Reset token is invalid.', hint: 'Request a new reset link.' } });
    // Same policy as register and /api/me/password: at least 6 characters.
    const password = String(b.password || '');
    if (password.length < 6) return send(res, 422, { error: { code: 'PASS', message: 'Password min 6 chars.', hint: 'Use 6+ chars.', field: 'password' } });
    store.update('users', user.id, { pass: hashPassword(password) });
    const at = nowIso();
    const tokens = store.all('passwordResets');
    for (const t of tokens) {
      if (String(t.userId) !== String(user.id) || t.usedAt) continue;
      if (String(t.id) === String(row.id)) t.usedAt = at;
      else if (!t.invalidatedAt) t.invalidatedAt = at;
    }
    store.replaceAll('passwordResets', tokens);
    invalidateChallenges(user.id, at);
    const sessions = store.all('sessions');
    let revokedSessions = 0;
    for (const s of sessions) {
      if (String(s.userId) !== String(user.id) || s.revoked) continue;
      s.revoked = true;
      revokedSessions += 1;
    }
    store.replaceAll('sessions', sessions);
    audit(user.id, 'auth.password.reset', `user:${user.id}`, { revokedSessions });
    return send(res, 200, { ok: true, revokedSessions });
  }
  if (p === '/api/auth/2fa/setup' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    if (me.totpEnabledAt) return send(res, 409, { error: { code: '2FA_ENABLED', message: 'Two-factor authentication is already enabled.', hint: 'Disable it before setting up another authenticator.' } });
    const secret = generateSecret();
    store.update('users', me.id, { totpSecret: secret });
    audit(me.id, 'auth.2fa.setup', `user:${me.id}`, {});
    return send(res, 200, { secret, otpauthUrl: otpauthUrl({ secret, account: me.login, issuer: process.env.SATORI_TOTP_ISSUER || 'Satori V2' }) });
  }
  if (p === '/api/auth/2fa/enable' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    if (me.totpEnabledAt) return send(res, 409, { error: { code: '2FA_ENABLED', message: 'Two-factor authentication is already enabled.', hint: 'Disable it first.' } });
    if (!me.totpSecret) return send(res, 409, { error: { code: '2FA_SETUP', message: 'No authenticator secret yet.', hint: 'Call /api/auth/2fa/setup first.' } });
    const b = await readBody(req);
    if (!verifyTotp(me.totpSecret, b.code)) return send(res, 401, { error: { code: 'BAD_TOTP', message: 'Invalid two-factor code.', hint: 'Use the current 6-digit code from your authenticator app.' } });
    const enabledAt = nowIso();
    store.update('users', me.id, { totpEnabledAt: enabledAt });
    clearTwoFactorFails(me.id);
    audit(me.id, 'auth.2fa.enable', `user:${me.id}`, {});
    return send(res, 200, { enabled: true });
  }
  if (p === '/api/auth/2fa/disable' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    if (!verifyPassword(b.password || '', me.pass)) return send(res, 403, { error: { code: 'BAD_PASSWORD', message: 'Current password is wrong.', hint: 'Try again.' } });
    if (!me.totpEnabledAt) return send(res, 409, { error: { code: '2FA_NOT_ENABLED', message: 'Two-factor authentication is not enabled.', hint: 'Nothing to disable.' } });
    if (!verifyTotp(me.totpSecret, b.code)) return send(res, 401, { error: { code: 'BAD_TOTP', message: 'Invalid two-factor code.', hint: 'Use the current 6-digit code from your authenticator app.' } });
    store.update('users', me.id, { totpSecret: null, totpEnabledAt: null });
    clearTwoFactorFails(me.id);
    audit(me.id, 'auth.2fa.disable', `user:${me.id}`, {});
    return send(res, 200, { enabled: false });
  }
  if (p === '/api/auth/2fa/verify' && m === 'POST') {
    const b = await readBody(req);
    const raw = String(b.challenge || '').trim();
    if (!raw) return send(res, 401, { error: { code: 'BAD_CHALLENGE', message: 'Two-factor challenge is required.', hint: 'Sign in again.' } });
    const row = store.query('twoFactorChallenges', (x) => x.challengeHash === sha256(raw))[0];
    if (!row) return send(res, 401, { error: { code: 'BAD_CHALLENGE', message: 'Two-factor challenge is invalid.', hint: 'Sign in again.' } });
    if (row.usedAt) return send(res, 401, { error: { code: 'CHALLENGE_USED', message: 'Two-factor challenge was already used.', hint: 'Sign in again.' } });
    if (row.invalidatedAt) return send(res, 401, { error: { code: 'CHALLENGE_USED', message: 'Two-factor challenge is no longer valid.', hint: 'Sign in again.' } });
    const expiresAt = Date.parse(row.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return send(res, 401, { error: { code: 'CHALLENGE_EXPIRED', message: 'Two-factor challenge expired.', hint: 'Sign in again.' } });
    const user = store.get('users', row.userId);
    if (!user || !user.totpEnabledAt) return send(res, 401, { error: { code: 'BAD_CHALLENGE', message: 'Two-factor challenge is invalid.', hint: 'Sign in again.' } });
    const fails = twoFactorFailState(user.id);
    if (fails.limited) {
      return send(res, 429, {
        error: { code: 'THROTTLE', message: 'Too many failed two-factor codes.', hint: `Wait ${fails.retryAfterSec}s, then sign in again.`, retryAfterSec: fails.retryAfterSec },
      }, { 'Retry-After': String(fails.retryAfterSec) });
    }
    if (!verifyTotp(user.totpSecret, b.code)) {
      noteTwoFactorFail(user.id);
      return send(res, 401, { error: { code: 'BAD_TOTP', message: 'Invalid two-factor code.', hint: 'Use the current 6-digit code from your authenticator app.' } });
    }
    clearTwoFactorFails(user.id);
    store.update('twoFactorChallenges', row.id, { usedAt: nowIso() });
    audit(user.id, 'auth.2fa.verify', `user:${user.id}`, {});
    return send(res, 200, issueTokens(user, b.device || row.device || 'web'));
  }
  if (p === '/api/me' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    const pub = publicUser(me);
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
    return send(res, 200, publicUser(out));
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
