/**
 * Dostępy (owner, 2026-10-17; mockup 17):
 * - „Wyłącz dostęp” / „Włącz ponownie” for leaders, and „Usuń na zawsze” for a switched-off one (login typed to confirm);
 * - „Rozlicza czas pracy”: a leader paid by the hour. He sets a 6-digit PIN at the next sign-in, clocks in on the
 *   terminal and is planned and counted like an employee, in the position chosen here (with an hourly rate).
 * The owner, or a zarządzający with `managers.manage` at the leader's location. Never yourself.
 */
import { Hono } from 'hono';
import { POSITIONS } from '../../shared/constants';
import { isIsoDate } from '../../shared/time';
import type { AppEnv } from '../env';
import { loadAccess, requirePermission, type Access } from '../auth/access';
import { generateTempPassword, hashSecret } from '../auth/crypto';
import { revokeUserSessions } from '../auth/session';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson } from '../lib/http';
import { parseRate } from '../lib/employees';
import { confirmMatches, purgeUserStatements } from '../lib/purge';
import { deleteKeys } from '../jobs/punchPhotos';

export const managerAdminRoutes = new Hono<AppEnv>();

const warsawToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());

interface Target {
  id: string;
  login: string;
  status: 'active' | 'inactive';
  tracksTime: number;
}

/** The leader and the locations where the actor may manage him. */
async function guard(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string): Promise<{ access: Access; m: Target; locs: string[] }> {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const m = await db
    .prepare(`SELECT id, login, status, tracks_time AS tracksTime FROM users WHERE id = ? AND role = 'manager' AND status <> 'anonymized'`)
    .bind(id)
    .first<Target>();
  if (!m) throw notFound();
  const { results } = await db
    .prepare(`SELECT DISTINCT location_id AS loc FROM user_locations WHERE user_id = ? UNION SELECT DISTINCT location_id FROM manager_permissions WHERE user_id = ?`)
    .bind(id, id)
    .all<{ loc: string }>();
  const all = results.map((r) => r.loc);
  const locs = access.role === 'owner' ? all : all.filter((l) => access.locations.get(l)?.has('managers.manage'));
  if (!locs.length) throw notFound();
  if (m.id === c.var.user.id) throw new ApiError(403, 'own_permissions');
  return { access, m, locs };
}

