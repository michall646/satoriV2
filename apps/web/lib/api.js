// Satori V2 web — fetch client: base URL, auth refresh, cache, structured errors.
const { getLang } = require('./i18n');

// A17: with no NEXT_PUBLIC_API the client calls the same origin. Every path below
// already starts with /api, so the base is empty rather than a hard-coded localhost.
// An explicit /api value is treated the same way to avoid /api/api double prefixes.
function normalizeApiBase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s === '/api' || s === '/api/') return '';
  return s.replace(/\/+$/, '');
}
const API = normalizeApiBase(process.env.NEXT_PUBLIC_API);

class ApiError extends Error {
  constructor(status, path, body) {
    const e = body && body.error ? body.error : {};
    const msg = e.message || `HTTP ${status}`;
    const hint = e.hint ? ` — ${e.hint}` : '';
    super(`${msg}${hint}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = e.code || 'HTTP';
    this.hint = e.hint || '';
    this.field = e.field || null;
    this.path = path;
  }
}

function readToken() {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem('SATORI_TOKEN') || ''; } catch { return ''; }
}

async function tryRefresh() {
  if (typeof window === 'undefined') return null;
  const refresh = localStorage.getItem('SATORI_REFRESH');
  if (!refresh) return null;
  try {
    const r = await fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.token) localStorage.setItem('SATORI_TOKEN', j.token);
    if (j.refresh) localStorage.setItem('SATORI_REFRESH', j.refresh);
    syncAuth();
    return j.token || null;
  } catch { return null; }
}

const __cache = new Map();
const __inflight = new Map();
const CACHE_TTL = 10000;
// A16: the cache is partitioned by auth token, so two accounts on one browser can
// never read each other's /api/me or joined-contest list.
let __authKey = readToken();

function syncAuth() {
  const token = readToken();
  if (token === __authKey) return;
  __authKey = token;
  clearApiCache();
}
function cacheKey(path) { return `${__authKey}\u0000${path}`; }

function __isCacheable(path, opts = {}) {
  const m = String(opts.method || 'GET').toUpperCase();
  if (m !== 'GET') return false;
  if (opts.body) return false;
  if (opts.noCache) return false;
  if (typeof window === 'undefined') return false;
  return true;
}

function __matches(key, prefix) {
  if (!prefix) return true;
  if (key.startsWith(prefix)) return true;
  const idx = key.indexOf('\u0000');
  return idx >= 0 && key.slice(idx + 1).startsWith(prefix);
}
function clearApiCache(prefix) {
  if (!prefix) { __cache.clear(); __inflight.clear(); return; }
  for (const k of [...__cache.keys()]) { if (__matches(k, prefix)) __cache.delete(k); }
  for (const k of [...__inflight.keys()]) { if (__matches(k, prefix)) __inflight.delete(k); }
}

// A16: login/logout helpers for the auth hook. Call these instead of touching
// localStorage directly; they clear the cache immediately.
function setApiAuth(token, refresh) {
  if (typeof window !== 'undefined') {
    if (token) localStorage.setItem('SATORI_TOKEN', token);
    else localStorage.removeItem('SATORI_TOKEN');
    if (refresh) localStorage.setItem('SATORI_REFRESH', refresh);
    else localStorage.removeItem('SATORI_REFRESH');
  }
  __authKey = token || '';
  clearApiCache();
}
function clearApiAuth() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('SATORI_TOKEN');
    localStorage.removeItem('SATORI_REFRESH');
  }
  __authKey = '';
  clearApiCache();
}

async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  syncAuth();
  if (method !== 'GET' && !opts._retried) {
    // Mutations invalidate list caches so next nav is fresh but fast.
    clearApiCache();
  }
  if (__isCacheable(path, opts) && !opts._retried) {
    const key = cacheKey(path);
    const hit = __cache.get(key);
    if (hit && hit.expiry > Date.now()) return hit.data;
    const flying = __inflight.get(key);
    if (flying) return flying;
    const p = __fetchJson(path, opts).then((d) => {
      __cache.set(key, { data: d, expiry: Date.now() + (opts.ttl || CACHE_TTL) });
      __inflight.delete(key);
      return d;
    }).catch((e) => { __inflight.delete(key); throw e; });
    __inflight.set(key, p);
    return p;
  }
  return __fetchJson(path, opts);
}

async function __fetchJson(path, opts = {}) {
  const token = readToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && typeof window !== 'undefined' && !opts._retried) {
    const next = await tryRefresh();
    if (next) return api(path, { ...opts, _retried: true });
  }
  if (!res.ok) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: { message: text } }; }
    throw new ApiError(res.status, path, body);
  }
  return res.json();
}

module.exports = {
  API, api, ApiError, clearApiCache,
  setApiAuth, clearApiAuth,
};
