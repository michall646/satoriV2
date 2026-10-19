// Satori V2 web — fetch client: base URL, auth refresh, cache, structured errors.
const { getLang } = require('./i18n');

const API = process.env.NEXT_PUBLIC_API || 'http://localhost:3001';

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
    return j.token || null;
  } catch { return null; }
}

const __cache = new Map();
const __inflight = new Map();
const CACHE_TTL = 10000;

function __isCacheable(path, opts = {}) {
  const m = String(opts.method || 'GET').toUpperCase();
  if (m !== 'GET') return false;
  if (opts.body) return false;
  if (opts.noCache) return false;
  if (typeof window === 'undefined') return false;
  return true;
}

function clearApiCache(prefix) {
  if (!prefix) { __cache.clear(); __inflight.clear(); return; }
  for (const k of [...__cache.keys()]) { if (k.startsWith(prefix)) __cache.delete(k); }
  for (const k of [...__inflight.keys()]) { if (k.startsWith(prefix)) __inflight.delete(k); }
}

async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && !opts._retried) {
    // Mutations invalidate list caches so next nav is fresh but fast.
    __cache.clear();
    __inflight.clear();
  }
  if (__isCacheable(path, opts) && !opts._retried) {
    const hit = __cache.get(path);
    if (hit && hit.expiry > Date.now()) return hit.data;
    const flying = __inflight.get(path);
    if (flying) return flying;
    const p = __fetchJson(path, opts).then((d) => {
      __cache.set(path, { data: d, expiry: Date.now() + (opts.ttl || CACHE_TTL) });
      __inflight.delete(path);
      return d;
    }).catch((e) => { __inflight.delete(path); throw e; });
    __inflight.set(path, p);
    return p;
  }
  return __fetchJson(path, opts);
}

async function __fetchJson(path, opts = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('SATORI_TOKEN') : null;
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

module.exports = { API, api, ApiError, clearApiCache };
