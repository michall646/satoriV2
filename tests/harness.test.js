// Smoke test for the shared API harness. Fast; dynamic port; isolated data dir.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;

before(async () => { h = await startServer({ prefix: 'satori-harness-' }); });
after(async () => { if (h) await h.close(); });

test('harness: health, seed login, contest list', async () => {
  const health = await h.api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const token = await h.loginAs('jan_kowalski', 'student123');
  const me = await h.api('/api/me', {}, token);
  assert.equal(me.status, 200);
  assert.equal(me.body.login, 'jan_kowalski');

  const contests = await h.api('/api/contests', {}, token);
  assert.equal(contests.status, 200);
  assert.ok(contests.body.items.some((c) => c.id === 251519));
});
