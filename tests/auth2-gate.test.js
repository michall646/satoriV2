// Batch 3 / G5 — TOTP 2FA + password reset gate tests.
// Unit vectors are pure; API tests use the shared harness with an isolated DATA_DIR.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer } = require('./helpers');
const { sha256 } = require('../apps/api/src/lib/crypto');
const {
  base32Encode, base32Decode, totp, verifyTotp, generateSecret, otpauthUrl,
} = require('../apps/api/src/lib/totp');

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'utf8'));

let h;
const state = {};

before(async () => {
  delete process.env.SATORI_DEV_RESET_TOKEN;
  h = await startServer();
});

after(async () => {
  await h.close();
});

function badCode(secret) {
  const at = Date.now();
  const valid = new Set([totp(secret, at - 30000), totp(secret, at), totp(secret, at + 30000)]);
  for (let i = 0; i < 10; i += 1) {
    const candidate = String(i).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
  return '999999';
}

async function login(loginName, password) {
  return h.api('/api/auth/token', { method: 'POST', ...h.json({ login: loginName, password }) });
}

async function registerUser(prefix) {
  const login = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`.slice(0, 24);
  const email = `${login}@uj.edu.pl`;
  const password = 'initial123';
  const r = await h.api('/api/auth/register', { method: 'POST', ...h.json({ login, email, password }) });
  assert.equal(r.status, 201, `register failed: ${JSON.stringify(r.body)}`);
  return { login, email, password };
}

async function forgot(payload) {
  return h.api('/api/auth/forgot', { method: 'POST', ...h.json(payload) });
}

async function reset(token, password) {
  return h.api('/api/auth/reset', { method: 'POST', ...h.json({ token, password }) });
}

async function verifyChallenge(challenge, code) {
  return h.api('/api/auth/2fa/verify', { method: 'POST', ...h.json({ challenge, code }) });
}

// ---- TOTP unit vectors ----

test('base32 encodes/decodes RFC 4648 bytes and tolerates case/padding', () => {
  const bytes = Buffer.from('12345678901234567890', 'utf8');
  const encoded = base32Encode(bytes);
  assert.equal(encoded, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode(encoded), bytes);
  assert.deepEqual(base32Decode(`${encoded.toLowerCase()}====`), bytes);
  assert.throws(() => base32Decode('0189'), /Invalid base32/);
  assert.throws(() => base32Decode(''), /Empty base32/);
});

test('totp matches RFC 6238 SHA-1 vectors (6-digit truncation)', () => {
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [at, expected] of vectors) {
    assert.equal(totp(RFC_SECRET, at * 1000), expected, `vector at ${at}`);
  }
});

test('verifyTotp accepts ±1 step and rejects malformed or out-of-window codes', () => {
  const at = 1111111111 * 1000;
  const good = totp(RFC_SECRET, at);
  assert.equal(verifyTotp(RFC_SECRET, good, at), true);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 30000), at), true);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 30000), at), true);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 60000), at), false);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 60000), at), false);
  assert.equal(verifyTotp(RFC_SECRET, '12345', at), false);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', at), false);
  assert.equal(verifyTotp(RFC_SECRET, '', at), false);
  assert.equal(verifyTotp('NOT-BASE32', good, at), false);
  assert.equal(verifyTotp(RFC_SECRET, good, NaN), false);
});

test('generateSecret returns 160-bit base32 and otpauthUrl is standards-shaped', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.equal(base32Decode(secret).length, 20);
  const url = otpauthUrl({ secret, account: 'jan_kowalski', issuer: 'Satori V2' });
  assert.ok(url.startsWith('otpauth://totp/'));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('secret'), secret);
  assert.equal(parsed.searchParams.get('issuer'), 'Satori V2');
  assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
  assert.equal(parsed.searchParams.get('digits'), '6');
  assert.equal(parsed.searchParams.get('period'), '30');
  assert.match(parsed.pathname, /jan_kowalski/);
});

// ---- 2FA API ----

test('2FA setup requires a session and does not enable the account', async () => {
  const anon = await h.api('/api/auth/2fa/setup', { method: 'POST', ...h.json({}) });
  assert.equal(anon.status, 401);

  state.janToken = await h.loginAs('jan_kowalski', 'student123');
  const beforeMe = await h.api('/api/me', {}, state.janToken);
  assert.equal(beforeMe.status, 200);
  assert.equal(beforeMe.body.totpSecret, undefined);
  assert.equal(beforeMe.body.totpEnabled, false);

  const setup = await h.api('/api/auth/2fa/setup', { method: 'POST', ...h.json({}) }, state.janToken);
  assert.equal(setup.status, 200);
  assert.match(setup.body.secret, /^[A-Z2-7]+$/);
  assert.ok(setup.body.otpauthUrl.startsWith('otpauth://totp/'));
  assert.ok(setup.body.otpauthUrl.includes(`secret=${setup.body.secret}`));
  state.secret = setup.body.secret;

  const after = await h.api('/api/me', {}, state.janToken);
  assert.equal(after.body.totpEnabled, false, 'setup alone must not enable 2FA');
  assert.equal(after.body.totpSecret, undefined, 'the secret is never returned by /api/me');
});

test('2FA enable rejects a wrong code and enables with a current code', async () => {
  const wrong = await h.api('/api/auth/2fa/enable', { method: 'POST', ...h.json({ code: badCode(state.secret) }) }, state.janToken);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'BAD_TOTP');

  const ok = await h.api('/api/auth/2fa/enable', { method: 'POST', ...h.json({ code: totp(state.secret, Date.now()) }) }, state.janToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.enabled, true);

  const me = await h.api('/api/me', {}, state.janToken);
  assert.equal(me.body.totpEnabled, true);
  assert.equal(me.body.totpSecret, undefined);

  const again = await h.api('/api/auth/2fa/setup', { method: 'POST', ...h.json({}) }, state.janToken);
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, '2FA_ENABLED');
});

test('2FA login returns a challenge; verify issues tokens and cannot be replayed', async () => {
  const first = await login('jan_kowalski', 'student123');
  assert.equal(first.status, 200);
  assert.equal(first.body.twoFactorRequired, true);
  assert.ok(first.body.challenge);
  assert.equal(first.body.token, undefined);
  assert.equal(first.body.refresh, undefined);

  const wrong = await verifyChallenge(first.body.challenge, badCode(state.secret));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'BAD_TOTP');

  const ok = await verifyChallenge(first.body.challenge, totp(state.secret, Date.now()));
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.ok(ok.body.refresh);

  const me = await h.api('/api/me', {}, ok.body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.totpEnabled, true);

  const replay = await verifyChallenge(first.body.challenge, totp(state.secret, Date.now()));
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'CHALLENGE_USED');
});

test('2FA challenge expires after five minutes', async () => {
  const first = await login('jan_kowalski', 'student123');
  assert.equal(first.status, 200);
  assert.equal(first.body.twoFactorRequired, true);

  const user = h.store.query('users', (u) => u.login === 'jan_kowalski')[0];
  const rows = h.store.query('twoFactorChallenges', (r) => String(r.userId) === String(user.id) && !r.usedAt && !r.invalidatedAt);
  const row = rows[rows.length - 1];
  assert.ok(row, 'a live challenge exists');
  h.store.update('twoFactorChallenges', row.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

  const expired = await verifyChallenge(first.body.challenge, totp(state.secret, Date.now()));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'CHALLENGE_EXPIRED');
});

test('failed 2FA codes are rate-limited per user', async () => {
  const user = await registerUser('tfa');
  const token = await h.loginAs(user.login, user.password);
  const setup = await h.api('/api/auth/2fa/setup', { method: 'POST', ...h.json({}) }, token);
  assert.equal(setup.status, 200);
  const enabled = await h.api('/api/auth/2fa/enable', { method: 'POST', ...h.json({ code: totp(setup.body.secret, Date.now()) }) }, token);
  assert.equal(enabled.status, 200);

  const first = await login(user.login, user.password);
  assert.equal(first.body.twoFactorRequired, true);
  for (let i = 0; i < 5; i += 1) {
    const r = await verifyChallenge(first.body.challenge, badCode(setup.body.secret));
    assert.equal(r.status, 401, `attempt ${i + 1} is a normal reject`);
  }
  const sixth = await verifyChallenge(first.body.challenge, badCode(setup.body.secret));
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error.code, 'THROTTLE');
  const validWhileBlocked = await verifyChallenge(first.body.challenge, totp(setup.body.secret, Date.now()));
  assert.equal(validWhileBlocked.status, 429);
});

test('anonymous callers cannot set up, enable, or disable 2FA', async () => {
  for (const path of ['/api/auth/2fa/setup', '/api/auth/2fa/enable', '/api/auth/2fa/disable']) {
    const r = await h.api(path, { method: 'POST', ...h.json({}) });
    assert.equal(r.status, 401, `${path} requires a session`);
  }
});

test('2FA rejects enabling without setup and disabling when not enabled', async () => {
  const user = await registerUser('plain');
  const token = await h.loginAs(user.login, user.password);

  const early = await h.api('/api/auth/2fa/enable', { method: 'POST', ...h.json({ code: '123456' }) }, token);
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, '2FA_SETUP');

  const disabled = await h.api('/api/auth/2fa/disable', { method: 'POST', ...h.json({ password: user.password, code: '123456' }) }, token);
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.error.code, '2FA_NOT_ENABLED');

  const missing = await h.api('/api/auth/2fa/verify', { method: 'POST', ...h.json({}) });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'BAD_CHALLENGE');

  const bogus = await h.api('/api/auth/2fa/verify', { method: 'POST', ...h.json({ challenge: 'not-a-challenge', code: '123456' }) });
  assert.equal(bogus.status, 401);
  assert.equal(bogus.body.error.code, 'BAD_CHALLENGE');
});

test('2FA disable requires password and code and restores password-only login', async () => {
  const badPassword = await h.api('/api/auth/2fa/disable', { method: 'POST', ...h.json({ password: 'wrong-pass', code: totp(state.secret, Date.now()) }) }, state.janToken);
  assert.equal(badPassword.status, 403);

  const badOtp = await h.api('/api/auth/2fa/disable', { method: 'POST', ...h.json({ password: 'student123', code: badCode(state.secret) }) }, state.janToken);
  assert.equal(badOtp.status, 401);
  assert.equal(badOtp.body.error.code, 'BAD_TOTP');

  const ok = await h.api('/api/auth/2fa/disable', { method: 'POST', ...h.json({ password: 'student123', code: totp(state.secret, Date.now()) }) }, state.janToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.enabled, false);

  const plain = await login('jan_kowalski', 'student123');
  assert.equal(plain.status, 200);
  assert.ok(plain.body.token, 'password-only login works again');
  assert.equal(plain.body.twoFactorRequired, undefined);

  const me = await h.api('/api/me', {}, plain.body.token);
  assert.equal(me.body.totpEnabled, false);
});

// ---- Password reset ----

test('forgot is generic for unknown accounts and logs instead of exposing a token by default', async () => {
  delete process.env.SATORI_DEV_RESET_TOKEN;

  const unknown = await forgot({ login: 'does_not_exist' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { ok: true });

  const user = await registerUser('rst');
  state.resetUser = user;

  const logs = [];
  const original = console.error;
  console.error = (...args) => { logs.push(args.map(String).join(' ')); };
  let known;
  try {
    known = await forgot({ login: user.login });
  } finally {
    console.error = original;
  }
  assert.equal(known.status, 200);
  assert.equal(known.body.ok, true);
  assert.equal(known.body.devToken, undefined, 'no token in the HTTP response without dev mode');
  assert.ok(logs.some((line) => line.includes('password reset token') && line.includes(user.login)), 'token is written to stderr');
});

test('dev mode returns a token, invalidates older tokens, and still hides unknown accounts', async () => {
  process.env.SATORI_DEV_RESET_TOKEN = '1';
  try {
    const unknown = await forgot({ login: 'nobody_here' });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, { ok: true }, 'dev mode must not reveal whether an account exists');

    const first = await forgot({ email: state.resetUser.email });
    const second = await forgot({ login: state.resetUser.login });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.ok(first.body.devToken);
    assert.ok(second.body.devToken);
    assert.notEqual(first.body.devToken, second.body.devToken);

    const oldToken = await reset(first.body.devToken, 'newpass123');
    assert.equal(oldToken.status, 401);
    assert.equal(oldToken.body.error.code, 'RESET_USED');

    state.resetToken = second.body.devToken;
  } finally {
    delete process.env.SATORI_DEV_RESET_TOKEN;
  }
});

test('reset rejects weak passwords without consuming the token, then changes password and revokes sessions', async () => {
  const user = state.resetUser;
  const oldSession = await h.loginAs(user.login, user.password);

  const weak = await reset(state.resetToken, '123');
  assert.equal(weak.status, 422);
  assert.equal(weak.body.error.code, 'PASS');

  const ok = await reset(state.resetToken, 'newpass123');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.ok(ok.body.revokedSessions >= 1, 'all sessions for the account are revoked');

  const revoked = await h.api('/api/me', {}, oldSession);
  assert.equal(revoked.status, 401, 'a pre-reset session no longer authenticates');

  const oldPassword = await login(user.login, user.password);
  assert.equal(oldPassword.status, 401);
  const newPassword = await login(user.login, 'newpass123');
  assert.equal(newPassword.status, 200);
  assert.ok(newPassword.body.token);

  const replay = await reset(state.resetToken, 'another123');
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'RESET_USED');

  state.resetUser.password = 'newpass123';
});

test('reset rejects missing, unknown, and expired tokens', async () => {
  const missing = await h.api('/api/auth/reset', { method: 'POST', ...h.json({ password: 'whatever123' }) });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'BAD_RESET');

  const unknown = await reset('deadbeef', 'whatever123');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error.code, 'BAD_RESET');

  process.env.SATORI_DEV_RESET_TOKEN = '1';
  let issued;
  try {
    issued = await forgot({ login: state.resetUser.login });
  } finally {
    delete process.env.SATORI_DEV_RESET_TOKEN;
  }
  assert.ok(issued.body.devToken);

  const row = h.store.query('passwordResets', (r) => r.tokenHash === sha256(issued.body.devToken))[0];
  assert.ok(row, 'reset row is stored hashed');
  h.store.update('passwordResets', row.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

  const expired = await reset(issued.body.devToken, 'newpass456');
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'RESET_EXPIRED');
});
