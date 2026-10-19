// Satori V2 — API server (stdlib http, zero deps).
// Run: node apps/api/src/server.js  (PORT default 3001)
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const { store } = require('./lib/store');
const { send, handleOptions } = require('./lib/http');
const judgeQueue = require('./lib/judgeQueue');

const PORT = Number(process.env.PORT || 3001);

// Route modules are checked in order. Each returns true when it handled the request.
const routes = [
  require('./routes/meta'),
  require('./routes/auth'),
  require('./routes/contests'),
  require('./routes/integrity'),
  require('./routes/webhooks'),
  require('./routes/grades'),
  require('./routes/problems'),
  require('./routes/submits'),
  require('./routes/account'),
];

// C9/D8: requeue submissions left in QUE by a restart. Idempotent, so tests and
// tools may call it again after inserting a QUE row. Runs after the store is
// available (DATA_DIR is already set by the time this module is required).
try {
  judgeQueue.recover();
} catch (e) {
  console.error(`Judge queue recovery skipped: ${e.message}`);
}

// ---- router ----
async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const m = req.method;
  if (handleOptions(req, res, m)) return;

  for (const route of routes) {
    if (await route.handle(req, res, u, p, m)) return;
    if (res.headersSent) return;
  }
  send(res, 404, { error: { code: 'NOT_FOUND', message: `No route ${m} ${p}.`, hint: 'See /api/openapi.json.' } });
}

const server = http.createServer(handler);
function autoSeedIfEmpty() {
  if (store.all('contests').length > 0) return;
  // A7: never seed known demo passwords in production unless explicitly requested.
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && process.env.SATORI_DEMO_SEED !== '1') return;
  try {
    require('./seed').main();
    console.log('Auto-seeded demo data (Playground 251519, Rust 8677128, UZI 10193118).');
  } catch (e) {
    console.log(`Seed skipped: ${e.message}`);
  }
}
if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && !process.env.SATORI_JWT_SECRET) {
    console.error('Refusing to start: set SATORI_JWT_SECRET in production.');
    process.exit(1);
  }
  const { DATA_DIR } = require('./lib/store');
  autoSeedIfEmpty();
  server.listen(PORT, () => console.log(`Satori V2 API on http://localhost:${PORT} (DATA_DIR=${DATA_DIR})`));
}
module.exports = { server, handler, autoSeedIfEmpty };
