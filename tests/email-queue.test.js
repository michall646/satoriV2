// Tests for persistent email queue with exponential backoff & dead-letter tracking
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let superadmin;
let student;
let emailQueue;
let store;

before(async () => {
  h = await startServer({ prefix: 'satori-email-queue-' });
  superadmin = await h.loginAs('admin', 'admin123');
  student = await h.loginAs('jan_kowalski', 'student123');
  emailQueue = require('../apps/api/src/lib/emailQueue');
  store = require('../apps/api/src/lib/store').store;
});

after(async () => {
  if (h) await h.close();
});

test('enqueueMail validates recipient and records pending email', () => {
  assert.throws(() => emailQueue.enqueueMail({ to: 'invalid-email', subject: 'Hi' }), /BAD_RECIPIENT/);

  const email = emailQueue.enqueueMail({
    to: 'student@example.com',
    subject: 'Welcome',
    text: 'Hello world',
    meta: { type: 'welcome' },
  });

  assert.ok(email.id);
  assert.equal(email.status, 'pending');
  assert.equal(email.attempts, 0);
  assert.equal(email.to, 'student@example.com');
  assert.equal(email.meta.type, 'welcome');
});

test('processEmailItem delivers via console provider and marks sent', async () => {
  process.env.SATORI_MAIL_PROVIDER = 'console';
  process.env.SATORI_MAIL_ALLOW_CONSOLE = '1';

  const email = emailQueue.enqueueMail({
    to: 'test-send@example.com',
    subject: 'Deliver me',
    text: 'Content',
  });

  const res = await emailQueue.processEmailItem(email);
  assert.ok(res);
  assert.equal(res.status, 'sent');
  assert.equal(res.attempts, 1);
  assert.ok(res.sentAt);
});

test('processEmailItem handles failures with backoff and transitions to dead_letter', async () => {
  process.env.SATORI_MAIL_PROVIDER = 'resend';
  delete process.env.SATORI_MAIL_API_KEY; // will fail with NOT_CONFIGURED

  const email = emailQueue.enqueueMail({
    to: 'fail-test@example.com',
    subject: 'Will fail',
    text: 'Failure content',
  }, { maxAttempts: 2 });

  // 1st attempt: fails, increments attempt, sets backoff delay
  const attempt1 = await emailQueue.processEmailItem(email);
  assert.equal(attempt1.status, 'pending');
  assert.equal(attempt1.attempts, 1);
  assert.ok(attempt1.lastError);
  assert.ok(new Date(attempt1.nextAttemptAt).getTime() > Date.now());

  // 2nd attempt: hits maxAttempts (2) -> transitions to dead_letter
  const attempt2 = await emailQueue.processEmailItem(attempt1);
  assert.equal(attempt2.status, 'dead_letter');
  assert.equal(attempt2.attempts, 2);
  assert.ok(attempt2.failedAt);

  // retryEmail resets dead_letter back to pending
  const retried = emailQueue.retryEmail(email.id);
  assert.equal(retried.status, 'pending');
  assert.equal(retried.attempts, 0);
  assert.equal(retried.lastError, null);
});

test('emailQueueStats aggregates status counts', () => {
  const stats = emailQueue.emailQueueStats();
  assert.ok(Number.isInteger(stats.total));
  assert.ok(Number.isInteger(stats.pending));
  assert.ok(Number.isInteger(stats.sent));
  assert.ok(Number.isInteger(stats.deadLetter));
});

test('admin email endpoints require superadmin and allow inspection & retry', async () => {
  // Anon -> 401
  const anon = await h.api('/api/admin/emails');
  assert.equal(anon.status, 401);

  // Student -> 403
  const forbidden = await h.api('/api/admin/emails', {}, student);
  assert.equal(forbidden.status, 403);

  // Superadmin -> 200
  const ok = await h.api('/api/admin/emails', {}, superadmin);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.stats);
  assert.ok(Array.isArray(ok.body.items));

  // Flush endpoint
  const flush = await h.api('/api/admin/emails/flush', { method: 'POST' }, superadmin);
  assert.equal(flush.status, 200);
  assert.ok(Number.isInteger(flush.body.processed));

  // Retry endpoint
  const testMail = emailQueue.enqueueMail({ to: 'retry-route@example.com', subject: 'Retry me' });
  store.update('emails', testMail.id, { status: 'dead_letter', attempts: 5 });

  const retryRes = await h.api(`/api/admin/emails/${testMail.id}/retry`, { method: 'POST' }, superadmin);
  assert.equal(retryRes.status, 200);
  assert.equal(retryRes.body.ok, true);
  assert.equal(retryRes.body.email.status, 'pending');
  assert.equal(retryRes.body.email.attempts, 0);
});
