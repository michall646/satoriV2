// Satori V2 — persistent email queue with exponential backoff & dead-letter tracking.
'use strict';

const { store } = require('./store');
const { sendMail, isValidEmail } = require('./mailer');

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [
  0,               // 1st attempt
  30 * 1000,       // 2nd attempt: 30s
  2 * 60 * 1000,   // 3rd attempt: 2 min
  10 * 60 * 1000,  // 4th attempt: 10 min
  60 * 60 * 1000,  // 5th attempt: 1 hr
];

let workerTimer = null;

function enqueueMail(message, opts = {}) {
  const to = typeof message.to === 'string' ? message.to.trim() : '';
  if (!isValidEmail(to)) {
    throw new Error('BAD_RECIPIENT');
  }

  const now = new Date().toISOString();
  const email = store.insert('emails', {
    to,
    subject: message.subject == null ? '' : String(message.subject),
    text: message.text == null ? '' : String(message.text),
    html: message.html == null ? '' : String(message.html),
    meta: message.meta || {},
    status: 'pending',
    attempts: 0,
    maxAttempts: opts.maxAttempts || MAX_ATTEMPTS,
    lastError: null,
    provider: null,
    messageId: null,
    createdAt: now,
    nextAttemptAt: now,
    sentAt: null,
    failedAt: null,
  });

  return email;
}

async function processEmailItem(item) {
  if (!item || item.status !== 'pending') return null;

  const currentAttempts = (item.attempts || 0) + 1;
  const result = await sendMail({
    to: item.to,
    subject: item.subject,
    text: item.text,
    html: item.html,
  });

  if (result.ok && (result.delivered || result.provider === 'console')) {
    const patch = {
      status: 'sent',
      attempts: currentAttempts,
      sentAt: new Date().toISOString(),
      provider: result.provider,
      messageId: result.id || null,
      lastError: null,
    };
    return store.update('emails', item.id, patch);
  }

  const err = result.error || 'UNKNOWN_ERROR';
  const isFinal = currentAttempts >= (item.maxAttempts || MAX_ATTEMPTS);

  if (isFinal) {
    const patch = {
      status: 'dead_letter',
      attempts: currentAttempts,
      failedAt: new Date().toISOString(),
      lastError: err,
      provider: result.provider || null,
    };
    return store.update('emails', item.id, patch);
  }

  const delayMs = RETRY_DELAYS_MS[currentAttempts] || (60 * 60 * 1000);
  const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();

  const patch = {
    status: 'pending',
    attempts: currentAttempts,
    nextAttemptAt,
    lastError: err,
    provider: result.provider || null,
  };
  return store.update('emails', item.id, patch);
}

async function flushEmailQueue(limit = 50) {
  const now = Date.now();
  const pending = store.query('emails', (e) => {
    if (e.status !== 'pending') return false;
    const nextAt = new Date(e.nextAttemptAt || e.createdAt).getTime();
    return Number.isFinite(nextAt) && nextAt <= now;
  }).slice(0, limit);

  let sent = 0;
  let failed = 0;
  let deadLetter = 0;

  for (const item of pending) {
    const res = await processEmailItem(item);
    if (!res) continue;
    if (res.status === 'sent') sent += 1;
    else if (res.status === 'dead_letter') deadLetter += 1;
    else failed += 1;
  }

  return { processed: pending.length, sent, failed, deadLetter };
}

function retryEmail(id) {
  const item = store.get('emails', id);
  if (!item) return null;

  const patch = {
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    lastError: null,
  };
  return store.update('emails', item.id, patch);
}

function emailQueueStats() {
  const all = store.all('emails');
  let pending = 0;
  let sent = 0;
  let deadLetter = 0;

  for (const e of all) {
    if (e.status === 'pending') pending += 1;
    else if (e.status === 'sent') sent += 1;
    else if (e.status === 'dead_letter') deadLetter += 1;
  }

  return { total: all.length, pending, sent, deadLetter };
}

function startEmailWorker(intervalMs = 5000) {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    flushEmailQueue().catch(() => {});
  }, intervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

function stopEmailWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

module.exports = {
  enqueueMail,
  processEmailItem,
  flushEmailQueue,
  retryEmail,
  emailQueueStats,
  startEmailWorker,
  stopEmailWorker,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
};
