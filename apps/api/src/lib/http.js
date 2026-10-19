// Satori V2 — shared HTTP helpers (responses, body parsing, throttles, SSRF guards).
'use strict';
const crypto = require('node:crypto');
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');

function send(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...(extraHeaders || {}),
  });
  res.end(body);
  return true;
}
function sendText(res, code, text, type = 'text/html; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(text);
  return true;
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({ _raw: buf }); }
    });
  });
}

function handleOptions(req, res, m) {
  if (m !== 'OPTIONS') return false;
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
  res.end();
  return true;
}

// ---- simple in-memory throttles (shared across routes) ----
const THROTTLE = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (THROTTLE.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    THROTTLE.set(key, hits);
    const retryAfterMs = Math.max(0, windowMs - (now - (hits[0] || now)));
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)), remaining: 0 };
  }
  hits.push(now);
  THROTTLE.set(key, hits);
  return { limited: false, retryAfterSec: 0, remaining: Math.max(0, max - hits.length) };
}
function rateLimited(key, max, windowMs) {
  return rateLimit(key, max, windowMs).limited;
}
function throttleResponse(res, info, message = 'Too many requests.', hint = '') {
  const sec = info && info.retryAfterSec ? info.retryAfterSec : 60;
  const suffix = `Retry in ${sec}s.${hint ? ` ${hint}` : ''}`.trim();
  return send(res, 429, {
    error: { code: 'THROTTLE', message, hint: suffix, retryAfterSec: sec },
  }, { 'Retry-After': String(sec) });
}
function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
function noteLoginFail(key) {
  const k = `login:${key}`;
  const now = Date.now();
  const hits = (THROTTLE.get(k) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  hits.push(now);
  THROTTLE.set(k, hits);
}
function loginBlocked(key) {
  const k = `login:${key}`;
  const now = Date.now();
  const hits = (THROTTLE.get(k) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (hits.length !== (THROTTLE.get(k) || []).length) THROTTLE.set(k, hits);
  return hits.length >= LOGIN_MAX_FAILS;
}
function clearLoginFails(key) { THROTTLE.delete(`login:${key}`); }

// ---- webhook SSRF guard (A4) ----
// Rejects anything that is not a public http(s) endpoint. Registration and every
// delivery validate again so a DNS record cannot be rebound into the private net.
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.intranet'];

function ipv4Parts(ip) {
  const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((x) => x <= 255) ? parts : null;
}
function isPrivateIpv4(ip) {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}
function expandIpv6(ip) {
  let s = String(ip).split('%')[0].toLowerCase();
  const v4 = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const p = ipv4Parts(v4[2]);
    if (!p) return null;
    s = `${v4[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g || '0', 16));
  return nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? nums : null;
}
function isPrivateIpv6(ip) {
  const g = expandIpv6(ip);
  if (!g) return false;
  const allZero = g.every((x) => x === 0);
  if (allZero) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) return isPrivateIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  const compatible = g.slice(0, 6).every((x) => x === 0);
  if (compatible) return isPrivateIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  return false;
}
function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}
function isBlockedHostname(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  // Explicit opt-in for local/dev deployments and the test suite.
  if (process.env.SATORI_WEBHOOK_ALLOW_PRIVATE === '1') return false;
  const family = net.isIP(host);
  if (family === 4) return isPrivateIpv4(host);
  if (family === 6) return isPrivateIpv6(host);
  if (host === 'localhost') return true;
  return BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}
async function resolvePublicHost(hostname) {
  const host = normalizeHost(hostname);
  const family = net.isIP(host);
  if (family) {
    if (isBlockedHostname(host)) return { ok: false, code: 'URL_BLOCKED', message: 'Webhook URL points at a private or loopback address.', hint: 'Use a public http(s) endpoint.' };
    return { ok: true, address: host, family, addresses: [{ address: host, family }] };
  }
  let rows;
  try {
    rows = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: 'DNS', message: 'Webhook host could not be resolved.', hint: 'Check the hostname, or retry later.' };
  }
  if (!rows || rows.length === 0) return { ok: false, code: 'DNS', message: 'Webhook host has no addresses.', hint: 'Check the hostname.' };
  for (const row of rows) {
    if (isBlockedHostname(row.address)) return { ok: false, code: 'URL_BLOCKED', message: 'Webhook host resolves to a private or loopback address.', hint: 'Use a public http(s) endpoint.' };
  }
  return { ok: true, address: rows[0].address, family: rows[0].family, addresses: rows };
}
async function assertSafeWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, code: 'URL', message: 'Webhook URL is invalid.', hint: 'Use http(s)://host/path.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'URL_PROTOCOL', message: 'Webhook URL must be http(s).', hint: 'Use https://….' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'URL_CREDS', message: 'Webhook URL must not contain credentials.', hint: 'Use a signed header instead.' };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, code: 'URL_BLOCKED', message: 'Webhook URL points at a private or loopback address.', hint: 'Use a public http(s) endpoint.' };
  }
  const resolved = await resolvePublicHost(parsed.hostname);
  if (!resolved.ok) return resolved;
  return { ok: true, url: parsed, address: resolved.address, family: resolved.family, addresses: resolved.addresses };
}
function postJsonPinned(target, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (out) => { if (!done) { done = true; resolve({ ...out, ms: Date.now() - started }); } };
    const url = target.url;
    const hostname = normalizeHost(url.hostname);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname || '/'}${url.search || ''}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      lookup: (_host, _opts, cb) => cb(null, target.address, target.family),
      servername: url.protocol === 'https:' && net.isIP(hostname) === 0 ? hostname : undefined,
      timeout: timeoutMs,
    }, (res) => {
      res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, httpStatus: res.statusCode }));
      res.on('error', (e) => finish({ ok: false, httpStatus: res.statusCode, error: String((e && e.message) || e) }));
      res.resume();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
    req.end(body);
  });
}
function webhookSecret() { return process.env.SATORI_WEBHOOK_SECRET || ''; }
function signWebhook(body, secret = webhookSecret()) {
  if (!secret) return '';
  return `sha256=${crypto.createHmac('sha256', String(secret)).update(String(body)).digest('hex')}`;
}

// A14 helpers for routes that live outside this lane.
const SUBMIT_RATE_MAX = Number(process.env.SATORI_SUBMIT_RATE_MAX || 30);
const SUBMIT_RATE_WINDOW_MS = Number(process.env.SATORI_SUBMIT_RATE_WINDOW_MS || 60000);
const REGISTER_RATE_MAX = Number(process.env.SATORI_REGISTER_RATE_MAX || 8);
const REGISTER_RATE_WINDOW_MS = Number(process.env.SATORI_REGISTER_RATE_WINDOW_MS || 10 * 60 * 1000);
const VIOLATION_RATE_MAX = Number(process.env.SATORI_VIOLATION_RATE_MAX || 20);
const VIOLATION_RATE_WINDOW_MS = Number(process.env.SATORI_VIOLATION_RATE_WINDOW_MS || 60000);
function submitRate(userId) { return rateLimit(`submit:${userId}`, SUBMIT_RATE_MAX, SUBMIT_RATE_WINDOW_MS); }
function registerRate(req) { return rateLimit(`register:${clientIp(req)}`, REGISTER_RATE_MAX, REGISTER_RATE_WINDOW_MS); }
function violationRate(contestId, userId) { return rateLimit(`violation:${contestId}:${userId}`, VIOLATION_RATE_MAX, VIOLATION_RATE_WINDOW_MS); }

module.exports = {
  send, sendText, readBody, handleOptions,
  rateLimited, rateLimit, throttleResponse, clientIp,
  noteLoginFail, loginBlocked, clearLoginFails,
  isPrivateIpv4, isPrivateIpv6, isBlockedHostname, resolvePublicHost, assertSafeWebhookUrl,
  postJsonPinned, signWebhook, webhookSecret,
  submitRate, registerRate, violationRate,
};
