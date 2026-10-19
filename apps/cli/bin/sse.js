// Minimal SSE client (stdlib http).
'use strict';
const http = require('node:http');
class SSE {
  constructor(url, token) { this.url = url; this.token = token; this.cb = null; this.closed = false; this.connect(); }
  onMessage(cb) { this.cb = cb; }
  connect() {
    const u = new URL(this.url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        if (this.closed) return;
        buf += c;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data:'));
          if (!line || !this.cb) continue;
          try { this.cb(JSON.parse(line.slice(5).trim())); } catch { /* keep */ }
        }
      });
    });
    req.on('error', () => {});
    req.end();
    this.req = req;
  }
  close() { this.closed = true; try { this.req.destroy(); } catch { /* noop */ } }
}
module.exports = SSE;
