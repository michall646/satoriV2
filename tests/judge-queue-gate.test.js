// Batch 3 Lane L — C9 async judge worker + persistent queue gate.
//
// Acceptance:
//  - the API event loop stays responsive while a real submission is judged;
//  - submissions left in QUE survive a restart (recover() re-queues them);
//  - progress still reaches SSE clients through the worker -> main bridge;
//  - a judge crash/item error does not wedge the queue.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const SUM_JS = "const fs=require('node:fs');const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);";
const BOMB_CPP = 'int main(){volatile long long x=0;for(;;){x++;}return 0;}';

let h;
let teacher;
let teacherId;
let judgeQueue;
let J;
let seq = 0;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function makeProblem(opts = {}) {
  seq += 1;
  const contest = await h.createContest(teacher, { name: `Judge queue #${seq}`, mode: 'ICPC' });
  const problem = await h.createProblem(contest.id, teacher, {
    code: 'A', name: `Problem ${seq}`, visibility: 'draft', ...(opts.problem || {}),
  });
  if (opts.withCase !== false) {
    const group = await h.addGroup(problem.id, teacher, { name: 'all', points: 100 });
    await h.addCase(problem.id, teacher, {
      groupId: group.id, name: 'sum', input: '2 3\n', expected: '5\n',
    });
  }
  if (opts.limits) h.store.update('problems', problem.id, { limits: opts.limits });
  if (opts.samples) h.store.update('problems', problem.id, { samples: opts.samples });
  return { contest, problem };
}

function insertQue(problemId, code, extra = {}) {
  return h.store.insert('submits', {
    contestId: null, problemId, userId: teacherId,
    lang: 'JavaScript', filename: 'solution.js', code,
    status: 'QUE', testsTotal: 0, testsDone: 0, perTest: [], points: 0,
    createdAt: new Date().toISOString(), judgedAt: null,
    sampleOnly: false, isLate: false, lateUnits: 0,
    ...extra,
  });
}

function isTerminal(status) {
  return ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE'].includes(String(status));
}

// Reads an SSE response until `predicate` sees an event, or the stream times out.
async function readSseUntil(url, token, predicate, timeoutMs = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const events = [];
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal });
  assert.equal(res.status, 200, 'SSE endpoint accepted the subscriber');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let evt = null;
          try { evt = JSON.parse(line.slice(6)); } catch { /* ignore keep-alive */ }
          if (!evt) continue;
          events.push(evt);
          if (predicate(evt)) return { evt, events };
        }
        idx = buf.indexOf('\n\n');
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    try { await reader.cancel(); } catch { /* already closed */ }
    try { ac.abort(); } catch { /* noop */ }
  }
  return { evt: null, events };
}

before(async () => {
  process.env.SATORI_DEMO_TRIGGERS = '1';
  h = await startServer({ prefix: 'satori-judgequeue-' });
  teacher = await h.loginAs('g_herman', 'teacher123');
  const me = await h.api('/api/me', {}, teacher);
  teacherId = me.body.id;
  // Require after startServer: both capture Satori's DATA_DIR at load time.
  judgeQueue = require('../apps/api/src/lib/judgeQueue');
  J = require('../packages/judge/src/judge');
});

after(async () => { if (h) await h.close(); });

