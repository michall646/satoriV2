// Satori V2 — Data Migration: JSON store -> PostgreSQL (Phase 6 / G9).
// Idempotently reads JSON data collections and populates PostgreSQL.
//
// Usage:
//   node scripts/migrate-to-pg.js                     # Dry-run
//   node scripts/migrate-to-pg.js --apply             # Write to DB
//   DATABASE_URL=... node scripts/migrate-to-pg.js --apply
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dataDirArg = args.find((a) => a.startsWith('--data-dir='));
const dbUrlArg = args.find((a) => a.startsWith('--database-url='));

const dataDir = (dataDirArg ? dataDirArg.slice('--data-dir='.length) : process.env.SATORI_DATA_DIR) || path.join(__dirname, '..', 'data');
const databaseUrl = (dbUrlArg ? dbUrlArg.slice('--database-url='.length) : process.env.DATABASE_URL) || 'postgresql://postgres:postgres@localhost:5432/satori';

const { COLLECTIONS } = require('../apps/api/src/lib/store');
const { TABLE_MAP } = require('../apps/api/src/lib/postgresStore');

async function main() {
  console.log(`=== Satori V2 PostgreSQL Migration ===`);
  console.log(`Mode: ${apply ? 'APPLY (live database write)' : 'DRY-RUN (read-only preview)'}`);
  console.log(`Source Data Dir: ${dataDir}`);
  console.log(`Target Database: ${databaseUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@')}\n`);

  if (!fs.existsSync(dataDir)) {
    console.log(`Data directory "${dataDir}" does not exist yet. Nothing to migrate.`);
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });

  if (apply) {
    try {
      const client = await pool.connect();
      console.log('✓ Successfully connected to PostgreSQL.');
      client.release();
    } catch (err) {
      console.error(`✗ Failed to connect to PostgreSQL: ${err.message}`);
      console.error('Check your DATABASE_URL and ensure PostgreSQL is running.');
      await pool.end();
      process.exit(1);
    }

    // Apply schema
    const schemaFile = path.join(__dirname, '..', 'apps', 'api', 'src', 'db', 'schema.sql');
    if (fs.existsSync(schemaFile)) {
      console.log('Applying database schema from schema.sql...');
      const schemaSql = fs.readFileSync(schemaFile, 'utf8');
      await pool.query(schemaSql);
      console.log('✓ Database schema verified/applied.\n');
    }
  }

  let totalCollections = 0;
  let totalRecords = 0;
  const summary = [];

  for (const col of COLLECTIONS) {
    const file = path.join(dataDir, `${col}.json`);
    if (!fs.existsSync(file)) continue;

    let rows = [];
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) rows = parsed;
      }
    } catch (err) {
      console.warn(`! Skipping corrupted or unreadable collection "${col}": ${err.message}`);
      continue;
    }

    if (rows.length === 0) continue;

    totalCollections++;
    totalRecords += rows.length;
    summary.push({ collection: col, count: rows.length });

    if (apply) {
      process.stdout.write(`Migrating collection "${col}" (${rows.length} rows)... `);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of rows) {
          const rowId = String(row.id);
          const dataJson = JSON.stringify(row);

          // 1. Generic document store (idempotent upsert)
          await client.query(
            `INSERT INTO satori_documents (collection, id, data, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [col, rowId, dataJson]
          );

          // 2. Dedicated relational table if mapped
          const table = TABLE_MAP[col];
          if (table && Number.isFinite(Number(row.id))) {
            await client.query(
              `INSERT INTO ${table} (id, data)
               VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
              [Number(row.id), dataJson]
            ).catch(() => {
              // Ignore dedicated table conflict if table structure has additional non-null constraints
            });
          }
        }
        await client.query('COMMIT');
        console.log('DONE');
      } catch (colErr) {
        await client.query('ROLLBACK');
        console.error(`FAILED: ${colErr.message}`);
      } finally {
        client.release();
      }
    }
  }

  console.log('\n--- Migration Summary ---');
  for (const item of summary) {
    console.log(`  - ${item.collection.padEnd(24)}: ${item.count} rows`);
  }
  console.log(`Total: ${totalRecords} records across ${totalCollections} collections.`);

  if (!apply && totalRecords > 0) {
    console.log('\nTo execute migration against PostgreSQL, rerun with --apply.');
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}

module.exports = { main };
