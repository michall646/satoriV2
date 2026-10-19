// Offline submit outbox backed by IndexedDB, with an in-memory fallback for
// environments without indexedDB (Node tests, private mode, broken browsers).
//
// Scope: the queue belongs to this browser profile, not to a user account. It is
// not encrypted and it is replayed with whatever credentials the caller's api()
// uses at flush time. Do not treat it as per-user isolation.
//
// At-least-once: an item is removed only after api() resolves. A crash between
// the server accepting a submit and the local delete can replay it. Every item
// carries a random idempotencyKey, but the API does not deduplicate yet, so the
// key is a forward-compatible hint, not a guarantee.
'use client';

const DB_NAME = 'satori-outbox';
const DB_VERSION = 1;
const STORE = 'submits';
const LEGACY_KEY = 'satori-pending';
const DEFAULT_LIMIT = 100;

const memory = new Map();
let dbPromise = null;
let migrationInFlight = null;
let flushInFlight = null;
let lastCreatedAt = 0;

// Keep enqueue order stable when several submits land in the same millisecond.
function nextCreatedAt() {
  const now = Date.now();
  lastCreatedAt = Math.max(now, lastCreatedAt + 1);
  return lastCreatedAt;
}

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through to Math.random */
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function getIndexedDb() {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function normalizeBody(body) {
  return typeof body === 'string' ? body : JSON.stringify(body == null ? {} : body);
}

function normalizeLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.floor(n);
}

function sortItems(a, b) {
  const at = Number(a && a.createdAt) || 0;
  const bt = Number(b && b.createdAt) || 0;
  if (at !== bt) return at - bt;
  return String(a && a.id).localeCompare(String(b && b.id));
}

// Open once. Any failure (missing API, blocked upgrade, thrown open) resolves to
// null; callers then use the in-memory store. Opening never throws.
function openDb() {
  if (dbPromise) return dbPromise;

  const idb = getIndexedDb();
  if (!idb) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    let settled = false;
    function done(db) {
      if (settled) return;
      settled = true;
      resolve(db || null);
    }

    let request;
    try {
      request = idb.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }

    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE)
          ? request.transaction.objectStore(STORE)
          : db.createObjectStore(STORE, { keyPath: 'id' });
        if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
      } catch {
        /* a broken upgrade falls back to memory below when operations fail */
      }
    };
    request.onsuccess = () => done(request.result);
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
  });

  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function dbAll(db) {
  const tx = db.transaction(STORE, 'readonly');
  const rows = await requestResult(tx.objectStore(STORE).getAll());
  await txDone(tx);
  return Array.isArray(rows) ? rows : [];
}

async function rawPut(item) {
  const db = await openDb();
  if (!db) {
    memory.set(item.id, item);
    return;
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    await txDone(tx);
  } catch {
    // Never lose the submission just because the store failed mid-write.
    memory.set(item.id, item);
  }
}

async function rawAll() {
  const db = await openDb();
  const byId = new Map(memory);
  if (db) {
    try {
      for (const row of await dbAll(db)) {
        if (row && row.id) byId.set(row.id, row);
      }
    } catch {
      /* keep the in-memory rows */
    }
  }
  return [...byId.values()].sort(sortItems);
}

async function rawDelete(id) {
  memory.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } catch {
    /* a failed delete replays the item; at-least-once is intentional */
  }
}

function normalizeLegacy(item, index) {
  if (!item || typeof item.url !== 'string' || !item.url) return null;
  const at = Number(item.createdAt) || Date.parse(item.at) || Date.now() + index;
  const normalized = {
    id: typeof item.id === 'string' && item.id ? item.id : randomId(),
    url: String(item.url),
    method: String(item.method || 'POST').toUpperCase(),
    body: normalizeBody(item.body),
    createdAt: at,
    idempotencyKey: typeof item.idempotencyKey === 'string' && item.idempotencyKey
      ? item.idempotencyKey
      : randomId(),
  };
  if (item.lang) normalized.lang = String(item.lang);
  if (item.contestId != null) normalized.contestId = item.contestId;
  if (item.problemId != null) normalized.problemId = item.problemId;
  return normalized;
}

// The old release kept the queue in localStorage. Import it once, then remove
// the key. Re-checking the key on each ready() keeps this idempotent for the
// current document, and concurrent callers share one in-flight import. Two tabs
// that race before either removes the key may both import; this is best-effort,
// not a distributed lock.
async function doMigrateLegacy() {
  const storage = getStorage();
  if (!storage) return;

  let raw;
  try {
    raw = storage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const legacy = Array.isArray(parsed) ? parsed : [];
  for (let i = 0; i < legacy.length; i += 1) {
    const item = normalizeLegacy(legacy[i], i);
    if (item) await rawPut(item);
  }

  try {
    storage.removeItem(LEGACY_KEY);
  } catch {
    /* storage disabled: the same items are already in IndexedDB */
  }
}

function migrateLegacy() {
  if (!migrationInFlight) {
    migrationInFlight = doMigrateLegacy()
      .catch(() => {})
      .finally(() => { migrationInFlight = null; });
  }
  return migrationInFlight;
}

async function ready() {
  await openDb();
  await migrateLegacy();
}

async function queueSubmit({ url, body, lang, contestId, problemId } = {}) {
  if (!url) return null;

  await ready();
  const item = {
    id: randomId(),
    url: String(url),
    method: 'POST',
    body: normalizeBody(body),
    createdAt: nextCreatedAt(),
    idempotencyKey: randomId(),
  };
  if (lang) item.lang = String(lang);
  if (contestId != null) item.contestId = contestId;
  if (problemId != null) item.problemId = problemId;

  await rawPut(item);
  return item.id;
}

async function listPending() {
  await ready();
  return rawAll();
}

async function pendingCount() {
  return (await listPending()).length;
}

async function flushOutbox(apiFn, { limit } = {}) {
  if (typeof apiFn !== 'function') {
    return { sent: 0, failed: 0, remaining: await pendingCount() };
  }
  if (isOffline()) {
    return { sent: 0, failed: 0, remaining: await pendingCount() };
  }
  // Best-effort guard against two components flushing the same items at once.
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    await ready();
    const batch = (await rawAll()).slice(0, normalizeLimit(limit));
    let sent = 0;
    let failed = 0;

    for (const item of batch) {
      try {
        // api() attaches the current token and Content-Type. The key is only a
        // hint until the API implements server-side deduplication.
        await apiFn(item.url, {
          method: item.method || 'POST',
          body: item.body,
          headers: { 'Idempotency-Key': item.idempotencyKey },
        });
        await rawDelete(item.id);
        sent += 1;
      } catch {
        failed += 1;
      }
    }

    return { sent, failed, remaining: (await rawAll()).length };
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
}

async function clearOutbox() {
  await ready();
  memory.clear();

  const db = await openDb();
  if (db) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await txDone(tx);
    } catch {
      /* fall back to memory clear below */
    }
  }

  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(LEGACY_KEY);
    } catch {
      /* storage disabled */
    }
  }
}

module.exports = {
  OUTBOX_DB: DB_NAME,
  OUTBOX_STORE: STORE,
  OUTBOX_KEY: LEGACY_KEY, // backwards-compatible alias for the old key name
  LEGACY_KEY,
  queueSubmit,
  listPending,
  pendingCount,
  flushOutbox,
  clearOutbox,
};
