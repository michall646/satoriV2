// Minimal SDK used by CLI (also published as packages/sdk).
'use strict';
class Satori {
  constructor(base, token) { this.base = base.replace(/\/$/, ''); this.token = token; }
  async req(path, opts = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
    return res.json();
  }
  login(login, password) { return this.req('/api/auth/token', { method: 'POST', body: JSON.stringify({ login, password, device: 'cli' }) }); }
  contests() { return this.req('/api/contests'); }
  problems(contestId) { return this.req(`/api/contests/${contestId}/problems`); }
  submit({ contestId, problemId, code, filename, lang }) {
    // resolve problem code->id when needed
    return this._submitInner({ contestId, problemId, code, filename, lang });
  }
  async _submitInner({ contestId, problemId, code, filename, lang }) {
    if (problemId && String(problemId).match(/^[A-Z]\d*$/i) && contestId) {
      const d = await this.problems(contestId);
      const p = d.items.find((x) => x.code.toLowerCase() === String(problemId).toLowerCase());
      if (p) problemId = p.id;
    }
    // if only code letter passed as problemId without contest lookup, try direct problem submit path fallback
    return this.req('/api/submits', { method: 'POST', body: JSON.stringify({ contestId, problemId, code, filename, lang }) });
  }
  submitStatus(id) { return this.req(`/api/submits/${id}`); }
  results({ contest, problem, limit }) {
    const q = new URLSearchParams({ ...(contest ? { contest } : {}), ...(problem ? { problem } : {}), limit: limit || 20 });
    return this.req(`/api/submits?${q}`);
  }
  watch(id) {
    return new Promise((resolve) => {
      const es = new (require('./sse'))( `${this.base}/api/submits/${id}/events`, this.token);
      es.onMessage((d) => { console.log(`[${d.status || d.phase}]`); if (d.status && !['QUE', 'CMP', 'TST'].includes(d.status)) { es.close(); resolve(d); } });
    });
  }
}
module.exports = { Satori };
