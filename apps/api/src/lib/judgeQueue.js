// Satori V2 — main-thread dispatcher for the async judge worker (C9, D8).
//
// The API event loop must never run `spawnSync`. Judging happens in one
// persistent `worker_threads` worker; this module owns the queue, the worker
// lifecycle, retries, and the bridge that forwards worker events to SSE clients.
// `J.QUEUE` remains the single main-thread queue so existing callers
// (`createSubmit`, rejudge/generate routes, `/api/status`) keep working.
'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { store, DATA_DIR } = require('./store');
const J = require('../../../../packages/judge/src/judge');

const THREAD_PATH = path.join(__dirname, 'judgeThread.js');
const TERMINAL = new Set(['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE']);
const MAX_INFRA_RETRIES = 1;

// C9 + JSON store: the worker and the API share one data dir. Without a lock,
// the API can `readFileSync` submits.json while the worker renames its temp
// file over it (EPERM on Windows) and concurrent writes can lose rows. A shared
// Int32 lock serializes every store call in both threads. Holds are short and
// synchronous, so blocking is bounded by one file read/write.
const STORE_LOCK_BUFFER = new SharedArrayBuffer(4);
const STORE_LOCK = new Int32Array(STORE_LOCK_BUFFER);
const STORE_METHODS = ['all', 'get', 'insert', 'update', 'remove', 'query', 'replaceAll'];

function lockedStore(storeApi, lock) {
  let depth = 0; // synchronous reentrancy: a query predicate may call store again
  for (const name of STORE_METHODS) {
    const original = storeApi[name];
    if (typeof original !== 'function' || original.__satoriLocked) continue;
    const wrapped = function locked(...args) {
      if (depth > 0) {
        depth += 1;
        try { return original.apply(this, args); } finally { depth -= 1; }
      }
      const deadline = Date.now() + 10000;
      for (;;) {
        if (Atomics.compareExchange(lock, 0, 0, 1) === 0) break;
        if (Date.now() >= deadline) {
          // A terminated worker could not release a store call. Storage calls
          // are milliseconds, so after 10s the owner is gone; take it and go.
          console.error('[judgeQueue] store lock timeout; assuming stale owner');
          Atomics.store(lock, 0, 1);
          break;
        }
        Atomics.wait(lock, 0, 1, 25);
      }
      depth = 1;
      try { return original.apply(this, args); } finally {
        depth = 0;
        Atomics.store(lock, 0, 0);
        Atomics.notify(lock, 0, 1);
      }
    };
    wrapped.__satoriLocked = true;
    storeApi[name] = wrapped;
  }
  return storeApi;
}

// Patch before any route module is loaded (server requires judgeQueue first).
lockedStore(store, STORE_LOCK);

let WORKER = null;
let BUSY = false;
let DRAIN = null;
let PENDING = null;
const RETRIES = new Map(); // submitId -> infrastructure retries used

function queueSize() {
  return J.QUEUE.length;
}

function queuePosition(submitId) {
  return J.queuePosition(submitId);
}

function contains(id) {
  const n = Number(id);
  return J.QUEUE.some((x) => Number(x) === n);
}

// One worker per process; it is reused across submissions so the thread and
// its module cache (compiler probes) are paid once. `unref()` lets a short-lived
// test process exit without waiting for an idle worker.
function createWorker() {
  const worker = new Worker(THREAD_PATH, { workerData: { storeLock: STORE_LOCK_BUFFER, dataDir: DATA_DIR } });
  worker.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'event') {
      // Events from a retired worker are stale (it may still be shutting down).
      if (worker !== WORKER) return;
      try { J.pushEvent(msg.submitId, msg.evt); } catch { /* client gone */ }
      return;
    }
    if (msg.type !== 'done' && msg.type !== 'error') return;
    if (!PENDING || PENDING.worker !== worker) return;
    // Protocol guard: a message must belong to the item currently in flight.
    if (Number(msg.submitId) !== PENDING.id) {
      rejectPending(worker, new Error(`judge worker protocol mismatch (${msg.submitId} != ${PENDING.id})`), true);
      return;
    }
    const pending = PENDING;
    PENDING = null;
    if (msg.type === 'done') return pending.resolve(pending.id);
    const err = new Error(String(msg.error || 'judge failed'));
    err.itemError = true;
    err.submitId = pending.id;
    pending.reject(err);
  });
  worker.on('error', (err) => {
    if (worker === WORKER) WORKER = null;
    rejectPending(worker, err, true);
  });
  worker.on('exit', (code) => {
    if (worker === WORKER) WORKER = null;
    const err = new Error(`judge worker exited (code ${code})`);
    rejectPending(worker, err, true);
  });
  worker.unref();
  return worker;
}

