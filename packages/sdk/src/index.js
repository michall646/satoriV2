// Satori V2 official SDK (JS). Mirrors CLI shim, typed via JSDoc.
// Node 20+ (global fetch + Web Streams). No dependencies.
'use strict';

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
  /**
   * @param {string} base API base URL, e.g. http://localhost:3001
   * @param {string|null} token JWT
   * @param {{refresh?: string, onSession?: Function}|string} [opts] refresh token or options
   */
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
    this._emitSession();
    return this.session();
  }

  _emitSession() {
    if (!this.onSession) return;
    try { this.onSession(this.session()); } catch { /* persistence must not break requests */ }
  }

  async _error(res, path) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    const detail = body && body.error && body.error.message ? body.error.message : (text || res.statusText);
    const err = new Error(`${res.status} ${path}: ${detail}`);
    err.status = res.status;
    err.body = body;
    err.path = path;
    return err;
  }

  /**
   * Core request. On 401 it refreshes once when a refresh token is available.
   * @param {string} path
   * @param {RequestInit} [opts]
   * @param {{noRefresh?: boolean, retried?: boolean}} [internal]
   */
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

  // No global /api/problems route exists: walk visible contests and aggregate.
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

  /**
   * Subscribe to a server-sent event stream. Returns a controller with
   * `close()` and a `done` promise, plus the raw response.
   */
  async streamEvents(path, onEvent, opts = {}) {
    const makeHeaders = () => ({
      Accept: 'text/event-stream',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(opts.headers || {}),
    });
    let res = await fetch(`${this.base}${path}`, { headers: makeHeaders(), signal: opts.signal });
    if (res.status === 401 && this.refreshToken) {
      await this.refresh().catch(() => {});
      res = await fetch(`${this.base}${path}`, { headers: makeHeaders(), signal: opts.signal });
    }
    if (!res.ok) throw await this._error(res, path);
    if (!res.body || typeof res.body.getReader !== 'function') {
      throw new Error('SSE stream is not readable in this runtime.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const done = (async () => {
      try {
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            let data;
            try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
            try { if (onEvent) onEvent(data); } catch { /* a listener must not kill the stream */ }
          }
        }
      } catch (err) {
        if (!opts.signal || !opts.signal.aborted) throw err;
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    })();
    done.catch(() => { /* callers may only await close() */ });
    return {
      response: res,
      done,
      close() { try { reader.cancel(); } catch { /* closed */ } },
    };
  }

  watch(submitId, onEvent, opts = {}) {
    return this.streamEvents(`/api/submits/${submitId}/events`, onEvent, opts);
  }
}

module.exports = { Satori, query };
