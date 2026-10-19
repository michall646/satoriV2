// Satori V2 — webhook registration, delivery, SSRF guard, signing, and delivery log.
'use strict';
const { store } = require('../lib/store');
const { send, readBody, assertSafeWebhookUrl, postJsonPinned, signWebhook } = require('../lib/http');
const { needAuth, forbid, canManageContest, audit } = require('../lib/authz');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function isSuper(me) { return Boolean(me && (me.rolesGlobal || []).includes('superadmin')); }
function hookUrlError(res, safe) {
  return send(res, 422, { error: { code: safe.code || 'URL', message: safe.message, hint: safe.hint } });
}

// ---- webhook delivery (S2-7): POST + timeout + retries with backoff + delivery log ----
const WEBHOOK_TIMEOUT_MS = Number(process.env.SATORI_WEBHOOK_TIMEOUT_MS || 5000);
const WEBHOOK_DELAY_MS = Number(process.env.SATORI_WEBHOOK_DELAY_MS || 500);
const WEBHOOK_ATTEMPTS = Math.max(1, Number(process.env.SATORI_WEBHOOK_ATTEMPTS || 4));
async function deliverToHook(hook, event, body) {
  // A4: validate again at delivery time so a DNS record cannot be rebound after registration.
  const safe = await assertSafeWebhookUrl(hook.url);
  if (!safe.ok) return { ok: false, httpStatus: null, attempts: 0, error: `blocked: ${safe.code}` };
  const raw = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'X-Satori-Event': event };
  const signature = signWebhook(raw);
  if (signature) headers['X-Satori-Signature'] = signature;
  let lastError = null;
  let lastHttp = null;
  for (let i = 0; i < WEBHOOK_ATTEMPTS; i++) {
    if (i > 0) await sleep(WEBHOOK_DELAY_MS * 2 ** (i - 1));
    const started = Date.now();
    const result = await postJsonPinned(safe, raw, headers, WEBHOOK_TIMEOUT_MS);
    if (result.ok) return { ok: true, httpStatus: result.httpStatus, attempts: i + 1, ms: result.ms || (Date.now() - started) };
    lastHttp = result.httpStatus || null;
    lastError = result.error || `HTTP ${result.httpStatus}`;
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
    const safe = await assertSafeWebhookUrl(b.url);
    if (!safe.ok) return hookUrlError(res, safe);
    const row = store.insert('webhooks', { contestId: c.id, url: safe.url.toString(), events: b.events || ['submit.judged'], by: me.id, at: new Date().toISOString() });
    audit(me.id, 'contest.webhook.register', `contest:${c.id}`, { url: row.url });
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

  // Global hooks: A5 — auth required, visible only to superadmins or the contest's admins.
  if (p === '/api/webhooks' && m === 'GET') {
    const me = needAuth(req, res);
    if (!me) return true;
    const canSee = (h) => {
      if (h.contestId == null) return isSuper(me);
      const c = store.get('contests', h.contestId);
      return Boolean(c) && canManageContest(me, c);
    };
    return send(res, 200, { items: store.all('webhooks').filter(canSee) });
  }
  if (p === '/api/webhooks' && m === 'POST') {
    const me = needAuth(req, res);
    if (!me) return true;
    const b = await readBody(req);
    const contestId = b.contestId != null && b.contestId !== '' ? b.contestId : null;
    if (contestId == null && !isSuper(me)) return forbid(res);
    if (contestId != null) {
      const c = store.get('contests', contestId);
      if (!c) return send(res, 404, { error: { code: 'NO_CONTEST', message: 'Contest not found.', hint: '' } });
      if (!canManageContest(me, c)) return forbid(res);
    }
    if (!b.url) return send(res, 422, { error: { code: 'URL', message: 'Webhook URL required.', hint: 'https://…' } });
    const safe = await assertSafeWebhookUrl(b.url);
    if (!safe.ok) return hookUrlError(res, safe);
    const row = store.insert('webhooks', {
      contestId: contestId != null ? (Number(contestId) || contestId) : null,
      url: safe.url.toString(), events: b.events || ['submit.judged'], by: me.id, at: new Date().toISOString(),
    });
    audit(me.id, 'webhook.register', row.contestId ? `contest:${row.contestId}` : 'global', { url: row.url });
    return send(res, 201, row);
  }
  return false;
}

module.exports = { handle, deliverToHook, fireWebhooks, pruneDeliveries };
