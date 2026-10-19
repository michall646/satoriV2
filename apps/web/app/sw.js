// PWA: statements/samples precache, SWR scoreboards, offline submit outbox -> auto-send.
const CACHE = 'satori-v2-2';
const PRECACHE = ['/', '/contests', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function swr(req, ttlMs = 15000) {
  return caches.open(CACHE).then(async (c) => {
    const cached = await c.match(req);
    const fresh = fetch(req).then((r) => {
      if (r.ok) c.put(req, r.clone());
      return r;
    }).catch(() => cached);
    if (!cached) return fresh;
    const date = cached.headers?.get?.('date');
    const age = date ? Date.now() - new Date(date).getTime() : Infinity;
    if (age > ttlMs) { fresh.catch(() => {}); }
    return cached;
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.includes('/api/ranking') || url.pathname.includes('/api/contests')) {
    e.respondWith(swr(e.request, 15000));
    return;
  }
  if (url.pathname.includes('/api/problems') || url.pathname.includes('/api/contests')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      try { const r = await fetch(e.request); c.put(e.request, r.clone()); return r; }
      catch { const hit = await c.match(e.request); return hit || Response.error(); }
    }));
  }
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'satori-outbox') e.waitUntil(flushOutbox());
});

async function flushOutbox() {
  const all = await caches.open(CACHE).then((c) => c.match('satori-outbox')).then((r) => (r ? r.json() : [])).catch(() => []);
  const rest = [];
  for (const item of all) {
    try {
      const r = await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
      if (!r.ok) rest.push(item);
    } catch { rest.push(item); }
  }
  await caches.open(CACHE).then((c) => c.put('satori-outbox', new Response(JSON.stringify(rest))));
  const clients = await self.clients.matchAll();
  clients.forEach((cl) => cl.postMessage({ type: 'outbox-flushed', pending: rest.length }));
}
