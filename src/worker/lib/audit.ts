import { newId } from './http';

/** Admin action log. Never pass secrets (PINs, passwords, tokens) in before/after. */
export function auditStatement(
  db: D1Database,
  entry: {
    actorId: string | null;
    locationId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, actor_id, location_id, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('aud'),
      entry.actorId,
      entry.locationId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      Date.now(),
    );
}
