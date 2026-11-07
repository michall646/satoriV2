// Satori V2 — PostgreSQL Storage Adapter (Phase 6 / G9).
// High-concurrency ACID persistence backing the store repository interface.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let pgModule = null;
try {
  pgModule = require('pg');
} catch {
  // pg is optional; if missing, PostgresStore falls back or throws on connection
}

const TABLE_MAP = {
  organizations: 'organizations',
  users: 'users',
  sessions: 'sessions',
  contests: 'contests',
  teams: 'teams',
  problemSets: 'problem_sets',
  problems: 'problems',
  testGroups: 'test_groups',
  testCases: 'test_cases',
  submits: 'submits',
  audit: 'audit_log',
  news: 'news',
  clarifications: 'clarifications',
  appeals: 'appeals',
  email_queue: 'email_queue',
  emailQueue: 'email_queue',
};

function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

class PostgresStore {
  constructor(opts = {}) {
    this.connectionString = opts.connectionString || process.env.DATABASE_URL || null;
    this.pg = opts.pg || pgModule;
    this.pool = null;
    this._cache = new Map(); // collectionName -> Array of rows
    this._writeQueue = [];
    this._draining = false;
    this._connected = false;
    this._initPromise = null;

    if (this.connectionString && this.pg) {
      this.initPool();
    }
  }

  initPool() {
    if (!this.pg) return;
    try {
      this.pool = new this.pg.Pool({
        connectionString: this.connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      this.pool.on('error', (err) => {
        console.error('[PostgresStore] Pool error:', err.message);
      });
    } catch (err) {
      console.error('[PostgresStore] Failed to initialize pg Pool:', err.message);
    }
  }

  async initSchema() {
    if (!this.pool) return false;
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    if (!fs.existsSync(schemaPath)) return false;
    const sql = fs.readFileSync(schemaPath, 'utf8');
    try {
      await this.pool.query(sql);
      this._connected = true;
      return true;
    } catch (err) {
      console.error('[PostgresStore] Schema initialization failed:', err.message);
      return false;
    }
  }

  // Pre-loads all rows from DB into the local cache for lightning-fast reads
  async hydrate(collections = []) {
    if (!this.pool) return;
    try {
      // Ensure satori_documents table exists
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS satori_documents (
          collection VARCHAR(64) NOT NULL,
          id VARCHAR(128) NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (collection, id)
        );
      `);

      const res = await this.pool.query('SELECT collection, data FROM satori_documents');
      const grouped = new Map();
      for (const row of res.rows) {
        if (!grouped.has(row.collection)) grouped.set(row.collection, []);
        grouped.get(row.collection).push(row.data);
      }

      for (const [col, rows] of grouped.entries()) {
        this._cache.set(col, rows);
      }
      this._connected = true;
    } catch (err) {
      console.error('[PostgresStore] Hydration error:', err.message);
    }
  }

  _getCollection(name) {
    if (!this._cache.has(name)) {
      this._cache.set(name, []);
    }
    return this._cache.get(name);
  }

  // Synchronous store repository interface
  all(name) {
    return [...this._getCollection(name)];
  }

  get(name, id) {
    const rows = this._getCollection(name);
    return rows.find((r) => String(r.id) === String(id)) || null;
  }

  insert(name, obj) {
    const rows = this._getCollection(name);
    const row = { ...obj };
    if (row.id == null) row.id = nextId(rows);
    rows.push(row);
    this._persist(name, 'upsert', row);
    return row;
  }

  update(name, id, patch) {
    const rows = this._getCollection(name);
    const i = rows.findIndex((r) => String(r.id) === String(id));
    if (i < 0) return null;
    rows[i] = { ...rows[i], ...patch };
    this._persist(name, 'upsert', rows[i]);
    return rows[i];
  }

  remove(name, id) {
    const rows = this._getCollection(name);
    const idx = rows.findIndex((r) => String(r.id) === String(id));
    if (idx < 0) return false;
    rows.splice(idx, 1);
    this._persist(name, 'delete', { id });
    return true;
  }

  delete(name, id) {
    return this.remove(name, id);
  }

  query(name, fn) {
    return this._getCollection(name).filter(fn);
  }

  replaceAll(name, rows) {
    const copy = Array.isArray(rows) ? [...rows] : [];
    this._cache.set(name, copy);
    this._persist(name, 'replaceAll', copy);
    return copy;
  }

  // Background asynchronous persistence to PostgreSQL
  _persist(collection, op, payload) {
    if (!this.pool) return;
    this._writeQueue.push({ collection, op, payload });
    this._drain();
  }

  async _drain() {
    if (this._draining || !this.pool) return;
    this._draining = true;
    try {
      while (this._writeQueue.length > 0) {
        const item = this._writeQueue.shift();
        try {
          if (item.op === 'upsert') {
            await this.pool.query(
              `INSERT INTO satori_documents (collection, id, data, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (collection, id) DO UPDATE SET data = $3, updated_at = NOW()`,
              [item.collection, String(item.payload.id), JSON.stringify(item.payload)]
            );
          } else if (item.op === 'delete') {
            await this.pool.query(
              'DELETE FROM satori_documents WHERE collection = $1 AND id = $2',
              [item.collection, String(item.payload.id)]
            );
          } else if (item.op === 'replaceAll') {
            const client = await this.pool.connect();
            try {
              await client.query('BEGIN');
              await client.query('DELETE FROM satori_documents WHERE collection = $1', [item.collection]);
              for (const row of item.payload) {
                await client.query(
                  `INSERT INTO satori_documents (collection, id, data, updated_at)
                   VALUES ($1, $2, $3, NOW())`,
                  [item.collection, String(row.id), JSON.stringify(row)]
                );
              }
              await client.query('COMMIT');
            } catch (txErr) {
              await client.query('ROLLBACK');
              throw txErr;
            } finally {
              client.release();
            }
          }
        } catch (err) {
          console.error(`[PostgresStore] Persist error on ${item.collection}:${item.op}:`, err.message);
        }
      }
    } finally {
      this._draining = false;
    }
  }

  async flush() {
    while (this._writeQueue.length > 0 || this._draining) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async close() {
    await this.flush();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // Direct Async methods for advanced use
  async allAsync(name) {
    if (!this.pool) return this.all(name);
    const res = await this.pool.query(
      'SELECT data FROM satori_documents WHERE collection = $1 ORDER BY (data->>\'id\')::bigint ASC NULLS LAST',
      [name]
    );
    return res.rows.map((r) => r.data);
  }

  async getAsync(name, id) {
    if (!this.pool) return this.get(name, id);
    const res = await this.pool.query(
      'SELECT data FROM satori_documents WHERE collection = $1 AND id = $2',
      [name, String(id)]
    );
    return res.rows[0] ? res.rows[0].data : null;
  }

  async insertAsync(name, obj) {
    const row = this.insert(name, obj);
    await this.flush();
    return row;
  }

  async updateAsync(name, id, patch) {
    const updated = this.update(name, id, patch);
    await this.flush();
    return updated;
  }

  async removeAsync(name, id) {
    const res = this.remove(name, id);
    await this.flush();
    return res;
  }

  async queryAsync(sql, params = []) {
    if (!this.pool) throw new Error('Database pool not connected');
    return this.pool.query(sql, params);
  }
}

module.exports = { PostgresStore, TABLE_MAP };
