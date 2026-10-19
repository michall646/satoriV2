// Satori V2 — webhook registration, delivery, and delivery log.
'use strict';
const { store } = require('../lib/store');
const { send, readBody } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- webhook delivery (S2-7): POST + timeout + retries with backoff + delivery log ----
const WEBHOOK_TIMEOUT_MS = Number(process.env.SATORI_WEBHOOK_TIMEOUT_MS || 5000);
const WEBHOOK_DELAY_MS = Number(process.env.SATORI_WEBHOOK_DELAY_MS || 500);
const WEBHOOK_ATTEMPTS = Math.max(1, Number(process.env.SATORI_WEBHOOK_ATTEMPTS || 4));
async function deliverToHook(hook, event, body) {
  let lastError = null;
  let lastHttp = null;
  for (let i = 0; i < WEBHOOK_ATTEMPTS; i++) {
    if (i > 0) await sleep(WEBHOOK_DELAY_MS * 2 ** (i - 1));
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Satori-Event': event },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return { ok: true, httpStatus: res.status, attempts: i + 1, ms: Date.now() - started };
      lastHttp = res.status;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastError = String((e && e.message) || e);
    }
  }
  return { ok: false, httpStatus: lastHttp, attempts: WEBHOOK_ATTEMPTS, error: lastError };
}
function pruneDeliveries() {
  const all = store.all('deliveries');
  if (all.length <= 300) return;
  const sorted = [...all].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  store.replaceAll('deliveries', sorted.slice(-300));
}
function fireWebhooks(event, payload) {
  const hooks = store.all('webhooks').filter((h) => (h.events || ['submit.judged']).includes(event));
  if (hooks.length === 0) return;
  const targets = hooks.filter((h) => !h.contestId || (payload.contestId != null && String(h.contestId) === String(payload.contestId)));
  for (const hook of targets) {
    const body = { event, at: new Date().toISOString(), payload };
    deliverToHook(hook, event, body).then((r) => {
      try {
        store.insert('deliveries', {
          hookId: hook.id, contestId: hook.contestId || null, event, url: hook.url,
          ok: r.ok, httpStatus: r.httpStatus || null, attempts: r.attempts,
          error: r.error || null, ms: r.ms || null, at: new Date().toISOString(),
        });
        pruneDeliveries();
      } catch { /* never break judging on a delivery-log write */ }
    }).catch(() => { /* delivery already recorded best-effort */ });
  }
  audit(null, 'webhook.fire', event, { event, contestId: (payload && payload.contestId) || null, targets: targets.length });
}

async function handle(req, res, url, p, m) {
  const u = url;
  let mt = p.match(/^\/api\/contests\/(\d+)\/webhooks$/);
  if (mt && (m === 'GET' || m === 'POST')) {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    if (m === 'GET') return send(res, 200, { items: store.query('webhooks', (h) => String(h.contestId) === String(c.id)) });
    const b = await readBody(req);
    if (!b.url) return send(res, 422, { error: { code: 'URL', message: 'Webhook URL required.', hint: 'https://…' } });
    const row = store.insert('webhooks', { contestId: c.id, url: b.url, events: b.events || ['submit.judged'], by: me.id, at: new Date().toISOString() });
    audit(me.id, 'contest.webhook.register', `contest:${c.id}`, { url: b.url });
    return send(res, 201, row);
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/deliveries$/);
  if (mt && m === 'GET') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const items = store.query('deliveries', (d) => String(d.contestId) === String(c.id))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 50);
    return send(res, 200, { items });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/(\d+)\/ping$/);
  if (mt && m === 'POST') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const hook = store.get('webhooks', mt[2]);
    if (!hook || String(hook.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_HOOK', message: 'Webhook not found.', hint: '' } });
    const result = await deliverToHook(hook, 'ping', { event: 'ping', at: new Date().toISOString(), payload: { contestId: c.id } });
    try {
      store.insert('deliveries', {
        hookId: hook.id, contestId: hook.contestId || null, event: 'ping', url: hook.url,
        ok: result.ok, httpStatus: result.httpStatus || null, attempts: result.attempts,
        error: result.error || null, ms: result.ms || null, at: new Date().toISOString(),
      });
      pruneDeliveries();
    } catch { /* log best-effort */ }
    audit(me.id, 'contest.webhook.ping', `contest:${c.id}`, { url: hook.url, ok: result.ok });
    return send(res, 200, {
      ok: true, delivered: result.ok, httpStatus: result.httpStatus || null,
      attempts: result.attempts, error: result.error || null,
      message: result.ok
        ? `Delivered (HTTP ${result.httpStatus}) in ${result.ms}ms.`
        : `Delivery failed after ${result.attempts} attempt(s): ${result.error || `HTTP ${result.httpStatus}`}`,
    });
  }
  mt = p.match(/^\/api\/contests\/(\d+)\/webhooks\/(\d+)$/);
  if (mt && m === 'DELETE') {
    const c = store.get('contests', mt[1]);
    if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
    const me = needAuth(req, res);
    if (!me) return true;
    if (!canManageContest(me, c)) return forbid(res);
    const hook = store.get('webhooks', mt[2]);
    if (!hook || String(hook.contestId) !== String(c.id)) return send(res, 404, { error: { code: 'NO_HOOK', message: 'Webhook not found.', hint: '' } });
    store.remove('webhooks', hook.id);
    audit(me.id, 'contest.webhook.delete', `contest:${c.id}`, { url: hook.url });
    return send(res, 200, { ok: true, deleted: true });
  }

  if (p === '/api/webhooks' && m === 'GET') return send(res, 200, { items: store.all('webhooks') });
  if (p === '/api/webhooks' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    return send(res, 201, store.insert('webhooks', { url: b.url, events: b.events || ['submit.judged'], by: me.id }));
  }
  return false;
}

module.exports = { handle, deliverToHook, fireWebhooks, pruneDeliveries };
