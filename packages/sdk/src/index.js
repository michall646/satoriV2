// Satori V2 official SDK (JS). Mirrors CLI shim, typed via JSDoc.
'use strict';
class Satori {
  constructor(base, token) { this.base = base.replace(/\/$/, ''); this.token = token; }
  async req(path, opts = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  login(l, p) { return this.req('/api/auth/token', { method: 'POST', body: JSON.stringify({ login: l, password: p }) }); }
  contests(q) { return this.req(`/api/contests${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  problems(cid) { return this.req(`/api/contests/${cid}/problems`); }
  submit(o) { return this.req('/api/submits', { method: 'POST', body: JSON.stringify(o) }); }
  ranking(cid, mode) { return this.req(`/api/contests/${cid}/ranking${mode ? `?mode=${mode}` : ''}`); }
}
module.exports = { Satori };
