#!/usr/bin/env node
/**
 * Restore xauusd_brain table from a JSON backup file.
 *
 * Usage:
 *   node scripts/restore-brain-backup.mjs <path-to-backup.json>
 *
 * Example:
 *   node scripts/restore-brain-backup.mjs attached_assets/xauusd_brain_1783643732829.json
 *
 * The script:
 *  1. Connects to DATABASE_URL from environment
 *  2. Truncates the xauusd_brain table (RESTART IDENTITY)
 *  3. Bulk-inserts all rows from the JSON file
 *  4. Resets the ID sequence to MAX(id)
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

// Resolve pg from the pnpm workspace
let Client;
try {
  ({ Client } = require('pg'));
} catch {
  // fallback to explicit pnpm store path
  ({ Client } = require(
    resolve(process.cwd(), 'node_modules/.pnpm/pg@8.22.0/node_modules/pg')
  ));
}

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('Usage: node scripts/restore-brain-backup.mjs <path-to-backup.json>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(resolve(backupPath), 'utf-8'));
console.log(`📂 Backup loaded: ${data.length} rows`);

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function restore() {
  await client.connect();

  const before = await client.query('SELECT COUNT(*) FROM xauusd_brain');
  console.log(`📊 Rows before restore: ${before.rows[0].count}`);

  await client.query('TRUNCATE TABLE xauusd_brain RESTART IDENTITY CASCADE');
  console.log('🗑️  Table truncated.');

  let inserted = 0;
  for (const row of data) {
    await client.query(
      `INSERT INTO xauusd_brain
         (id, category, title, content, confidence, usage_count, last_validated,
          is_active, source_question, market_condition_tags, decay_weight, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.id, row.category, row.title, row.content, row.confidence,
        row.usage_count, row.last_validated, row.is_active, row.source_question,
        row.market_condition_tags, row.decay_weight, row.created_at, row.updated_at,
      ]
    );
    inserted++;
    if (inserted % 200 === 0) process.stdout.write(`  ${inserted}...`);
  }

  await client.query(
    `SELECT setval('xauusd_brain_id_seq', (SELECT MAX(id) FROM xauusd_brain))`
  );

  const after = await client.query('SELECT COUNT(*) FROM xauusd_brain');
  console.log(`\n✅ Restore complete. Total rows: ${after.rows[0].count}`);
  await client.end();
}

restore().catch((err) => {
  console.error('❌ Restore failed:', err.message);
  process.exit(1);
});
