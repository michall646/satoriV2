// Web API client: structured errors keep the server code/message/hint.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let base;
let api;
let ApiError;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: 'world' }));
      return;
    }
    if (req.url === '/bad') {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FILENAME_CHARSET', message: 'Filename invalid.', hint: 'Use A-Z a-z 0-9 . _ -.' } }));
      return;
    }
    if (req.url === '/text') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.NEXT_PUBLIC_API = base;
  ({ api, ApiError } = require('../apps/web/lib/api'));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('client parses success JSON', async () => {
  const d = await api('/ok');
  assert.deepEqual(d, { hello: 'world' });
});

test('client preserves structured server error', async () => {
  await assert.rejects(() => api('/bad'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 422);
    assert.equal(err.code, 'FILENAME_CHARSET');
    assert.match(err.message, /Filename invalid/);
    assert.match(err.message, /A-Z a-z 0-9/);
    assert.equal(err.hint, 'Use A-Z a-z 0-9 . _ -.');
    return true;
  });
});

test('client falls back to text for non-JSON errors', async () => {
  await assert.rejects(() => api('/text'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    assert.match(err.message, /boom/);
    return true;
  });
});
