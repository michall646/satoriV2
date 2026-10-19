// Lane T / G4 depth: IndexedDB outbox contract, legacy localStorage migration,
// and source guards for the offline submit path.
//
// Node has no indexedDB, so these tests exercise the in-memory fallback. The
// localStorage shim exists only to test the one-way migration off the old queue.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  OUTBOX_DB,
  OUTBOX_STORE,
  LEGACY_KEY,
  queueSubmit,
  listPending,
  pendingCount,
  flushOutbox,
  clearOutbox,
} = require('../apps/web/lib/outbox.js');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const PUBLIC = path.join(WEB, 'public');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
      setItem: (key, value) => { map.set(String(key), String(value)); },
      removeItem: (key) => { map.delete(String(key)); },
      clear: () => { map.clear(); },
    },
  });
  return map;
}

function setNavigator(online) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { onLine: online },
  });
}

beforeEach(async () => {
  installStorage();
  setNavigator(true);
  await clearOutbox();
});

test('outbox declares the IndexedDB schema (id key + createdAt index)', () => {
  assert.equal(OUTBOX_DB, 'satori-outbox');
  assert.equal(OUTBOX_STORE, 'submits');
  const source = read(WEB, 'lib', 'outbox.js');
  assert.match(source, /createObjectStore\(STORE,\s*\{\s*keyPath:\s*'id'\s*\}\)/);
  assert.match(source, /createIndex\('createdAt',\s*'createdAt'\)/);
});

test('queue/list/count keep the submit and its offline metadata', async () => {
  assert.equal(await pendingCount(), 0);

  const id = await queueSubmit({
    url: '/api/problems/7/submit',
    body: { code: 'int main(){}', filename: 'a.cpp' },
    lang: 'C++17',
    contestId: 3,
    problemId: 7,
  });

  assert.ok(id, 'queueSubmit returns the item id');
  const items = await listPending();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, id);
  assert.equal(items[0].url, '/api/problems/7/submit');
  assert.equal(items[0].method, 'POST');
  assert.equal(items[0].body, JSON.stringify({ code: 'int main(){}', filename: 'a.cpp' }));
  assert.equal(items[0].lang, 'C++17');
  assert.equal(items[0].contestId, 3);
  assert.equal(items[0].problemId, 7);
  assert.equal(typeof items[0].createdAt, 'number');
  assert.ok(items[0].idempotencyKey, 'a forward-compatible idempotency key is stored');
  assert.equal(await pendingCount(), 1);
});

test('queueSubmit without a url is a no-op', async () => {
  assert.equal(await queueSubmit({ body: {} }), null);
  assert.equal(await pendingCount(), 0);
});

