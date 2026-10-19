// Satori V2 — health, capabilities, discovery, and legacy compatibility routes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { store } = require('../lib/store');
const J = require('../../../../packages/judge/src/judge');
const { send, sendText } = require('../lib/http');

function openapi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Satori V2 API', version: '2.0.0' },
    paths: {
      '/api/auth/token': { post: { summary: 'Login, get JWT+refresh' } },
      '/api/contests': { get: { summary: 'List ?role=joined|pending|managed&q&archived' } },
      '/api/contests/{id}/problems': { get: { summary: 'Problem cockpit + inline verdict chips' } },
      '/api/submits': { post: { summary: 'Submit paste|file|gist (multipart|json)' }, get: { summary: 'Results table ?contest&problem&verdict&me&limit' } },
      '/api/submits/{id}/events': { get: { summary: 'SSE live queued→compiling→testing→judged' } },
      '/api/contests/{id}/rankings/live': { get: { summary: 'WS/SSE live scoreboard + freeze' } },
    },
  };
}

async function handle(req, res, url, p, m) {
  const u = url;
  // health / meta
  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, time: new Date().toISOString(), queue: J.QUEUE.length });
  if (p === '/api/status' && m === 'GET') {
    const avail = J.languageAvailability();
    return send(res, 200, {
      queue: J.QUEUE.length,
      etaSec: J.QUEUE.length * 4,
      etaNote: 'estimate (no worker telemetry yet)',
      workers: ['local-spawn'],
      local: true,
      languages: Object.entries(avail).filter(([, v]) => v).map(([k]) => k),
      missingToolchains: Object.entries(avail).filter(([, v]) => !v).map(([k]) => k),
      maintenance: null,
      sandbox: 'interim local runner — memory limits not enforced yet (docs/JUDGE_SANDBOX.md)',
    });
  }
  if (p === '/api/languages' && m === 'GET') {
    const avail = J.languageAvailability();
    return send(res, 200, { matrix: J.LANGUAGE_MATRIX.map((x) => ({ ...x, available: Boolean(avail[x.lang]) })) });
  }
  if (p === '/api/openapi.json' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', '..', '..', '..', 'openapi.json');
      if (fs.existsSync(f)) return sendText(res, 200, fs.readFileSync(f, 'utf8'), 'application/json; charset=utf-8');
    } catch { /* fallthrough */ }
    return send(res, 200, openapi());
  }
  if (p === '/api/openapi.yaml' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', '..', '..', '..', 'openapi.yaml');
      if (fs.existsSync(f)) return sendText(res, 200, fs.readFileSync(f, 'utf8'), 'text/yaml; charset=utf-8');
    } catch { /* fallthrough */ }
    return send(res, 200, openapi());
  }
  if (p === '/api/orgs' && m === 'GET') return send(res, 200, { items: store.all('organizations') });
  if (p === '/api/search' && m === 'GET') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    if (!q) return send(res, 200, { contests: [], problems: [], users: [], announcements: [] });
    // E8/F2: announcements match title + markdown body; scheduled-future posts
    // are not searchable until they are actually visible.
    const now = Date.now();
    const announcements = store.all('news')
      .filter((n) => {
        const at = Date.parse(n.scheduledAt || '');
        if (Number.isFinite(at) && at > now) return false;
        return `${n.title || ''} ${n.bodyMd || n.bodyHtml || ''}`.toLowerCase().includes(q);
      })
      .map((n) => ({ id: n.id, contestId: n.contestId, title: n.title || '' }))
      .slice(0, 20);
    return send(res, 200, {
      contests: store.all('contests').filter((c) => (c.name + c.description).toLowerCase().includes(q)).slice(0, 20),
      problems: store.all('problems').filter((x) => x.name.toLowerCase().includes(q)).slice(0, 20),
      users: store.all('users').filter((x) => x.login.includes(q)).map((x) => ({ id: x.id, login: x.login })).slice(0, 20),
      announcements,
    });
  }


  let mt;
  // V1 compat redirects (protect CLI-in-source comments: keep /contest/<id>/problems/<pid>)
  mt = p.match(/^\/contest\/(\d+)\/?$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}`, redirect: `/contests/${mt[1]}` });
  mt = p.match(/^\/contest\/(\d+)\/problems(?:\/(\d+))?$/);
  if (mt && m === 'GET') {
    if (mt[2]) {
      const pr = store.get('problems', mt[2]);
      return send(res, 200, { v1: p, v2: `/api/problems/${mt[2]}`, problem: pr });
    }
    return send(res, 302, { v1: p, v2: `/api/contests/${mt[1]}/problems` });
  }
  mt = p.match(/^\/contest\/(\d+)\/ranking\/(\d+)$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}/ranking` });
  mt = p.match(/^\/contest\/(\d+)\/results$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/submits?contest=${mt[1]}` });
  mt = p.match(/^\/subpage\/(\d+)$/);
  if (mt && m === 'GET') {
    const sp = store.get('subpages', mt[1]);
    return send(res, 200, { v1: p, subpage: sp });
  }
  if (p === '/demo' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', 'demo.html');
      return sendText(res, 200, fs.readFileSync(f, 'utf8'));
    } catch { return send(res, 500, { error: { code: 'DEMO', message: 'demo.html missing.', hint: '' } }); }
  }
  if ((p === '/' || p === '/api') && m === 'GET') {
    return sendText(res, 200, `<h1>Satori V2 API</h1><ul><li><a href="/demo">Demo UI (no install)</a></li><li><a href="/api/openapi.json">OpenAPI</a></li><li><a href="/api/health">health</a></li><li><a href="/api/languages">languages</a></li><li><a href="/api/status">status</a></li></ul>`);
  }
  return false;
}

module.exports = { handle, openapi };
