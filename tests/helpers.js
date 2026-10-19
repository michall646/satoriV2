// Shared API test harness. Start once per test file, isolated DATA_DIR, dynamic port.
// Usage:
//   const h = await startServer();
//   const tok = await h.loginAs('jan_kowalski', 'student123');
//   const res = await h.api('/api/me', {}, tok);
//   await h.close();
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeDataDir(prefix = 'satori-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function json(body) {
  return { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

async function startServer(opts = {}) {
  const createdDataDir = !opts.dataDir;
  const dataDir = opts.dataDir || makeDataDir(opts.prefix);
  process.env.SATORI_DATA_DIR = dataDir;
  process.env.NODE_ENV = 'test';
  if (opts.jwtSecret) process.env.SATORI_JWT_SECRET = opts.jwtSecret;

  // Require after DATA_DIR is set: store reads it at module load.
  const { store } = require('../apps/api/src/lib/store');
  if (opts.seed !== false) require('../apps/api/src/seed').main();
  const { server } = require('../apps/api/src/server');

  await new Promise((resolve, reject) => {
    function onError(err) {
      server.removeListener('listening', onListening);
      reject(err);
    }
    function onListening() {
      server.removeListener('error', onError);
      resolve();
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function request(p, opts2 = {}, token = null) {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts2.headers || {}) };
    let body = opts2.body;
    if (body != null && typeof body === 'object' && !Buffer.isBuffer(body) && typeof body.pipe !== 'function') {
      body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${p}`, { ...opts2, headers, body });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: parsed == null ? {} : parsed, text, headers: res.headers };
  }

  async function api(p, opts2 = {}, token = null) {
    return request(p, opts2, token);
  }

  async function loginAs(login, password) {
    const r = await api('/api/auth/token', { method: 'POST', ...json({ login, password }) });
    if (r.status !== 200) throw new Error(`login ${login} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token;
  }

  async function waitJudged(id, token = null, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await api(`/api/submits/${id}`, {}, token);
      const s = r.body || {};
      if (s.status && !['QUE', 'CMP', 'TST'].includes(s.status)) return s;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }

  async function waitFor(fn, timeoutMs = 8000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  async function createContest(token, body = {}) {
    const r = await api('/api/contests', { method: 'POST', ...json({ name: `Test ${Date.now()}`, mode: 'ICPC', ...body }) }, token);
    if (r.status !== 201) throw new Error(`create contest failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function createProblem(contestId, token, body = {}) {
    const r = await api(`/api/contests/${contestId}/problems`, { method: 'POST', ...json({ code: 'A', name: 'Problem A', visibility: 'visible', ...body }) }, token);
    if (r.status !== 201) throw new Error(`create problem failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function addGroup(problemId, token, group = {}) {
    const r = await api(`/api/problems/${problemId}/tests`, { method: 'POST', ...json({ group: { name: 'all', points: 100, ...group } }) }, token);
    if (r.status !== 201) throw new Error(`add group failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function addCase(problemId, token, testCase = {}) {
    const r = await api(`/api/problems/${problemId}/tests`, { method: 'POST', ...json({ case: testCase }) }, token);
    if (r.status !== 201) throw new Error(`add case failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    if (createdDataDir && !opts.keepData) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  }

  return {
    server, base, dataDir, store,
    api, request, json, loginAs, waitJudged, waitFor,
    createContest, createProblem, addGroup, addCase, close,
  };
}

module.exports = { startServer, makeDataDir, json };