test('flushOutbox sends in order, respects limit and reports remaining', async () => {
  await queueSubmit({ url: '/api/problems/1/submit', body: { n: 1 } });
  await queueSubmit({ url: '/api/problems/2/submit', body: { n: 2 } });
  await queueSubmit({ url: '/api/problems/3/submit', body: { n: 3 } });

  const calls = [];
  const during = await flushOutbox(async (url, opts) => {
    calls.push({ url, opts });
    return { id: calls.length };
  }, { limit: 1 });

  assert.deepEqual(during, { sent: 1, failed: 0, remaining: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/problems/1/submit');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.body, JSON.stringify({ n: 1 }));
  assert.ok(calls[0].opts.headers['Idempotency-Key']);

  const rest = await flushOutbox(async (url) => ({ url }));
  assert.deepEqual(rest, { sent: 2, failed: 0, remaining: 0 });
  assert.equal(await pendingCount(), 0);
});

test('failed items stay queued for the next online window', async () => {
  await queueSubmit({ url: '/api/problems/1/submit', body: {} });
  await queueSubmit({ url: '/api/problems/2/submit', body: {} });

  const result = await flushOutbox(async (url) => {
    if (url.endsWith('/1/submit')) throw new Error('network down');
    return { ok: true };
  });

  assert.deepEqual(result, { sent: 1, failed: 1, remaining: 1 });
  const items = await listPending();
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/api/problems/1/submit');
});

test('flushOutbox leaves the queue alone while offline', async () => {
  await queueSubmit({ url: '/api/problems/1/submit', body: {} });
  setNavigator(false);

  let calls = 0;
  const result = await flushOutbox(async () => { calls += 1; });

  assert.deepEqual(result, { sent: 0, failed: 0, remaining: 1 });
  assert.equal(calls, 0);
  assert.equal(await pendingCount(), 1);
});

test('concurrent flush calls do not double-send (best effort)', async () => {
  await queueSubmit({ url: '/api/problems/1/submit', body: {} });

  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const apiFn = async () => {
    calls += 1;
    await gate;
    return { ok: true };
  };

  const first = flushOutbox(apiFn);
  const second = flushOutbox(apiFn);
  release();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1, 'only one request for one queued item');
  assert.deepEqual(a, { sent: 1, failed: 0, remaining: 0 });
  assert.deepEqual(b, a);
  assert.equal(await pendingCount(), 0);
});

test('clearOutbox empties the queue and the legacy key', async () => {
  await queueSubmit({ url: '/api/problems/1/submit', body: {} });
  await queueSubmit({ url: '/api/problems/2/submit', body: {} });
  globalThis.localStorage.setItem(LEGACY_KEY, '[]');

  await clearOutbox();

  assert.equal(await pendingCount(), 0);
  assert.deepEqual(await listPending(), []);
  assert.equal(globalThis.localStorage.getItem(LEGACY_KEY), null);
});

test('migrates the old localStorage queue once, then removes the key', async () => {
  globalThis.localStorage.setItem(LEGACY_KEY, JSON.stringify([
    {
      url: '/api/problems/7/submit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"code":"old"}',
      at: '2026-01-01T00:00:00.000Z',
    },
    {
      url: '/api/problems/8/submit',
      body: { code: 'newer' },
      at: '2026-01-01T00:00:01.000Z',
    },
  ]));

  const items = await listPending();
  assert.equal(items.length, 2);
  assert.equal(items[0].url, '/api/problems/7/submit');
  assert.equal(items[0].body, '{"code":"old"}');
  assert.equal(items[1].body, JSON.stringify({ code: 'newer' }));
  assert.ok(items[0].idempotencyKey);
  assert.ok(items[1].idempotencyKey);
  assert.equal(globalThis.localStorage.getItem(LEGACY_KEY), null);

  // Already migrated: a second read must not duplicate the items.
  assert.equal((await listPending()).length, 2);
});

test('submit page awaits the IndexedDB queue and never writes the old key', () => {
  const submit = read(WEB, 'app', 'contests', '[id]', 'problems', '[pid]', 'submit', 'page.js');
  assert.match(submit, /await queueSubmit\(\{/);
  assert.match(submit, /await pendingCount\(/);
  assert.match(submit, /queuedOfflineMessage/);
  assert.ok(!/localStorage\.(setItem|getItem)/.test(submit), 'submit path must not use the old localStorage queue');
  assert.ok(!submit.includes(LEGACY_KEY), 'submit path must not mention the legacy key');
});

test('PwaControls awaits the outbox and exposes a flushing state', () => {
  const controls = read(WEB, 'components', 'PwaControls.js');
  assert.match(controls, /await pendingCount\(/);
  assert.match(controls, /await flushOutbox\(/);
  assert.match(controls, /aria-busy=\{flushing\}/);
  assert.match(controls, /flushingRef\.current/);
  assert.ok(!/addEventListener\(\s*['"]sync['"]/.test(controls), 'no fake background-sync claim');
});

test('service worker keeps private endpoints out and uses the right strategies', () => {
  const sw = read(PUBLIC, 'sw.js');

  for (const privatePath of ['/api/me', '/api/submits', '/api/notifications', '/api/grades', '/api/admin']) {
    assert.ok(!sw.includes(privatePath), `sw.js must not cache ${privatePath}`);
  }
  assert.ok(!/addEventListener\(\s*['"]sync['"]/.test(sw), 'no unimplemented background sync');
  assert.ok(!sw.includes(LEGACY_KEY), 'the worker cannot read the legacy localStorage queue');

  assert.match(sw, /staleWhileRevalidate/, 'public lists use stale-while-revalidate');
  assert.match(sw, /networkFirstData/, 'statements use network-first with a cached fallback');
  assert.match(sw, /cacheFirstStatic/, 'offline page and icons use cache-first');
  assert.match(sw, /OFFLINE_URL\s*=\s*'\/offline\.html'/);
  assert.match(sw, /apple-touch-icon\.png/);
});

test('apple-touch-icon is a real 180x180 PNG and is precached', () => {
  const png = fs.readFileSync(path.join(PUBLIC, 'apple-touch-icon.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  assert.equal(png.readUInt32BE(16), 180, 'PNG width');
  assert.equal(png.readUInt32BE(20), 180, 'PNG height');

  const sw = read(PUBLIC, 'sw.js');
  assert.match(sw, /SHELL_URLS\s*=\s*\[[^\]]*apple-touch-icon\.png/);
});
