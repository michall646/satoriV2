// Minimal SDK used by CLI (kept in sync with packages/sdk). No dependencies.
'use strict';
const SSE = require('./sse');

function query(params = {}) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    q.set(key, String(value));
  }
  const out = q.toString();
  return out ? `?${out}` : '';
}

class Satori {
  constructor(base, token, opts = {}) {
    this.base = String(base || '').replace(/\/$/, '');
    if (typeof opts === 'string') opts = { refresh: opts };
    this.token = token || null;
    this.refreshToken = opts.refresh || null;
    this.onSession = typeof opts.onSession === 'function' ? opts.onSession : null;
  }

  session() { return { token: this.token, refresh: this.refreshToken }; }

  setSession(next = {}) {
    if (next.token !== undefined) this.token = next.token || null;
    if (next.refresh !== undefined) this.refreshToken = next.refresh || null;
    if (this.onSession) {
      try { this.onSession(this.session()); } catch { /* persistence must not break requests */ }
    }
    return this.session();
  }

  async _error(res, path) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const detail = body && body.error && body.error.message ? body.error.message : (text || res.statusText);
    const err = new Error(`${res.status} ${path}: ${detail}`);
    err.status = res.status;
    err.body = body;
    err.path = path;
    return err;
  }

  async req(path, opts = {}, internal = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(opts.headers || {}),
    };
    const res = await fetch(`${this.base}${path}`, { ...opts, headers });
    const canRefresh = !internal.noRefresh && !internal.retried && this.refreshToken && !path.startsWith('/api/auth/');
    if (res.status === 401 && canRefresh) {
      const ok = await this.refresh().then(() => true).catch(() => false);
      if (ok) return this.req(path, opts, { ...internal, retried: true });
    }
    if (!res.ok) throw await this._error(res, path);
    if (res.status === 204) return null;
    return res.json();
  }

  async refresh() {
    if (!this.refreshToken) throw new Error('No refresh token stored.');
    const d = await this.req('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh: this.refreshToken }),
    }, { noRefresh: true });
    if (d && d.token) this.setSession({ token: d.token });
    return d;
  }

  async login(login, password, opts = {}) {
    const body = { login, password };
    if (opts.device) body.device = opts.device;
    const d = await this.req('/api/auth/token', {
      method: 'POST',
      body: JSON.stringify(body),
    }, { noRefresh: true });
    this.setSession({ token: d.token, refresh: d.refresh || this.refreshToken });
    return d;
  }

  contests(filter) {
    if (filter == null) return this.req('/api/contests');
    if (typeof filter === 'string') return this.req(`/api/contests${query({ q: filter })}`);
    return this.req(`/api/contests${query(filter)}`);
  }

  problems(contestId) { return this.req(`/api/contests/${contestId}/problems`); }

  async allProblems() {
    const contests = await this.contests();
    const items = [];
    for (const contest of contests.items || []) {
      try {
        const data = await this.problems(contest.id);
        for (const problem of data.items || []) {
          items.push({ ...problem, contestId: contest.id, contestName: contest.name });
        }
      } catch (err) {
        if (err.status === 403 || err.status === 404) continue;
        throw err;
      }
    }
    return { items, contests: (contests.items || []).length };
  }

  submit({ contestId, problemId, code, filename, lang }) {
    // resolve problem code->id when a letter was passed
    return this._submitInner({ contestId, problemId, code, filename, lang });
  }

  async _submitInner({ contestId, problemId, code, filename, lang }) {
    if (problemId && String(problemId).match(/^[A-Z]\d*$/i) && contestId) {
      const d = await this.problems(contestId);
      const p = (d.items || []).find((x) => String(x.code).toLowerCase() === String(problemId).toLowerCase());
      if (p) problemId = p.id;
    }
    return this.req('/api/submits', {
      method: 'POST',
      body: JSON.stringify({ contestId, problemId, code, filename, lang }),
    });
  }

  submitStatus(id) { return this.req(`/api/submits/${id}`); }

  results({ contest, problem, verdict, me, team, limit = 50, offset = 0 } = {}) {
    return this.req(`/api/submits${query({ contest, problem, verdict, me: me === true ? 1 : me, team, limit, offset })}`);
  }

  ranking(contestId, modeOrFilter) {
    let filter = {};
    if (typeof modeOrFilter === 'string') filter = { mode: modeOrFilter };
    else if (modeOrFilter && typeof modeOrFilter === 'object') filter = modeOrFilter;
    return this.req(`/api/contests/${contestId}/ranking${query(filter)}`);
  }

  // Subscribe to submit verdicts. Resolves with the final verdict event.
  watch(id, onEvent) {
    return new Promise((resolve) => {
      const es = new SSE(`${this.base}/api/submits/${id}/events`, this.token);
      es.onMessage((data) => {
        if (onEvent) onEvent(data);
        else if (data.status) console.log(`[${data.status}]`);
        if (data.status && !['QUE', 'CMP', 'TST'].includes(data.status)) {
          es.close();
          resolve(data);
        }
      });
    });
  }
}

module.exports = { Satori, query };
