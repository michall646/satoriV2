// Satori V2 — Prometheus scrape endpoint and JSON snapshot (G8).
//
// `GET /api/metrics` serves text exposition 0.0.4. Public by default; when
// SATORI_METRICS_TOKEN is set, callers must send `Authorization: Bearer <token>`
// or `?token=<token>` (the header is preferred — query strings leak into logs).
'use strict';
const crypto = require('node:crypto');
const metrics = require('../lib/metrics');
const judgeQueue = require('../lib/judgeQueue');
const { send } = require('../lib/http');

function metricsToken() {
  return process.env.SATORI_METRICS_TOKEN || '';
}

function safeEqual(supplied, expected) {
  const a = Buffer.from(String(supplied), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function suppliedToken(req, url) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return url.searchParams.get('token');
}

function authorized(req, url) {
  const expected = metricsToken();
  if (!expected) return true;
  const supplied = suppliedToken(req, url);
  return supplied != null && safeEqual(supplied, expected);
}

function text(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
  return true;
}

function unauthorized(res) {
  return send(res, 401, {
    error: {
      code: 'METRICS_AUTH',
      message: 'Metrics require an operator token.',
      hint: 'Send Authorization: Bearer <SATORI_METRICS_TOKEN>.',
    },
  }, { 'WWW-Authenticate': 'Bearer' });
}

function handle(req, res, url, p, m) {
  if (p !== '/api/metrics' && p !== '/api/metrics.json') return false;
  if (m !== 'GET') {
    return send(res, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: `No route ${m} ${p}.`, hint: 'Use GET.' },
    }, { Allow: 'GET' });
  }

  // Cheap, synchronous and side-effect free: judgeQueue only creates its worker
  // when a submission is processed, never on scrape.
  metrics.setGauge('satori_judge_queue_depth', {}, judgeQueue.queueSize());

  if (!authorized(req, url)) return unauthorized(res);
  if (p === '/api/metrics.json') return send(res, 200, metrics.snapshot());
  return text(res, metrics.prometheus());
}

module.exports = { handle };
