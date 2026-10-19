// Batch 4 / Lane R — real e-mail transport gate.
// Unit provider checks plus forgot/reset, announcement e-mail and prefs API.
// Uses tests/helpers.js (dynamic API port, isolated DATA_DIR) and a local
// dynamic webhook receiver; no external network and no hardcoded ports.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, json } = require('./helpers');
const mailer = require('../apps/api/src/lib/mailer');

let h;
let mailServer;
let mailPort;
let webhookUrl;

const mails = [];
const savedEnv = {};

function readMailEnv() {
  for (const key of [
    'SATORI_MAIL_PROVIDER', 'SATORI_MAIL_WEBHOOK', 'SATORI_MAIL_FROM',
    'SATORI_MAIL_API_KEY', 'SATORI_MAIL_ALLOW_CONSOLE', 'SATORI_MAIL_CONSOLE',
    'SATORI_WEB_BASE_URL', 'SATORI_DEV_RESET_TOKEN',
  ]) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function useWebhook() {
  process.env.SATORI_MAIL_PROVIDER = 'webhook';
  process.env.SATORI_MAIL_WEBHOOK = webhookUrl;
  process.env.SATORI_MAIL_FROM = 'noreply@satori.test';
  delete process.env.SATORI_MAIL_API_KEY;
  delete process.env.SATORI_MAIL_ALLOW_CONSOLE;
  delete process.env.SATORI_MAIL_CONSOLE;
  delete process.env.SATORI_DEV_RESET_TOKEN;
}

function useConsole() {
  process.env.SATORI_MAIL_PROVIDER = 'console';
  delete process.env.SATORI_MAIL_ALLOW_CONSOLE;
  delete process.env.SATORI_MAIL_CONSOLE;
  delete process.env.SATORI_DEV_RESET_TOKEN;
}

async function registerUser(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 100000).toString(36)}`;
  const login = `${prefix}_${suffix}`.slice(0, 24);
  const email = `${login}@uj.edu.pl`;
  const password = 'initial123';
  const r = await h.api('/api/auth/register', { method: 'POST', ...json({ login, email, password }) });
  assert.equal(r.status, 201, `register failed: ${JSON.stringify(r.body)}`);
  return { id: r.body.id, login, email, password };
}

async function addMember(contestId, login, token) {
  const r = await h.api(`/api/contests/${contestId}/members`, { method: 'POST', ...json({ login }) }, token);
  assert.equal(r.status, 201, `add member failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

before(async () => {
  readMailEnv();

  mailServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (req.url === '/fail') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('provider failure');
        return;
      }
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* intentionally malformed */ }
      mails.push({ url: req.url, headers: req.headers, body, raw });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `mail-${mails.length}` }));
    });
  });
  await new Promise((resolve) => mailServer.listen(0, '127.0.0.1', resolve));
  mailPort = mailServer.address().port;
  webhookUrl = `http://127.0.0.1:${mailPort}/mail`;

  useWebhook();
  process.env.SATORI_WEB_BASE_URL = 'https://satori.test';
  h = await startServer({ prefix: 'satori-mailer-gate-' });
});

after(async () => {
  if (h) await h.close();
  if (mailServer) await new Promise((resolve) => mailServer.close(resolve));
  restoreEnv();
});

test('mailer validates recipient/subject, needs config, and console never claims delivery', async () => {
  useConsole();
  assert.equal(mailer.provider(), 'console');
  assert.equal(mailer.isConfigured(), false, 'console is not a real delivery provider');

  const badTo = await mailer.sendMail({ to: 'not-an-email', subject: 'Hi', text: 'x' });
  assert.equal(badTo.ok, false);
  assert.equal(badTo.delivered, false);
  assert.equal(badTo.error, 'BAD_RECIPIENT');

  const badSubject = await mailer.sendMail({ to: 'dest@example.com', subject: 'Hi\r\nBcc: evil@example.com', text: 'x' });
  assert.equal(badSubject.ok, false);
  assert.equal(badSubject.delivered, false);
  assert.equal(badSubject.error, 'BAD_SUBJECT');

  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  let sent;
  try {
    sent = await mailer.sendMail({ to: 'dest@example.com', subject: 'Console probe', text: 'secret body' });
  } finally {
    console.log = originalLog;
  }
  assert.equal(sent.ok, true);
  assert.equal(sent.provider, 'console');
  assert.equal(sent.delivered, false);
  assert.equal(lines.length, 1, 'one envelope line');
  assert.ok(lines[0].includes('dest@example.com'));
  assert.ok(!lines[0].includes('secret body'), 'body is not logged');
});

