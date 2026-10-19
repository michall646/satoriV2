/*
 * Satori V2 service worker.
 *
 * Scope: app shell + public, read-only API data (contest list, contest problem
 * cockpit, problem statements/samples). Responses requested with credentials
 * never enter the shared cache, so a member's view cannot leak to the next
 * request. The submit outbox lives in localStorage and is flushed by the page;
 * a service worker cannot read localStorage, so this file deliberately makes
 * no background-sync claim.
 */
'use strict';

const VERSION = 'satori-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const SHELL_URLS = ['/', OFFLINE_URL, '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

// Exact public reads only. Prefix matching would also capture /tests, /submit,
// /best and other authenticated routes.
const PUBLIC_API = [
  /^\/api\/contests$/,
  /^\/api\/contests\/\d+\/problems$/,
  /^\/api\/problems\/\d+$/,
];

function isPublicApi(pathname) {
  return PUBLIC_API.some((re) => re.test(pathname));
}

// A bearer token (or a cookie) means the response may be personalized.
function hasPrivateHeaders(request) {
  return request.headers.has('authorization') || request.headers.has('cookie');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll would be atomic: one transient 404 would drop the whole shell,
    // so add entries individually and keep whatever succeeded.
    await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, DATA_CACHE, STATIC_CACHE]);
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith('satori-') && !keep.has(key)).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function putIfCacheable(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cacheControl = response.headers.get('cache-control') || '';
  if (/no-store|private/i.test(cacheControl)) return;
  const cache = await caches.open(DATA_CACHE);
  await cache.put(request, response.clone());
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      await putIfCacheable(request, response);
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;
  return new Response(
    JSON.stringify({
      error: {
        code: 'OFFLINE',
        message: 'Offline and no cached copy.',
        hint: 'Reconnect to load this view.',
      },
    }),
    { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

// Hashed Next.js chunks are immutable and public: cache-first makes the shell
// usable offline after the first visit.
async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

// Pages are never cached; a failed navigation falls back to the cached shell
// page so the user sees an honest offline screen instead of a browser error.
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><h1>Offline</h1>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isPublicApi(url.pathname)) {
    if (hasPrivateHeaders(request)) return;
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
  }
});
