// Satori V2 — crypto: password hash + JWT (HS256, stdlib only).
// SRP: only crypto. Guard clauses, no nested ifs.
'use strict';
const crypto = require('node:crypto');

const SECRET = process.env.SATORI_JWT_SECRET || 'satori-v2-dev-secret-change-me';

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(12).toString('hex');
  const h = crypto.scryptSync(String(password), s, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return `scrypt$${s}$${h}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3) return false;
  const [kind, salt, want] = parts;
  if (kind === 'scrypt') {
    const got = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
    const wantBuf = Buffer.from(want, 'hex');
    if (wantBuf.length !== got.length) return false;
    return crypto.timingSafeEqual(got, wantBuf);
  }
  // legacy sha256$ rows: verified once, rehashed to scrypt by the login route
  const got = sha256(`${salt}:${password}`);
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function needsRehash(stored) {
  return String(stored).startsWith('sha256$');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(pad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

function signJwt(payload, expiresInSec = 3600 * 12) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + expiresInSec, ...payload };
  const h = b64url(JSON.stringify(header));
  const b = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest();
  return `${h}.${b}.${b64url(sig)}`;
}

function verifyJwt(token) {
  if (!token) return null;
  const parts = String(token).replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest();
  const got = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (expect.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expect, got)) return null;
  let body;
  try { body = JSON.parse(unb64url(b)); } catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

module.exports = { hashPassword, verifyPassword, needsRehash, signJwt, verifyJwt, sha256 };