function rejectPending(worker, err, infra) {
  if (!PENDING || PENDING.worker !== worker) return;
  const pending = PENDING;
  PENDING = null;
  if (infra) err.infra = true;
  pending.reject(err);
}

function ensureWorker() {
  if (!WORKER) WORKER = createWorker();
  return WORKER;
}

function retireWorker() {
  const worker = WORKER;
  WORKER = null;
  if (!worker) return;
  try { worker.terminate(); } catch { /* already gone */ }
}

function runOnWorker(submitId) {
  const worker = ensureWorker();
  return new Promise((resolve, reject) => {
    PENDING = { id: submitId, worker, resolve, reject };
    try {
      worker.postMessage({ type: 'judge', submitId });
    } catch (err) {
      PENDING = null;
      const e = new Error(String((err && err.message) || err));
      e.infra = true;
      reject(e);
    }
  });
}

// A judge crash must not leave a submit stuck in CMP/TST forever. Only rewrite
// non-terminal rows: a throw after the final setStatus must not clobber a verdict.
function failSubmit(submitId, err) {
  const s = store.get('submits', submitId);
  if (!s || TERMINAL.has(String(s.status))) return;
  const at = new Date().toISOString();
  const message = `judge worker error: ${String((err && err.message) || err).slice(0, 500)}`;
  const patch = {
    status: 'RE',
    judgedAt: at,
    compileLog: message,
    testsDone: Number(s.testsTotal || 0),
    perTest: Array.isArray(s.perTest) ? s.perTest : [],
  };
  try {
    store.update('submits', submitId, patch);
    J.pushEvent(submitId, { submitId, ...patch, phase: 'RE', at });
  } catch { /* store unavailable — the next boot's recover() will retry */ }
}

function dropHead(submitId) {
  while (J.QUEUE.length > 0 && Number(J.QUEUE[0]) === submitId) J.QUEUE.shift();
}

// Drains J.QUEUE in order. Concurrent callers share one drain promise so a
// rejudge route can await "queue drained" without starting a second loop.
function processQueue() {
  if (BUSY) return DRAIN || Promise.resolve();
  BUSY = true;
  DRAIN = (async () => {
    try {
      while (J.QUEUE.length > 0) {
        const submitId = Number(J.QUEUE[0]);
        if (!Number.isFinite(submitId)) { J.QUEUE.shift(); continue; }
        try {
          // A stale queue row (deleted/replaced) must not wedge the head.
          const submit = store.get('submits', submitId);
          if (!submit) { dropHead(submitId); continue; }
          await runOnWorker(submitId);
          RETRIES.delete(submitId);
        } catch (err) {
          const used = (RETRIES.get(submitId) || 0) + 1;
          if (err && err.infra && used <= MAX_INFRA_RETRIES) {
            RETRIES.set(submitId, used);
            retireWorker();
            continue; // keep the head and retry on a fresh worker
          }
          RETRIES.delete(submitId);
          try { failSubmit(submitId, err); } catch { /* store unavailable */ }
        }
        dropHead(submitId);
      }
    } catch (err) {
      // Callers (createSubmit/routes) call processQueue() without a catch.
      console.error(`[judgeQueue] drain stopped: ${(err && err.message) || err}`);
    } finally {
      BUSY = false;
      DRAIN = null;
    }
  })();
  return DRAIN;
}

function enqueue(submitId) {
  const id = Number(submitId);
  if (Number.isFinite(id) && !contains(id)) J.QUEUE.push(id);
  const pos = queuePosition(id);
  processQueue().catch(() => { /* per-item errors are handled inside */ });
  return pos;
}

// Requeue submissions left in QUE by a restart. Idempotent: already-queued ids
// are not duplicated, so it is safe to call at boot and from tests/tools.
function recover() {
  const rows = store.query('submits', (s) => String(s.status) === 'QUE')
    .sort((a, b) => Number(a.id) - Number(b.id));
  let added = 0;
  for (const s of rows) {
    const id = Number(s.id);
    if (!Number.isFinite(id) || contains(id)) continue;
    J.QUEUE.push(id);
    added += 1;
  }
  if (J.QUEUE.length > 0) processQueue().catch(() => { /* handled per item */ });
  return { recovered: rows.length, queued: added, size: queueSize() };
}

module.exports = {
  enqueue, processQueue, recover, queuePosition, queueSize,
};
