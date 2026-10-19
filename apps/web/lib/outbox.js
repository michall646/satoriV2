// Offline submit outbox: queue in localStorage, flush from the page on reconnect.
// The service worker cannot read localStorage, so there is no background-sync
// claim here; PwaControls flushes on `online` and on mount.
'use client';

const KEY = 'satori-pending';

function getStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readQueue() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.url === 'string' && item.url);
  } catch {
    return [];
  }
}

function writeQueue(items) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full or disabled */
  }
}

function normalizeBody(body) {
  return typeof body === 'string' ? body : JSON.stringify(body == null ? {} : body);
}

function queueSubmit({ url, body } = {}) {
  if (!url) return pendingCount();
  const items = readQueue();
  items.push({
    url: String(url),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: normalizeBody(body),
    at: new Date().toISOString(),
  });
  writeQueue(items);
  return items.length;
}

function pendingCount() {
  return readQueue().length;
}

async function flushOutbox(apiFn) {
  const items = readQueue();
  if (!items.length) return 0;
  if (typeof apiFn !== 'function') return items.length;
  // Offline: leave the queue untouched. The `online` handler calls us again.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return items.length;

  const rest = [];
  for (const item of items) {
    try {
      // api() attaches the current token and Content-Type.
      await apiFn(item.url, { method: item.method || 'POST', body: item.body });
    } catch {
      rest.push(item);
    }
  }
  writeQueue(rest);
  return rest.length;
}

module.exports = { OUTBOX_KEY: KEY, queueSubmit, pendingCount, flushOutbox };
