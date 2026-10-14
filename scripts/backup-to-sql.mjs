#!/usr/bin/env node
/**
 * Turns one nightly backup (folder with manifest.json + <table>.ndjson) into a SQL file
 * that restores the data into a database that already has the schema (migrations applied).
 *
 *   node scripts/backup-to-sql.mjs <backup-folder> <out.sql>
 *   npx wrangler d1 execute DB --remote --file <out.sql>       (production)
 *
 * Full procedure: docs/DEPLOYMENT.md → "Odtwarzanie z kopii".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('Usage: node scripts/backup-to-sql.mjs <backup-folder> <out.sql>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const tables = Object.keys(manifest.tables);

const quote = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replaceAll("'", "''")}'`;
};

const sql = ['PRAGMA defer_foreign_keys = on;'];
for (const table of tables) sql.push(`DELETE FROM "${table}";`);

let rows = 0;
for (const table of tables) {
  const file = join(dir, `${table}.ndjson`);
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
  const text = readFileSync(file, 'utf8').trim();
  if (!text) continue;
  for (const line of text.split('\n')) {
    const row = JSON.parse(line);
    const cols = Object.keys(row);
    sql.push(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => quote(row[c])).join(', ')});`,
    );
    rows++;
  }
}

writeFileSync(out, sql.join('\n') + '\n');
console.log(`Backup ${manifest.createdAt} (${manifest.env}): ${tables.length} tables, ${rows} rows → ${out}`);
