// Satori V2 — JSON file store (Postgres-ready repository interface).
// Swap JsonStore with PostgresStore later; same method shape.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.SATORI_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const COLLECTIONS = [
  'organizations', 'users', 'teams', 'contests', 'problemSets', 'problems',
  'testGroups', 'testCases', 'submits', 'clarifications', 'news', 'subpages',
  'audit', 'notifications', 'webhooks', 'sessions', 'limitHistory', 'notes', 'deliveries',
];

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name) {
  ensureDir();
  const f = fileFor(name);
  if (!fs.existsSync(f)) return [];
  try {
    const raw = fs.readFileSync(f, 'utf8');
    if (!raw.trim()) return [];
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v;
    return [];
  } catch {
    return [];
  }
}

function save(name, rows) {
  ensureDir();
  const tmp = `${fileFor(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, fileFor(name));
}

function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

class JsonStore {
  all(name) { return load(name); }
  get(name, id) {
    const rows = load(name);
    return rows.find((r) => String(r.id) === String(id)) || null;
  }
  insert(name, obj) {
    const rows = load(name);
    const row = { ...obj };
    if (row.id == null) row.id = nextId(rows);
    rows.push(row);
    save(name, rows);
    return row;
  }
  update(name, id, patch) {
    const rows = load(name);
    const i = rows.findIndex((r) => String(r.id) === String(id));
    if (i < 0) return null;
    rows[i] = { ...rows[i], ...patch };
    save(name, rows);
    return rows[i];
  }
  remove(name, id) {
    const rows = load(name);
    const out = rows.filter((r) => String(r.id) !== String(id));
    save(name, out);
    return rows.length !== out.length;
  }
  query(name, fn) { return load(name).filter(fn); }
  replaceAll(name, rows) { save(name, rows); return rows; }
}

const store = new JsonStore();

module.exports = { store, DATA_DIR, COLLECTIONS, ensureDir };
