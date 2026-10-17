/** Creating an employee account — shared by Pracownicy and „Utwórz konto” in Rekrutacja. */
import { generateTempPin, hashSecret } from '../auth/crypto';
import { proposeLogin } from '../../shared/text';
import { auditStatement } from './audit';
import { ApiError, newId } from './http';

export async function uniqueLogin(db: D1Database, base: string): Promise<string> {
  const root = base || 'pracownik';
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}${i}`;
    const hit = await db.prepare(`SELECT 1 FROM users WHERE login = ?`).bind(candidate).first();
    if (!hit) return candidate;
  }
  throw new ApiError(409, 'login_taken');
}

/**
 * Statements that create the account (run them in one batch with your own), plus the one-time PIN to show.
 * The temporary PIN is never stored in clear text.
 */
export async function newEmployee(
  db: D1Database,
  pepper: string,
  p: {
    firstName: string;
    lastName: string;
    position: string;
    locationId: string;
    startDate: string | null;
    actorId: string;
    source?: string;
    /** hourly rate for this position (grosze), from the start date (or today); only with wages.manage */
    rate?: { grosze: number; validFrom: string };
  },
) {
  const id = newId('usr');
  const login = await uniqueLogin(db, proposeLogin(p.firstName, p.lastName));
  const tempSecret = generateTempPin();
  const { hash, salt } = await hashSecret(tempSecret, pepper);
  const statements = [
    db
      .prepare(
        `INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_salt, secret_kind, must_change_secret)
         VALUES (?, ?, ?, ?, 'employee', 'active', ?, ?, 'pin', 1)`,
      )
      .bind(id, p.firstName, p.lastName, login, hash, salt),
    db
      .prepare(`INSERT INTO user_locations (id, user_id, location_id, position, start_date, is_primary) VALUES (?, ?, ?, ?, ?, 1)`)
      .bind(newId('ul'), id, p.locationId, p.position, p.startDate),
    auditStatement(db, {
      actorId: p.actorId,
      locationId: p.locationId,
      action: 'user.create',
      entityType: 'user',
      entityId: id,
      after: { firstName: p.firstName, lastName: p.lastName, login, position: p.position, startDate: p.startDate, ...(p.source ? { source: p.source } : {}) },
    }),
  ];
  if (p.rate) {
    statements.push(
      db
        .prepare(`INSERT INTO pay_rates (id, user_id, location_id, position, rate_grosze, valid_from, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId('rate'), id, p.locationId, p.position, p.rate.grosze, p.rate.validFrom, p.actorId, Date.now()),
      auditStatement(db, { actorId: p.actorId, locationId: p.locationId, action: 'user.rate', entityType: 'user', entityId: id, after: { rateGrosze: p.rate.grosze, validFrom: p.rate.validFrom, position: p.position } }),
    );
  }
  return { id, login, tempSecret, statements };
}

/** „32,50” / 32.5 → 3250 grosze; null when empty; throws rate_invalid otherwise. */
export function parseRate(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new ApiError(400, 'rate_invalid');
  return Math.round(n * 100);
}
