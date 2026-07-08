// One-off restore: load attached_assets/xauusd_brain_*.json into the xauusd_brain table.
// Usage: node scripts/restore-xauusd-brain.mjs <path-to-json>
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const file = process.argv[2];
if (!file) {
  console.error("Usage: node restore-xauusd-brain.mjs <path-to-json>");
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(file), "utf-8");
const rows = JSON.parse(raw);
console.log(`Loaded ${rows.length} rows from ${file}`);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("TRUNCATE TABLE xauusd_brain RESTART IDENTITY");

  const cols = [
    "id",
    "category",
    "title",
    "content",
    "confidence",
    "usage_count",
    "last_validated",
    "is_active",
    "source_question",
    "market_condition_tags",
    "decay_weight",
    "created_at",
    "updated_at",
  ];

  const text = `INSERT INTO xauusd_brain (${cols.join(", ")}) VALUES (${cols
    .map((_, i) => `$${i + 1}`)
    .join(", ")})`;

  let inserted = 0;
  for (const row of rows) {
    const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
    await client.query(text, values);
    inserted++;
  }

  // Sync the serial sequence so future inserts don't collide with restored ids.
  await client.query(
    `SELECT setval(pg_get_serial_sequence('xauusd_brain', 'id'), COALESCE((SELECT MAX(id) FROM xauusd_brain), 1))`,
  );

  await client.query("COMMIT");
  console.log(`Restored ${inserted} rows into xauusd_brain.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Restore failed:", err);
  process.exit(1);
} finally {
  await client.end();
}