managerAdminRoutes.post('/managers/:id/deactivate', async (c) => {
  const { m, locs } = await guard(c, c.req.param('id'));
  if (m.status !== 'active') throw new ApiError(409, 'user_inactive');
  const db = c.env.DB;
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE users SET status = 'inactive', deactivated_at = ?, pin_lookup = NULL, updated_at = ? WHERE id = ?`).bind(now, now, m.id),
    db.prepare(`UPDATE user_locations SET is_active = 0 WHERE user_id = ?`).bind(m.id),
    revokeUserSessions(db, m.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: locs[0], action: 'manager.deactivate', entityType: 'user', entityId: m.id, before: { status: 'active' }, after: { status: 'inactive' } }),
  ]);
  return c.json({ ok: true });
});

managerAdminRoutes.post('/managers/:id/reactivate', async (c) => {
  const { m, locs } = await guard(c, c.req.param('id'));
  if (m.status !== 'inactive') throw new ApiError(409, 'user_active');
  const db = c.env.DB;
  const tempSecret = generateTempPassword();
  const { hash, salt } = await hashSecret(tempSecret, c.env.AUTH_SECRET);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'active', deactivated_at = NULL, secret_hash = ?, secret_salt = ?, must_change_secret = 1,
           failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(hash, salt, now, m.id),
    db.prepare(`UPDATE user_locations SET is_active = 1 WHERE user_id = ?`).bind(m.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: locs[0], action: 'manager.reactivate', entityType: 'user', entityId: m.id, before: { status: 'inactive' }, after: { status: 'active' } }),
  ]);
  return c.json({ login: m.login, tempSecret, secretKind: 'password' });
});

managerAdminRoutes.delete('/managers/:id', async (c) => {
  const { m, locs } = await guard(c, c.req.param('id'));
  if (m.status !== 'inactive') throw new ApiError(409, 'delete_needs_inactive');
  const body = await readJson<{ confirm?: unknown }>(c.req.raw);
  if (!confirmMatches(body.confirm, m.login)) throw badRequest('delete_confirm_mismatch');
  const db = c.env.DB;
  const photos = await db
    .prepare(`SELECT photo_key AS k FROM time_punches WHERE user_id = ?1 AND photo_key IS NOT NULL UNION ALL SELECT photo_key FROM checklist_marks WHERE user_id = ?1 AND photo_key IS NOT NULL`)
    .bind(m.id)
    .all<{ k: string }>();
  await db.batch([
    ...purgeUserStatements(db, m.id, m.login),
    auditStatement(db, { actorId: c.var.user.id, locationId: locs[0], action: 'manager.delete', entityType: 'user', entityId: m.id }),
  ]);
  await deleteKeys(
    c.env.PHOTOS,
    photos.results.map((r) => r.k),
  ).catch(() => undefined);
  return c.json({ ok: true });
});

/** „Rozlicza czas pracy” on/off for one location: position to count the hours in, optional hourly rate. */
managerAdminRoutes.put('/managers/:id/time', async (c) => {
  const { access, m, locs } = await guard(c, c.req.param('id'));
  const body = await readJson<{ locationId?: unknown; enabled?: unknown; position?: unknown; rate?: unknown; validFrom?: unknown }>(c.req.raw);
  const locId = typeof body.locationId === 'string' ? body.locationId : '';
  if (!locs.includes(locId)) throw badRequest('location_invalid');
  const db = c.env.DB;
  const now = Date.now();
  if (body.enabled !== true) {
    await db.batch([
      db.prepare(`UPDATE users SET tracks_time = 0, pin_lookup = NULL, updated_at = ? WHERE id = ?`).bind(now, m.id),
      db.prepare(`DELETE FROM user_locations WHERE user_id = ? AND location_id = ?`).bind(m.id, locId),
      db.prepare(`INSERT INTO user_locations (id, user_id, location_id, position, is_primary) VALUES (?, ?, ?, 'shift_manager', 1)`).bind(newId('ul'), m.id, locId),
      auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'manager.time', entityType: 'user', entityId: m.id, after: { enabled: false } }),
    ]);
    return c.json({ ok: true });
  }
  const position = typeof body.position === 'string' && (POSITIONS as readonly string[]).includes(body.position) ? body.position : null;
  if (!position) throw badRequest('position_invalid');
  const grosze = body.rate === undefined || body.rate === null || body.rate === '' ? null : parseRate(body.rate);
  if (grosze !== null) requirePermission(access, locId, 'wages.manage');
  const validFrom = body.validFrom === undefined || body.validFrom === null || body.validFrom === '' ? warsawToday() : body.validFrom;
  if (!isIsoDate(validFrom)) throw badRequest('start_date_invalid');
  await db.batch([
    db.prepare(`UPDATE users SET tracks_time = 1, updated_at = ? WHERE id = ?`).bind(now, m.id),
    db.prepare(`DELETE FROM user_locations WHERE user_id = ? AND location_id = ?`).bind(m.id, locId),
    db
      .prepare(`INSERT INTO user_locations (id, user_id, location_id, position, start_date, is_active, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .bind(newId('ul'), m.id, locId, position, validFrom, m.status === 'active' ? 1 : 0),
    ...(grosze !== null
      ? [
          db
            .prepare(
              `INSERT INTO pay_rates (id, user_id, location_id, position, rate_grosze, valid_from, created_by, created_at) VALUES (?, ?, ?, '', ?, ?, ?, ?)
               ON CONFLICT (user_id, location_id, position, valid_from) DO UPDATE SET rate_grosze = excluded.rate_grosze, created_by = excluded.created_by, created_at = excluded.created_at`,
            )
            .bind(newId('rate'), m.id, locId, grosze, validFrom, c.var.user.id, now),
        ]
      : []),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'manager.time', entityType: 'user', entityId: m.id, after: { enabled: true, position, rateGrosze: grosze, validFrom } }),
  ]);
  return c.json({ ok: true });
});
