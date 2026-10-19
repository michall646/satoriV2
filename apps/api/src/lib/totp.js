// Satori V2 — TOTP (RFC 6238 / HOTP RFC 4226) with stdlib crypto only.
// Secrets are base32 (RFC 4648, no padding). Codes are 6 digits, 30s period.
// `at` is epoch milliseconds, like Date.now(); verification accepts one step each way.
'use strict';
const crypto = require('node:crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SEC = 30;
const PERIOD_MS = PERIOD_SEC * 1000;
const DIGITS = 6;
const MODULO = 10 ** DIGITS;

function base32Encode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s=]/g, '');
  if (!s) throw new Error('Empty base32 secret.');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

// RFC 4226 dynamic truncation, SHA-1. Returns a number below 10^6.
function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24)
    | ((mac[offset + 1] & 0xff) << 16)
    | ((mac[offset + 2] & 0xff) << 8)
    | (mac[offset + 3] & 0xff);
  return binary % MODULO;
}

function counterAt(at) {
  const ms = Number(at);
  if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid TOTP timestamp.');
  return Math.floor(ms / PERIOD_MS);
}

function totp(secret, at = Date.now()) {
  const key = base32Decode(secret);
  return String(hotp(key, counterAt(at))).padStart(DIGITS, '0');
}

function verifyTotp(secret, code, at = Date.now()) {
  const clean = String(code == null ? '' : code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  let key;
  try { key = base32Decode(secret); } catch { return false; }
  let counter;
  try { counter = counterAt(at); } catch { return false; }
  const got = Buffer.from(clean);
  for (let delta = -1; delta <= 1; delta += 1) {
    const current = counter + delta;
    if (current < 0) continue;
    const want = Buffer.from(String(hotp(key, current)).padStart(DIGITS, '0'));
    if (crypto.timingSafeEqual(got, want)) return true;
  }
  return false;
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUrl({ secret, account, issuer = process.env.SATORI_TOTP_ISSUER || 'Satori V2' } = {}) {
  if (!secret) throw new Error('TOTP secret required.');
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(String(account || ''))}`;
  const params = new URLSearchParams({
    secret: String(secret),
    issuer: String(issuer),
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  BASE32,
  DIGITS,
  PERIOD_SEC,
  base32Encode,
  base32Decode,
  totp,
  verifyTotp,
  generateSecret,
  otpauthUrl,
};