test('webhook provider posts the envelope to a local endpoint', async () => {
  useWebhook();
  assert.equal(mailer.isConfigured(), true);

  mails.length = 0;
  const result = await mailer.sendMail({
    to: 'dest@example.com', subject: 'Hello', text: 'Plain body', html: '<b>Html body</b>',
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'webhook');
  assert.equal(result.delivered, true);
  assert.ok(result.id);

  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].body, {
    from: 'noreply@satori.test',
    to: 'dest@example.com',
    subject: 'Hello',
    text: 'Plain body',
    html: '<b>Html body</b>',
  });
  assert.match(String(mails[0].headers['content-type'] || ''), /application\/json/);

  delete process.env.SATORI_MAIL_FROM;
  assert.equal(mailer.isConfigured(), false, 'HTTP providers require SATORI_MAIL_FROM');
  const missingFrom = await mailer.sendMail({ to: 'dest@example.com', subject: 'No from', text: 'x' });
  assert.equal(missingFrom.ok, false);
  assert.equal(missingFrom.error, 'NOT_CONFIGURED');
  process.env.SATORI_MAIL_FROM = 'noreply@satori.test';
});

test('webhook non-2xx is an honest failure', async () => {
  useWebhook();
  process.env.SATORI_MAIL_WEBHOOK = `http://127.0.0.1:${mailPort}/fail`;
  try {
    const result = await mailer.sendMail({ to: 'dest@example.com', subject: 'Will fail', text: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.provider, 'webhook');
    assert.equal(result.delivered, false);
    assert.match(String(result.error), /HTTP_500/);
  } finally {
    process.env.SATORI_MAIL_WEBHOOK = webhookUrl;
  }
});

test('forgot e-mails a reset link, stays generic for unknown accounts, and never exposes the token', async () => {
  useWebhook();
  const user = await registerUser('reset');
  mails.length = 0;

  // A dev-token flag must not turn a real transport into a token response.
  process.env.SATORI_DEV_RESET_TOKEN = '1';
  let known;
  try {
    known = await h.api('/api/auth/forgot', { method: 'POST', ...json({ login: user.login }) });
  } finally {
    delete process.env.SATORI_DEV_RESET_TOKEN;
  }
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, { ok: true });
  assert.equal(known.text.includes('devToken'), false);
  assert.equal(mails.length, 1);

  const payload = mails[0].body;
  assert.equal(payload.to, user.email);
  assert.ok(String(payload.subject).toLowerCase().includes('reset'));
  assert.ok(payload.text.includes('30 minutes'));
  assert.ok(payload.text.includes('https://satori.test/reset?token='));
  const token = (payload.text.match(/\/reset\?token=([a-f0-9]+)/) || [])[1];
  assert.ok(token, 'reset link carries the token');
  assert.equal(known.text.includes(token), false, 'token is not in the HTTP response');
  assert.equal(JSON.stringify(known.body).includes(token), false);

  const reset = await h.api('/api/auth/reset', { method: 'POST', ...json({ token, password: 'changed123' }) });
  assert.equal(reset.status, 200);

  mails.length = 0;
  const unknown = await h.api('/api/auth/forgot', { method: 'POST', ...json({ login: 'no_such_account_here' }) });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, { ok: true });
  assert.equal(mails.length, 0, 'unknown accounts send nothing');
});

test('devToken stays gated by SATORI_DEV_RESET_TOKEN and console/not-configured transport', async () => {
  useConsole();
  const user = await registerUser('devtok');
  mails.length = 0;

  const originalError = console.error;
  const errors = [];
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    const noFlag = await h.api('/api/auth/forgot', { method: 'POST', ...json({ login: user.login }) });
    assert.equal(noFlag.status, 200);
    assert.equal(noFlag.body.devToken, undefined);
    assert.ok(errors.some((line) => line.includes('password reset token') && line.includes(user.login)));

    process.env.SATORI_DEV_RESET_TOKEN = '1';
    try {
      const unknown = await h.api('/api/auth/forgot', { method: 'POST', ...json({ login: 'nobody_here' }) });
      assert.deepEqual(unknown.body, { ok: true }, 'dev mode still hides account existence');

      const withFlag = await h.api('/api/auth/forgot', { method: 'POST', ...json({ login: user.login }) });
      assert.equal(withFlag.status, 200);
      assert.ok(withFlag.body.devToken, 'flagged dev mode returns a token');
    } finally {
      delete process.env.SATORI_DEV_RESET_TOKEN;
    }
  } finally {
    console.error = originalError;
  }
  assert.equal(mails.length, 0, 'console transport sends no webhook mail');
});

