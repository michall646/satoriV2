// Satori V2 — shared HTTP helpers (responses, body parsing, throttles).
'use strict';

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
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
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const hits = (THROTTLE.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { THROTTLE.set(key, hits); return true; }
  hits.push(now);
  THROTTLE.set(key, hits);
  return false;
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

module.exports = { send, sendText, readBody, handleOptions, rateLimited, noteLoginFail, loginBlocked, clearLoginFails };
