import type { Env } from '../env';

/** Nightly backups kept this many days in the BACKUPS bucket. */
export const BACKUP_RETENTION_DAYS = 30;
const PAGE = 500;

export interface BackupManifest {
  createdAt: string;
  env: string;
  tables: Record<string, number>;
  migrations: string[];
}

/** Tables to export: every real table + the FTS index (its shadow tables are internal). */
export async function listBackupTables(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name NOT LIKE 'search_index_%'
         AND name <> 'd1_migrations'
       ORDER BY name`,
    )
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

export function backupDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Export every table as NDJSON to R2: daily/<YYYY-MM-DD>/<table>.ndjson + manifest.json.
 * Independent from D1 Time Travel, so a broken database or account mistake can still be restored.
 */
export async function runNightlyBackup(env: Env, now: Date): Promise<{ day: string; rows: number; deleted: number }> {
  const day = backupDay(now);
  const prefix = `daily/${day}/`;
  const tables = await listBackupTables(env.DB);
  const manifest: BackupManifest = { createdAt: now.toISOString(), env: env.APP_ENV, tables: {}, migrations: [] };
  let total = 0;

  for (const table of tables) {
    const lines: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await env.DB.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
        .bind(PAGE, offset)
        .all<Record<string, unknown>>();
      for (const row of results) lines.push(JSON.stringify(row));
      if (results.length < PAGE) break;
    }
    await env.BACKUPS.put(`${prefix}${table}.ndjson`, lines.join('\n'), {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
    manifest.tables[table] = lines.length;
    total += lines.length;
  }

  try {
    const { results } = await env.DB.prepare(`SELECT name FROM d1_migrations ORDER BY id`).all<{ name: string }>();
    manifest.migrations = results.map((r) => r.name);
  } catch {
    manifest.migrations = [];
  }
  await env.BACKUPS.put(`${prefix}manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  const deleted = await pruneOldBackups(env.BACKUPS, now);
  return { day, rows: total, deleted };
}

async function pruneOldBackups(bucket: R2Bucket, now: Date): Promise<number> {
  const oldest = backupDay(new Date(now.getTime() - BACKUP_RETENTION_DAYS * 864e5));
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'daily/', cursor });
    const stale = page.objects.map((o) => o.key).filter((key) => (key.split('/')[1] ?? '') < oldest);
    if (stale.length) {
      await bucket.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
