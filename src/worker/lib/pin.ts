/**
 * Unique PINs for the time terminal (D35, owner chose "PIN only").
 * When two people end up with the same PIN, that PIN is known to both — neither may keep it:
 * both lose the terminal link and must set a new PIN at their next sign-in.
 */
export type AssignResult = 'ok' | 'conflict';

export async function assignPinLookup(db: D1Database, userId: string, lookup: string): Promise<AssignResult> {
  const other = await db.prepare(`SELECT id FROM users WHERE pin_lookup = ? AND id <> ?`).bind(lookup, userId).first<{ id: string }>();
  const now = Date.now();
  if (other) {
    await db.batch([
      db.prepare(`UPDATE users SET pin_lookup = NULL, must_change_secret = CASE WHEN secret_kind = 'pin' THEN 1 ELSE must_change_secret END, updated_at = ? WHERE id = ?`).bind(now, other.id),
      db.prepare(`UPDATE users SET pin_lookup = NULL, updated_at = ? WHERE id = ?`).bind(now, userId),
    ]);
    return 'conflict';
  }
  await db.prepare(`UPDATE users SET pin_lookup = ?, updated_at = ? WHERE id = ?`).bind(lookup, now, userId).run();
  return 'ok';
}

/** Is this PIN already someone else's? Used before saving a new PIN. */
export async function pinTaken(db: D1Database, userId: string, lookup: string): Promise<string | null> {
  const other = await db.prepare(`SELECT id FROM users WHERE pin_lookup = ? AND id <> ?`).bind(lookup, userId).first<{ id: string }>();
  return other?.id ?? null;
}

/** The PIN became known (someone else tried to choose it): its holder must pick a new one. */
export function burnPinStatement(db: D1Database, holderId: string): D1PreparedStatement {
  // a manager paid by the hour keeps his password: he is only asked for a new PIN (needsPin)
  return db
    .prepare(`UPDATE users SET pin_lookup = NULL, must_change_secret = CASE WHEN secret_kind = 'pin' THEN 1 ELSE must_change_secret END, updated_at = ? WHERE id = ?`)
    .bind(Date.now(), holderId);
}