test('C9: API health stays responsive while a real C++ submission is judged', async (t) => {
  if (!J.hasGpp()) return t.skip('g++ not installed on this host');
  const { problem } = await makeProblem({ limits: { timeMs: 1500, memoryMb: 256 } });

  const created = await h.api('/api/submits', {
    method: 'POST',
    body: JSON.stringify({ problemId: problem.id, filename: 'bomb.cpp', code: BOMB_CPP }),
  }, teacher);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const id = created.body.id;
  const started = Date.now();
  let healthCalls = 0;
  let judged = null;
  while (Date.now() - started < 20000) {
    const t0 = performance.now();
    const health = await h.api('/api/health');
    const elapsed = performance.now() - t0;
    assert.equal(health.status, 200);
    assert.ok(elapsed < 800, `API blocked: /api/health took ${elapsed.toFixed(0)}ms while judging`);
    healthCalls += 1;
    const row = h.store.get('submits', id);
    if (row && isTerminal(row.status)) { judged = row; break; }
    await sleep(60);
  }

  assert.ok(judged, 'submission reached a verdict');
  assert.ok(['TLE', 'RE'].includes(String(judged.status)), `expected TLE/RE, got ${judged.status}`);
  assert.ok(healthCalls >= 3, `health must be probed during judging (calls=${healthCalls})`);
  assert.equal(judged.sampleOnly, false);
  assert.ok(Number(judged.cpuMs || 0) > 0, 'judge reports elapsed CPU/wall time');
});

test('C9: recover() requeues a QUE submission after a restart', async () => {
  const { problem } = await makeProblem({ limits: { timeMs: 2000, memoryMb: 256 } });
  const row = insertQue(problem.id, SUM_JS);
  assert.equal(row.status, 'QUE');

  const first = judgeQueue.recover();
  assert.ok(first.recovered >= 1, 'recover sees the QUE row');
  assert.ok(first.queued >= 1, 'recover seeds the queue');
  assert.equal(judgeQueue.queueSize(), J.QUEUE.length, 'queue metrics stay on J.QUEUE');

  // Idempotent: a second boot scan must not duplicate the same submit.
  const second = judgeQueue.recover();
  assert.equal(second.queued, 0, 'already-queued ids are not duplicated');

  const judged = await h.waitJudged(row.id, teacher);
  assert.ok(judged, 'recovered submission judged in time');
  assert.equal(judged.status, 'OK', JSON.stringify(judged));
  assert.equal(judged.points, 100);
});

test('C9: worker progress reaches SSE clients through the main-thread bridge', async () => {
  const { problem } = await makeProblem({ limits: { timeMs: 2000, memoryMb: 256 } });
  const row = insertQue(problem.id, SUM_JS);

  // Subscribe before recover so every worker event is observed.
  const sse = readSseUntil(
    `${h.base}/api/submits/${row.id}/events`,
    teacher,
    (evt) => ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE'].includes(String(evt.status)),
  );
  // Give the server a tick to register the subscriber, then release the queue.
  await sleep(100);
  judgeQueue.recover();
  const { evt, events } = await sse;

  assert.ok(evt, `expected a terminal SSE event, got ${JSON.stringify(events)}`);
  assert.equal(String(evt.status), 'OK');
  assert.ok(
    events.some((e) => ['CMP', 'TST', 'OK'].includes(String(e.phase))),
    'worker progress phases were forwarded to the main thread',
  );
});

test('C9: a judge/item error does not wedge the queue (negative)', async () => {
  // `samples: [null]` makes judgeOne throw in the sample branch — a real worker
  // item error, not a client-side validation failure.
  const bad = await makeProblem({ withCase: false, samples: [null] });
  const badRow = insertQue(bad.problem.id, SUM_JS, { sampleOnly: true });

  const good = await makeProblem({ limits: { timeMs: 2000, memoryMb: 256 } });
  const goodRow = insertQue(good.problem.id, SUM_JS);

  judgeQueue.recover();

  const judgedGood = await h.waitJudged(goodRow.id, teacher);
  assert.ok(judgedGood, 'second submission still judged after the first crashed');
  assert.equal(judgedGood.status, 'OK');

  const failed = await h.waitJudged(badRow.id, teacher);
  assert.ok(failed, 'the failed item reaches a terminal state');
  assert.equal(failed.status, 'RE', 'worker error is surfaced as RE, not stuck in TST');
  assert.match(String(failed.compileLog || ''), /judge worker error/i);
  assert.equal(judgeQueue.queueSize(), 0, 'queue drains past the bad item');
});
