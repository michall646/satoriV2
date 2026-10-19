// Satori V2 — real e-mail transport (stdlib only, no runtime deps).
// Providers: console (default, not "configured"), webhook, resend, sendgrid.
// Every failure is returned as data; sendMail never throws and never retries a
// failed delivery (a slow remote must not stall the API for long).
'use strict';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROVIDERS = ['console', 'webhook', 'resend', 'sendgrid'];
const SEND_TIMEOUT_MS = 5000;
const TO_MAX = 254;
const FROM_MAX = 254;
const SUBJECT_MAX = 200;
const TEXT_MAX = 20000;
const HTML_MAX = 100000;

function env(name) {
  const value = process.env[name];
  return value == null ? '' : String(value).trim();
}

function provider() {
  const raw = env('SATORI_MAIL_PROVIDER').toLowerCase();
  return raw || 'console';
}

function fromAddress() {
  return env('SATORI_MAIL_FROM');
}

// The reset link and announcement links must point at the web app, not the API.
function webBaseUrl() {
  const raw = env('SATORI_WEB_BASE_URL') || env('SATORI_WEB_BASE') || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

function envFlag(name) {
  const value = env(name).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function consoleAllowed() {
  return envFlag('SATORI_MAIL_ALLOW_CONSOLE') || envFlag('SATORI_MAIL_CONSOLE');
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.length > TO_MAX) return false;
  if (/[\r\n]/.test(candidate)) return false;
  return EMAIL_RE.test(candidate);
}

// From may be a bare address or a display-name form: Satori <noreply@example.com>.
function parseFrom(value) {
  const candidate = String(value || '').trim();
  const named = candidate.match(/^(.+?)\s*<([^<>]+)>$/);
  if (!named) return { email: candidate };
  return {
    email: named[2].trim(),
    name: named[1].trim().replace(/^"(.*)"$/, '$1'),
  };
}

function isValidFrom(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.length > FROM_MAX || /[\r\n]/.test(candidate)) return false;
  return isValidEmail(parseFrom(candidate).email);
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isConfigured() {
  const p = provider();
  // Console is a dev fallback: it never claims delivery. Routes treat it as
  // "not configured" unless the operator explicitly opts in.
  if (p === 'console') return consoleAllowed();
  if (!isValidFrom(fromAddress())) return false;
  if (p === 'webhook') return isValidHttpUrl(env('SATORI_MAIL_WEBHOOK'));
  if (p === 'resend' || p === 'sendgrid') return Boolean(env('SATORI_MAIL_API_KEY'));
  return false;
}

function cap(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

function failure(providerName, error, extra) {
  return { ok: false, provider: providerName, delivered: false, error, ...(extra || {}) };
}

async function postJson(url, payload, headers) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(payload),
    // No redirects: a mail endpoint should not bounce the payload elsewhere.
    redirect: 'error',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON provider reply */ }
  if (!response.ok) {
    return { ok: false, httpStatus: response.status, error: `HTTP_${response.status}` };
  }
  const headerId = response.headers.get('x-message-id') || response.headers.get('x-request-id');
  const id = (data && (data.id || data.messageId || data.message_id)) || headerId || undefined;
  return { ok: true, httpStatus: response.status, ...(id ? { id } : {}) };
}

async function sendWebhook(message) {
  const result = await postJson(env('SATORI_MAIL_WEBHOOK'), {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return result;
}

async function sendResend(message) {
  return postJson('https://api.resend.com/emails', {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  }, { Authorization: `Bearer ${env('SATORI_MAIL_API_KEY')}` });
}

async function sendSendgrid(message) {
  const content = [{ type: 'text/plain', value: message.text }];
  if (message.html) content.push({ type: 'text/html', value: message.html });
  const parsed = parseFrom(message.from);
  const from = parsed.name ? { email: parsed.email, name: parsed.name } : { email: parsed.email };
  return postJson('https://api.sendgrid.com/v3/mail/send', {
    personalizations: [{ to: [{ email: message.to }] }],
    from,
    subject: message.subject,
    content,
  }, { Authorization: `Bearer ${env('SATORI_MAIL_API_KEY')}` });
}

// Validate first, then deliver. Never throw: callers (forgot/reset, announcements)
// must stay generic even when the mail provider is down.
async function sendMail(input) {
  const p = provider();
  if (!PROVIDERS.includes(p)) return failure(p || 'unknown', 'BAD_PROVIDER');

  const message = input || {};
  const to = typeof message.to === 'string' ? message.to.trim() : '';
  if (!isValidEmail(to)) return failure(p, 'BAD_RECIPIENT');

  const subject = message.subject == null ? '' : String(message.subject);
  if (/[\r\n]/.test(subject)) return failure(p, 'BAD_SUBJECT');
  if (subject.length > SUBJECT_MAX) return failure(p, 'SUBJECT_TOO_LONG');

  const text = cap(message.text == null ? '' : String(message.text), TEXT_MAX);
  const html = message.html == null ? '' : cap(String(message.html), HTML_MAX);

  // Console is always usable directly, but isConfigured() stays false unless the
  // operator opted in, so production routes never mistake it for delivery.
  if (p === 'console') {
    console.log(`[mail] from=${fromAddress() || '(unset)'} to=${to} subject=${JSON.stringify(subject.slice(0, 80))} provider=console delivered=false`);
    return { ok: true, provider: 'console', delivered: false };
  }

  if (!isConfigured()) return failure(p, 'NOT_CONFIGURED');
  const from = fromAddress();
  if (!isValidFrom(from)) return failure(p, 'BAD_FROM');

  const payload = { from, to, subject, text, html };
  try {
    const result = p === 'webhook'
      ? await sendWebhook(payload)
      : p === 'resend'
        ? await sendResend(payload)
        : await sendSendgrid(payload);
    if (!result.ok) return failure(p, result.error, result.httpStatus ? { httpStatus: result.httpStatus } : undefined);
    return { ok: true, provider: p, delivered: true, ...(result.id ? { id: result.id } : {}) };
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return failure(p, timedOut ? 'TIMEOUT' : `NETWORK: ${String((e && e.message) || e)}`);
  }
}

module.exports = {
  provider, isConfigured, isValidEmail, sendMail, webBaseUrl,
  // Exposed for tests and future callers that need the same config rules.
  fromAddress, consoleAllowed,
};