test('announcement e-mail reaches eligible members, skips author and email:false, leaks no addresses', async () => {
  useWebhook();
  const teacherTok = await h.loginAs('g_herman', 'teacher123');
  const off = await registerUser('moff');
  const on = await registerUser('mon');

  const contest = await h.createContest(teacherTok, {
    name: 'Mail Contest',
    mode: 'ICPC',
    startAt: '2020-01-01T00:00:00Z',
    endAt: '2030-01-01T00:00:00Z',
  });
  await addMember(contest.id, 'jan_kowalski', teacherTok);
  await addMember(contest.id, off.login, teacherTok);
  await addMember(contest.id, on.login, teacherTok);

  const offTok = await h.loginAs(off.login, off.password);
  const savedPrefs = await h.api('/api/notifications/prefs', {
    method: 'PATCH',
    ...json({ email: false }),
  }, offTok);
  assert.equal(savedPrefs.status, 200, JSON.stringify(savedPrefs.body));
  assert.equal(savedPrefs.body.prefs.email, false);

  mails.length = 0;
  const created = await h.api(`/api/contests/${contest.id}/news`, {
    method: 'POST',
    ...json({ title: 'Mail announcement', bodyMd: 'Come to the lab.', email: true }),
  }, teacherTok);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.notified, 3, 'in-app fan-out unchanged');
  assert.equal(created.body.emailed, 2, 'jan + opted-in member');
  assert.equal(created.body.emailErrors, 0);
  assert.equal(created.body.emailSkipped, false);

  const recipients = mails.map((mail) => mail.body.to).sort();
  assert.deepEqual(recipients, ['jan@uj.edu.pl', on.email].sort());
  assert.ok(!recipients.includes('gh@uj.edu.pl'), 'author is skipped');
  assert.ok(!recipients.includes(off.email), 'email:false is skipped');

  const janMail = mails.find((mail) => mail.body.to === 'jan@uj.edu.pl');
  assert.ok(janMail.body.subject.includes('Mail announcement'));
  assert.ok(janMail.body.text.includes('Come to the lab.'));
  assert.ok(janMail.body.text.includes(`/contests/${contest.id}/announcements`), 'text has the announcement link');
  assert.ok(janMail.body.html.includes(`/contests/${contest.id}/announcements`), 'html has the announcement link');

  const serialized = JSON.stringify(created.body);
  for (const address of ['jan@uj.edu.pl', 'gh@uj.edu.pl', off.email, on.email]) {
    assert.equal(serialized.includes(address), false, `response must not leak ${address}`);
  }

  // Honest skip when the transport is not configured: no fake emailed count.
  useConsole();
  mails.length = 0;
  const skipped = await h.api(`/api/contests/${contest.id}/news`, {
    method: 'POST',
    ...json({ title: 'Quiet announcement', bodyMd: 'No transport.', email: true }),
  }, teacherTok);
  assert.equal(skipped.status, 201, JSON.stringify(skipped.body));
  assert.equal(skipped.body.emailSkipped, true);
  assert.equal(skipped.body.emailed, 0);
  assert.equal(skipped.body.emailErrors, 0);
  assert.equal(mails.length, 0);
  useWebhook();
});

test('notification prefs round-trip on the user and reject non-boolean types', async () => {
  const user = await registerUser('prefs');
  const token = await h.loginAs(user.login, user.password);

  const initial = await h.api('/api/notifications/prefs', {}, token);
  assert.equal(initial.status, 200);
  assert.equal(typeof initial.body.prefs.inApp, 'boolean');
  assert.equal(typeof initial.body.prefs.email, 'boolean');
  assert.equal(typeof initial.body.prefs.watch, 'string');

  const patched = await h.api('/api/notifications/prefs', {
    method: 'PATCH',
    ...json({ inApp: false, email: true, watch: '12,34' }),
  }, token);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.prefs.inApp, false);
  assert.equal(patched.body.prefs.email, true);
  assert.equal(patched.body.prefs.watch, '12,34');

  const reread = await h.api('/api/notifications/prefs', {}, token);
  assert.equal(reread.status, 200);
  assert.equal(reread.body.prefs.inApp, false);
  assert.equal(reread.body.prefs.email, true);
  assert.equal(reread.body.prefs.watch, '12,34');

  const stored = h.store.get('users', user.id);
  assert.equal(stored.notificationPrefs.email, true, 'email pref lives on the user record');

  const badEmail = await h.api('/api/notifications/prefs', {
    method: 'POST',
    ...json({ email: 'yes' }),
  }, token);
  assert.equal(badEmail.status, 422);
  assert.equal(badEmail.body.error.code, 'PREFS');
  assert.equal(badEmail.body.error.field, 'email');

  const badInApp = await h.api('/api/notifications/prefs', {
    method: 'PATCH',
    ...json({ inApp: 1 }),
  }, token);
  assert.equal(badInApp.status, 422);
  assert.equal(badInApp.body.error.field, 'inApp');

  const badWatch = await h.api('/api/notifications/prefs', {
    method: 'PATCH',
    ...json({ watch: true }),
  }, token);
  assert.equal(badWatch.status, 422);
  assert.equal(badWatch.body.error.field, 'watch');

  const afterInvalid = await h.api('/api/notifications/prefs', {}, token);
  assert.equal(afterInvalid.body.prefs.email, true, 'invalid writes do not clobber stored prefs');
  assert.equal(afterInvalid.body.prefs.inApp, false);
});
