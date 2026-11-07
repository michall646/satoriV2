// Tests for PostgreSQL Storage Adapter and Migration (Phase 6 / G9).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PostgresStore, TABLE_MAP } = require('../apps/api/src/lib/postgresStore');
const { JsonStore, createStore } = require('../apps/api/src/lib/store');

test('createStore factory selects JsonStore when DATABASE_URL is unset', () => {
  const store = createStore({ databaseUrl: null });
  assert.ok(store instanceof JsonStore);
});

test('createStore factory selects PostgresStore when DATABASE_URL is supplied', () => {
  const store = createStore({ databaseUrl: 'postgresql://user:pass@localhost:5432/satori_test' });
  assert.ok(store instanceof PostgresStore);
});

test('schema.sql exists and contains all required core relational tables', () => {
  const schemaPath = path.join(__dirname, '..', 'apps', 'api', 'src', 'db', 'schema.sql');
  assert.ok(fs.existsSync(schemaPath), 'schema.sql must exist');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const requiredTables = [
    'organizations',
    'users',
    'sessions',
    'contests',
    'teams',
    'problem_sets',
    'problems',
    'test_groups',
    'test_cases',
    'submits',
    'audit_log',
    'news',
    'clarifications',
    'appeals',
    'email_queue',
    'satori_documents',
  ];

  for (const tbl of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${tbl}`, 'i'), `schema must define ${tbl}`);
  }
});

test('PostgresStore satisfies store repository interface synchronously', () => {
  const store = new PostgresStore(); // Disconnected instance for unit testing

  // Test insert
  const org = store.insert('organizations', { name: 'Uniwersytet Jagielloński', country: 'PL' });
  assert.equal(typeof org.id, 'number');
  assert.equal(org.name, 'Uniwersytet Jagielloński');

  // Test get
  const fetched = store.get('organizations', org.id);
  assert.deepEqual(fetched, org);

  // Test get with string ID
  const fetchedByStr = store.get('organizations', String(org.id));
  assert.deepEqual(fetchedByStr, org);

  // Test update
  const updated = store.update('organizations', org.id, { country: 'Poland' });
  assert.equal(updated.country, 'Poland');
  assert.equal(store.get('organizations', org.id).country, 'Poland');

  // Test query
  const matches = store.query('organizations', (o) => o.country === 'Poland');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, org.id);

  // Test all
  const allOrgs = store.all('organizations');
  assert.equal(allOrgs.length, 1);

  // Test remove
  const removed = store.remove('organizations', org.id);
  assert.equal(removed, true);
  assert.equal(store.get('organizations', org.id), null);
  assert.equal(store.all('organizations').length, 0);

  // Test replaceAll
  const batch = [{ id: 101, name: 'AGH' }, { id: 102, name: 'UW' }];
  store.replaceAll('organizations', batch);
  assert.equal(store.all('organizations').length, 2);
  assert.equal(store.get('organizations', 101).name, 'AGH');
});

test('PostgresStore queues persistence writes for mock PostgreSQL pool', async () => {
  const executedQueries = [];
  const mockPool = {
    query: async (sql, params) => {
      executedQueries.push({ sql, params });
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        return { rows: [] };
      },
      release: () => {},
    }),
    end: async () => {},
  };

  const store = new PostgresStore();
  store.pool = mockPool;

  store.insert('users', { id: 42, login: 'testuser', email: 'test@example.com' });
  await store.flush();

  assert.ok(executedQueries.length > 0, 'Must have executed SQL queries');
  const insertQuery = executedQueries.find((q) => q.sql.includes('INSERT INTO satori_documents'));
  assert.ok(insertQuery, 'Must execute INSERT INTO satori_documents');
  assert.equal(insertQuery.params[0], 'users');
  assert.equal(insertQuery.params[1], '42');

  // Test deletion
  store.remove('users', 42);
  await store.flush();

  const deleteQuery = executedQueries.find((q) => q.sql.includes('DELETE FROM satori_documents'));
  assert.ok(deleteQuery, 'Must execute DELETE FROM satori_documents');
  assert.equal(deleteQuery.params[0], 'users');
  assert.equal(deleteQuery.params[1], '42');
});

test('TABLE_MAP covers all primary collections', () => {
  assert.equal(TABLE_MAP.users, 'users');
  assert.equal(TABLE_MAP.contests, 'contests');
  assert.equal(TABLE_MAP.problems, 'problems');
  assert.equal(TABLE_MAP.submits, 'submits');
  assert.equal(TABLE_MAP.testCases, 'test_cases');
});
