import { RETENTION_YEARS_AFTER_DEACTIVATION } from '../../shared/constants';

/** Deactivated before this moment → anonymize (decision D19: 2 calendar years). */
export function anonymizationCutoff(now: Date): number {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS_AFTER_DEACTIVATION);
  return cutoff.getTime();
}

/** Login attempts are kept 90 days for security review, then deleted. */
export const LOGIN_ATTEMPTS_RETENTION_DAYS = 90;

/**
 * Removes personal data of people deactivated more than 2 years ago.
 * Results stay (linked to an anonymous user) so team statistics remain correct.
 */
export async function anonymizeExpiredUsers(db: D1Database, now: Date): Promise<number> {
  const cutoff = anonymizationCutoff(now);
  const nowMs = now.getTime();

  const { results } = await db
    .prepare(`SELECT id FROM users WHERE status = 'inactive' AND deactivated_at IS NOT NULL AND deactivated_at < ?`)
    .bind(cutoff)
    .all<{ id: string }>();

  const statements: D1PreparedStatement[] = [];
  for (const { id } of results) {
    statements.push(
      db
        .prepare(
          `UPDATE users SET first_name = 'Anonimowy', last_name = 'pracownik', login = ?,
             secret_hash = NULL, secret_salt = NULL, status = 'anonymized', anonymized_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(`anon-${id.slice(0, 12)}`, nowMs, nowMs, id),
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
      db
        .prepare(`UPDATE audit_log SET before_json = NULL, after_json = NULL WHERE entity_type = 'user' AND entity_id = ?`)
        .bind(id),
    );
  }
  statements.push(
    db.prepare(`DELETE FROM login_attempts WHERE created_at < ?`).bind(nowMs - LOGIN_ATTEMPTS_RETENTION_DAYS * 864e5),
  );
  await db.batch(statements);
  return results.length;
}
