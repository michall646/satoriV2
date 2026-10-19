// Offline submit outbox: queue when offline -> auto-send on reconnect. Guard clauses.
'use client';

const KEY = 'satori-pending';

export function queueSubmit({ url, body }) {
  try {
    const cur = JSON.parse(localStorage.getItem(KEY) || '[]');
    cur.push({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch { /* noop */ }
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) navigator.serviceWorker.ready.then((r) => r.sync.register('satori-outbox').catch(() => {}));
  } catch { /* noop */ }
}

export function pendingCount() {
  try { return (JSON.parse(localStorage.getItem(KEY) || '[]') || []).length; } catch { return 0; }
}

export async function flushOutbox(apiFn) {
  let items;
  try { items = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return 0; }
  if (!items.length) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return items.length;
  const rest = [];
  for (const it of items) {
    try { await apiFn(it.url, { method: 'POST', body: it.body }); }
    catch { rest.push(it); }
  }
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* noop */ }
  return rest.length;
}
