// Lane N / G4: real PWA install surface + offline submit outbox.
// Static checks are filesystem-only; outbox checks use a localStorage shim and
// a mock api function, so no server or browser is required.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { OUTBOX_KEY, queueSubmit, pendingCount, flushOutbox } = require('../apps/web/lib/outbox.js');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const PUBLIC = path.join(WEB, 'public');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

function exists(...parts) {
  return fs.existsSync(path.join(...parts));
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

beforeEach(() => {
  installStorage();
  setNavigator(true);
});

test('public manifest is valid and installable', () => {
  const manifest = JSON.parse(read(PUBLIC, 'manifest.json'));

  assert.equal(manifest.name, 'Satori V2');
  assert.ok(manifest.short_name, 'short_name is required');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'), '192px icon is required');
  assert.ok(sizes.includes('512x512'), '512px icon is required');
  assert.ok(manifest.icons.some((icon) => /maskable/.test(icon.purpose || '')), 'a maskable icon is required');
});

test('every manifest icon exists and is an SVG (no fake PNG)', () => {
  const manifest = JSON.parse(read(PUBLIC, 'manifest.json'));
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/'), `icon src must be root-relative: ${icon.src}`);
    assert.equal(icon.type, 'image/svg+xml');
    assert.ok(!icon.src.endsWith('.png'), `do not reference an ungenerated PNG: ${icon.src}`);
    const file = path.join(PUBLIC, icon.src.slice(1));
    assert.ok(fs.existsSync(file), `missing icon file ${icon.src}`);
    assert.match(fs.readFileSync(file, 'utf8'), /<svg[\s>]/, `${icon.src} is not SVG`);
  }
});

test('manifest and service worker moved out of app/ (public/ is what Next serves)', () => {
  assert.equal(exists(WEB, 'app', 'manifest.json'), false);
  assert.equal(exists(WEB, 'app', 'sw.js'), false);
  assert.equal(exists(PUBLIC, 'manifest.json'), true);
  assert.equal(exists(PUBLIC, 'sw.js'), true);
});

test('layout points metadata at /manifest.json and mounts the registration', () => {
  const layout = read(WEB, 'app', 'layout.js');
  assert.match(layout, /manifest:\s*'\/manifest\.json'/);
  assert.match(layout, /ServiceWorkerRegister/);
  assert.match(layout, /from '\.\.\/components\/PwaControls'/);
});

test('service worker registration is scoped to / and handles updates once', () => {
  const controls = read(WEB, 'components', 'PwaControls.js');
  assert.match(
    controls,
    /serviceWorker\.register\('\/sw\.js',\s*\{\s*scope:\s*'\/'\s*\}\)/,
    'registration must use /sw.js with scope /',
  );
  assert.match(controls, /updatefound/);
  assert.match(controls, /controllerchange/);
  assert.match(controls, /pendingCount/);
  assert.match(controls, /flushOutbox/);
});

test('service worker caches only public reads and never private endpoints', () => {
  const sw = read(PUBLIC, 'sw.js');
  const flat = sw.replace(/\\\//g, '/');

  assert.match(sw, /staleWhileRevalidate/);
  assert.match(flat, /\/api\/contests/);
  assert.match(flat, /\/api\/problems/);
  assert.match(sw, /offline\.html/);
  assert.match(sw, /authorization/i, 'authenticated requests must be bypassed');
  assert.match(sw, /no-store|private/i, 'responses marked private/no-store must be skipped');

  // These must never appear as cache rules in the worker.
  for (const privatePath of ['/api/me', '/api/submits', '/api/notifications', '/api/grades', '/api/admin']) {
    assert.ok(!flat.includes(privatePath), `sw.js must not cache ${privatePath}`);
  }

  // Outbox lives in localStorage; the worker must not pretend it can sync it.
  assert.ok(!/addEventListener\(\s*['"]sync['"]/.test(sw), 'no unimplemented background sync');
  assert.ok(!sw.includes('satori-pending'), 'service worker cannot read the localStorage outbox');
});

test('offline fallback page exists and is precached', () => {
  const html = read(PUBLIC, 'offline.html');
  assert.match(html, /Brak połączenia|Offline/i);
  const sw = read(PUBLIC, 'sw.js');
  assert.match(sw, /OFFLINE_URL\s*=\s*'\/offline\.html'/);
  assert.match(sw, /SHELL_URLS\s*=\s*\[[^\]]*OFFLINE_URL/);
});

test('queueSubmit stores url + body and pendingCount reflects the queue', () => {
  assert.equal(pendingCount(), 0);

  const first = queueSubmit({ url: '/api/problems/7/submit', body: { code: 'int main(){}', filename: 'a.cpp' } });
  const second = queueSubmit({ url: '/api/problems/8/submit', body: '{"code":"x"}' });

  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(pendingCount(), 2);

  const stored = JSON.parse(globalThis.localStorage.getItem(OUTBOX_KEY));
  assert.equal(stored[0].url, '/api/problems/7/submit');
  assert.equal(stored[0].method, 'POST');
  assert.deepEqual(JSON.parse(stored[0].body), { code: 'int main(){}', filename: 'a.cpp' });
  assert.equal(stored[1].body, '{"code":"x"}');
});

test('flushOutbox replays queued submits through api and empties the queue', async () => {
  queueSubmit({ url: '/api/problems/7/submit', body: { code: 'a', filename: 'a.cpp', language: 'C++17' } });
  const calls = [];

  const left = await flushOutbox(async (url, opts) => {
    calls.push({ url, opts });
    return { id: 1, status: 'QUE' };
  });

  assert.equal(left, 0);
  assert.equal(pendingCount(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/problems/7/submit');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { code: 'a', filename: 'a.cpp', language: 'C++17' });
});

test('flushOutbox keeps failed items for a later retry', async () => {
  queueSubmit({ url: '/api/problems/1/submit', body: {} });
  queueSubmit({ url: '/api/problems/2/submit', body: {} });

  let n = 0;
  const left = await flushOutbox(async () => {
    n += 1;
    if (n === 1) throw new Error('network down');
    return { ok: true };
  });

  assert.equal(left, 1);
  assert.equal(pendingCount(), 1);
  const stored = JSON.parse(globalThis.localStorage.getItem(OUTBOX_KEY));
  assert.equal(stored[0].url, '/api/problems/1/submit');
});

test('flushOutbox does nothing while navigator.onLine is false', async () => {
  queueSubmit({ url: '/api/problems/1/submit', body: {} });
  setNavigator(false);
  let calls = 0;

  const left = await flushOutbox(async () => { calls += 1; });

  assert.equal(left, 1);
  assert.equal(calls, 0);
  assert.equal(pendingCount(), 1);
});

test('submit page queues offline instead of showing a fake success', () => {
  const submit = read(WEB, 'app', 'contests', '[id]', 'problems', '[pid]', 'submit', 'page.js');
  assert.match(submit, /import \{ queueSubmit \} from/);
  assert.match(submit, /navigator\.onLine\s*===\s*false/);
  assert.match(submit, /queueSubmit\(\{ url, body \}\)/);
  assert.match(submit, /queuedOfflineMessage/);
});
