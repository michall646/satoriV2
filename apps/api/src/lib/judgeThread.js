// Satori V2 — worker_threads entry point for asynchronous judging (C9, D8).
//
// Runs `judgeOne` off the API event loop. The worker updates the store itself
// (same DATA_DIR, JSON store reads on every access) and forwards progress via
// the patched `J.pushEvent`, which the main-thread dispatcher relays to SSE.
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const J = require('../../../../packages/judge/src/judge');

// Patch before requiring judgeWorker so its captured J instance posts here.
J.pushEvent = (submitId, evt) => {
  try {
    parentPort.postMessage({ type: 'event', submitId: Number(submitId), evt });
  } catch { /* parent already gone */ }
};

// C9: serialize JSON-store access with the API thread. Both threads share this
// Int32 lock; without it, a worker rename can hit EPERM while the API reads
// submits.json, and overlapping writes can drop rows. Holds are short/sync.
const STORE_METHODS = ['all', 'get', 'insert', 'update', 'remove', 'query', 'replaceAll'];
function lockStore(storeApi, buffer) {
  if (!buffer) return;
  const lock = new Int32Array(buffer);
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
          // A terminated parent could not release a store call; take it and go.
          console.error('[judgeThread] store lock timeout; assuming stale owner');
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
}

// Patch before requiring judgeWorker so its store calls take the lock.
// The worker must use the exact data dir the API resolved at load time, not a
// possibly-changed env var.
if (workerData && workerData.dataDir) process.env.SATORI_DATA_DIR = workerData.dataDir;
const { store } = require('./store');
lockStore(store, workerData && workerData.storeLock);

const { judgeOne } = require('./judgeWorker');

let ACTIVE = null;

function post(message) {
  try { parentPort.postMessage(message); } catch { /* parent already gone */ }
}

function postError(submitId, err) {
  const detail = err && err.stack ? err.stack : String(err || 'judge failed');
  post({ type: 'error', submitId: Number(submitId), error: detail.slice(0, 2000) });
}

parentPort.on('message', async (msg) => {
  if (!msg || msg.type !== 'judge') return;
  const submitId = Number(msg.submitId);
  ACTIVE = submitId;
  try {
    const submit = store.get('submits', submitId);
    if (!submit) throw new Error(`submit ${submitId} not found`);
    await judgeOne(submit);
    post({ type: 'done', submitId, ok: true });
  } catch (err) {
    postError(submitId, err);
  } finally {
    ACTIVE = null;
  }
});

// An uncaught throw outside judgeOne would leave the dispatcher waiting for a
// `done` that never comes. Attribute it to the active item, then exit: the
// main thread retries once on a fresh worker.
process.on('uncaughtException', (err) => {
  postError(ACTIVE, err);
  process.exit(1);
});
// Detached judge helpers already catch their own failures; log anything else
// without failing an unrelated submission.
process.on('unhandledRejection', (err) => {
  try { console.error(`judge worker unhandled rejection: ${err && err.stack ? err.stack : err}`); } catch { /* noop */ }
});
