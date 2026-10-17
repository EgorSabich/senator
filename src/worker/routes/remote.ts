/**
 * Praca zdalna (owner, 2026-10-17; mockup 18): chosen call-center people start and end work in their own phone,
 * without the terminal. The entry is marked „zdalnie” (in_source / out_source = 'remote') in Czas pracy.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireLocation, loadAccess } from '../auth/access';
import { auditStatement } from '../lib/audit';
import { ApiError, newId } from '../lib/http';
import { locationRules } from '../lib/location';
import { businessDate, warsawDate } from '../../shared/time';
import { shiftEndMs, shiftStartMs } from '../../shared/schedule';

export const remoteRoutes = new Hono<AppEnv>();

const POSITION = 'call_center';

async function allowed(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string) {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireLocation(access, locId);
  const u = await c.env.DB.prepare(
    `SELECT u.remote_work AS rw FROM users u WHERE u.id = ? AND u.status = 'active' AND u.role = 'employee'
       AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ? AND ul.position = ? AND ul.is_active = 1)`,
  )
    .bind(c.var.user.id, locId, POSITION)
    .first<{ rw: number }>();
  return Boolean(u?.rw);
}

async function state(db: D1Database, userId: string, locId: string, now: number) {
  const { staleHours } = await locationRules(db, locId);
  const open = await db
    .prepare(`SELECT id, clock_in_at AS since, in_source AS source FROM time_entries WHERE user_id = ? AND location_id = ? AND clock_out_at IS NULL AND clock_in_at > ? ORDER BY clock_in_at DESC LIMIT 1`)
    .bind(userId, locId, now - staleHours * 3600_000)
    .first<{ id: string; since: number; source: string }>();
  const today = warsawDate(now);
  const shift = await db
    .prepare(`SELECT date, pub_start_min AS s, pub_end_min AS e FROM schedule_shifts WHERE location_id = ? AND user_id = ? AND date = ? AND published = 1 AND is_deleted = 0 ORDER BY pub_start_min LIMIT 1`)
    .bind(locId, userId, today)
    .first<{ date: string; s: number; e: number }>();
  return { open: open ?? null, shift: shift ? { start: shiftStartMs(shift.date, shift.s), end: shiftEndMs(shift.date, shift.e) } : null };
}

remoteRoutes.get('/locations/:locId/remote', async (c) => {
  const locId = c.req.param('locId');
  if (!(await allowed(c, locId))) return c.json({ allowed: false }, 200, { 'Cache-Control': 'no-store' });
  return c.json({ allowed: true, ...(await state(c.env.DB, c.var.user.id, locId, Date.now())) }, 200, { 'Cache-Control': 'no-store' });
});

remoteRoutes.post('/locations/:locId/remote/start', async (c) => {
  const locId = c.req.param('locId');
  if (!(await allowed(c, locId))) throw new ApiError(403, 'remote_not_allowed');
  const db = c.env.DB;
  const now = Date.now();
  const s = await state(db, c.var.user.id, locId, now);
  if (s.open) throw new ApiError(409, 'shift_open');
  const { dayStartHour } = await locationRules(db, locId);
  const id = newId('te');
  await db.batch([
    db
      .prepare(
        `INSERT INTO time_entries (id, location_id, user_id, business_date, clock_in_at, in_source, position, created_at) VALUES (?, ?, ?, ?, ?, 'remote', ?, ?)`,
      )
      .bind(id, locId, c.var.user.id, businessDate(now, dayStartHour), now, POSITION, now),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'time.remote_start', entityType: 'time_entry', entityId: id }),
  ]);
  return c.json({ allowed: true, ...(await state(db, c.var.user.id, locId, now)) });
});

remoteRoutes.post('/locations/:locId/remote/stop', async (c) => {
  const locId = c.req.param('locId');
  if (!(await allowed(c, locId))) throw new ApiError(403, 'remote_not_allowed');
  const db = c.env.DB;
  const now = Date.now();
  const s = await state(db, c.var.user.id, locId, now);
  if (!s.open || s.open.source !== 'remote') throw new ApiError(409, 'no_remote_shift');
  await db.batch([
    db.prepare(`UPDATE time_entries SET clock_out_at = ?, out_source = 'remote' WHERE id = ?`).bind(now, s.open.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'time.remote_stop', entityType: 'time_entry', entityId: s.open.id }),
  ]);
  return c.json({ allowed: true, minutes: Math.round((now - s.open.since) / 60000), ...(await state(db, c.var.user.id, locId, now)) });
});
