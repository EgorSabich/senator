/**
 * Time tracking in the panel (D35): calendar of shifts per person and day, corrections, terminal accounts.
 * Permission "time.manage" (owner always). Every change is in the audit log.
 */
import { Hono } from 'hono';
import { addDays, businessDate, dateRange, isIsoDate, OPEN_SHIFT_STALE_HOURS } from '../../shared/time';
import { proposeLogin } from '../../shared/text';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { generateTempPassword, hashSecret } from '../auth/crypto';
import { revokeUserSessions } from '../auth/session';
import { loadAccess, requireOwner, requirePermission } from '../auth/access';

export const timeAdminRoutes = new Hono<AppEnv>();

interface EntryRow {
  id: string;
  locationId: string;
  userId: string;
  businessDate: string;
  clockInAt: number;
  clockOutAt: number | null;
  inSource: string;
  outSource: string | null;
  note: string | null;
  editedAt: number | null;
  editedByName: string | null;
}

const ENTRY_SELECT = `SELECT e.id, e.location_id AS locationId, e.user_id AS userId, e.business_date AS businessDate,
  e.clock_in_at AS clockInAt, e.clock_out_at AS clockOutAt, e.in_source AS inSource, e.out_source AS outSource, e.note,
  e.edited_at AS editedAt, CASE WHEN ed.id IS NULL THEN NULL ELSE ed.first_name || ' ' || ed.last_name END AS editedByName
  FROM time_entries e LEFT JOIN users ed ON ed.id = e.edited_by`;

/** Calendar: people of the location × days, with every shift in the range. */
timeAdminRoutes.get('/locations/:locId/time', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'time.manage');
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest('invalid_input');
  const days = dateRange(from, to);
  const last = days[days.length - 1]!;

  const [people, entries] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.role, u.status,
                (SELECT ul.position FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ?1 ORDER BY ul.is_active DESC LIMIT 1) AS position
         FROM users u
         WHERE u.role <> 'terminal' AND u.status <> 'anonymized' AND (
           (u.status = 'active' AND (EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ?1 AND ul.is_active = 1)
                                     OR EXISTS (SELECT 1 FROM manager_permissions mp WHERE mp.user_id = u.id AND mp.location_id = ?1)))
           OR EXISTS (SELECT 1 FROM time_entries e WHERE e.user_id = u.id AND e.location_id = ?1 AND e.business_date BETWEEN ?2 AND ?3))`,
      )
      .bind(locId, from, last),
    db.prepare(`${ENTRY_SELECT} WHERE e.location_id = ? AND e.business_date BETWEEN ? AND ? ORDER BY e.clock_in_at`).bind(locId, from, last),
  ]);
  // Open shifts from before the range that still wait for an exit are shown too.
  const stale = await db
    .prepare(`${ENTRY_SELECT} WHERE e.location_id = ? AND e.clock_out_at IS NULL AND e.business_date < ? ORDER BY e.clock_in_at`)
    .bind(locId, from)
    .all<EntryRow>();
  return c.json({
    days,
    now: Date.now(),
    staleHours: OPEN_SHIFT_STALE_HOURS,
    people: people!.results,
    entries: entries!.results,
    openBefore: stale.results,
  });
});

function parseTimes(body: { clockInAt?: unknown; clockOutAt?: unknown }) {
  const inAt = typeof body.clockInAt === 'number' && Number.isFinite(body.clockInAt) ? Math.round(body.clockInAt) : NaN;
  const outAt = body.clockOutAt === null || body.clockOutAt === undefined ? null : typeof body.clockOutAt === 'number' ? Math.round(body.clockOutAt) : NaN;
  const now = Date.now();
  if (!Number.isFinite(inAt) || inAt > now + 60_000) throw badRequest('time_invalid');
  if (outAt !== null) {
    if (!Number.isFinite(outAt) || outAt <= inAt) throw badRequest('time_out_before_in');
    if (outAt - inAt > 24 * 3600_000) throw badRequest('time_too_long');
    if (outAt > now + 60_000) throw badRequest('time_invalid');
  }
  return { inAt, outAt };
}

async function overlaps(db: D1Database, userId: string, inAt: number, outAt: number | null, exceptId: string | null) {
  const end = outAt ?? inAt + 1;
  const hit = await db
    .prepare(
      `SELECT 1 FROM time_entries WHERE user_id = ? AND id <> ? AND clock_in_at < ? AND COALESCE(clock_out_at, clock_in_at + 1) > ? LIMIT 1`,
    )
    .bind(userId, exceptId ?? '', end, inAt)
    .first();
  return Boolean(hit);
}

/** Manual shift (forgotten terminal, phone broken…). */
timeAdminRoutes.post('/locations/:locId/time/entries', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'time.manage');
  const body = await readJson<{ userId?: unknown; clockInAt?: unknown; clockOutAt?: unknown; note?: unknown }>(c.req.raw);
  const userId = str(body.userId, 80);
  if (!userId) throw badRequest('invalid_input');
  const person = await db
    .prepare(
      `SELECT u.id FROM users u WHERE u.id = ? AND u.role <> 'terminal' AND u.status <> 'anonymized'
         AND (u.role = 'owner' OR EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ?)
              OR EXISTS (SELECT 1 FROM manager_permissions mp WHERE mp.user_id = u.id AND mp.location_id = ?))`,
    )
    .bind(userId, locId, locId)
    .first();
  if (!person) throw notFound();
  const { inAt, outAt } = parseTimes(body);
  if (await overlaps(db, userId, inAt, outAt, null)) throw new ApiError(409, 'time_overlap');
  const note = str(body.note, 300);
  const id = newId('te');
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO time_entries (id, location_id, user_id, business_date, clock_in_at, clock_out_at, in_source, out_source, note, edited_by, edited_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
      )
      .bind(id, locId, userId, businessDate(inAt), inAt, outAt, outAt === null ? null : 'manual', note, c.var.user.id, now, now),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'time.entry_add', entityType: 'time_entry', entityId: id, after: { userId, clockInAt: inAt, clockOutAt: outAt, note } }),
  ]);
  return c.json({ id }, 201);
});

async function loadEntry(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const e = await db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(id).first<EntryRow>();
  if (!e || !access.locations.has(e.locationId)) throw notFound();
  requirePermission(access, e.locationId, 'time.manage');
  return e;
}

/** Correct the times (e.g. add a forgotten exit). */
timeAdminRoutes.put('/time/entries/:id', async (c) => {
  const db = c.env.DB;
  const e = await loadEntry(c, c.req.param('id'));
  const body = await readJson<{ clockInAt?: unknown; clockOutAt?: unknown; note?: unknown }>(c.req.raw);
  const { inAt, outAt } = parseTimes(body);
  if (await overlaps(db, e.userId, inAt, outAt, e.id)) throw new ApiError(409, 'time_overlap');
  const note = body.note === undefined ? e.note : str(body.note, 300);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE time_entries SET clock_in_at = ?, clock_out_at = ?, business_date = ?, note = ?,
           in_source = CASE WHEN clock_in_at = ? THEN in_source ELSE 'manual' END,
           out_source = CASE WHEN ? IS NULL THEN NULL WHEN clock_out_at = ? THEN out_source ELSE 'manual' END,
           edited_by = ?, edited_at = ? WHERE id = ?`,
      )
      .bind(inAt, outAt, businessDate(inAt), note, inAt, outAt, outAt, c.var.user.id, now, e.id),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: e.locationId,
      action: 'time.entry_edit',
      entityType: 'time_entry',
      entityId: e.id,
      before: { clockInAt: e.clockInAt, clockOutAt: e.clockOutAt, note: e.note },
      after: { clockInAt: inAt, clockOutAt: outAt, note },
    }),
  ]);
  return c.json({ ok: true });
});

timeAdminRoutes.delete('/time/entries/:id', async (c) => {
  const db = c.env.DB;
  const e = await loadEntry(c, c.req.param('id'));
  await db.batch([
    db.prepare(`UPDATE time_punches SET entry_id = NULL WHERE entry_id = ?`).bind(e.id),
    db.prepare(`DELETE FROM time_entries WHERE id = ?`).bind(e.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: e.locationId, action: 'time.entry_delete', entityType: 'time_entry', entityId: e.id, before: { userId: e.userId, clockInAt: e.clockInAt, clockOutAt: e.clockOutAt } }),
  ]);
  return c.json({ ok: true });
});

/** Every PIN entered on the terminals of a day (incl. unknown PINs) — to check disputes. */
timeAdminRoutes.get('/locations/:locId/time/punches', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'time.manage');
  const date = c.req.query('date');
  if (!isIsoDate(date)) throw badRequest('invalid_input');
  const { results } = await db
    .prepare(
      `SELECT p.id, p.at, p.offline, p.outcome, t.name AS terminal,
              CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END AS person
       FROM time_punches p JOIN terminals t ON t.id = p.terminal_id LEFT JOIN users u ON u.id = p.user_id
       WHERE t.location_id = ? AND p.at >= ? AND p.at < ? ORDER BY p.at`,
    )
    .bind(locId, Date.parse(addDays(date, -1) + 'T00:00:00Z'), Date.parse(addDays(date, 2) + 'T00:00:00Z'))
    .all<{ at: number }>();
  return c.json({ punches: results.filter((p) => businessDate(p.at) === date) });
});

/* ───────── Terminal accounts (owner) ───────── */

timeAdminRoutes.get('/locations/:locId/terminals', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'time.manage');
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.last_seen_at AS lastSeenAt, u.login, u.status,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
       FROM terminals t JOIN users u ON u.id = t.user_id WHERE t.location_id = ? ORDER BY t.created_at`,
    )
    .bind(Date.now(), locId)
    .all();
  return c.json({ terminals: results, canManage: access.role === 'owner' });
});

timeAdminRoutes.post('/locations/:locId/terminals', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireOwner(access);
  if (!access.locations.has(locId)) throw notFound();
  const body = await readJson<{ name?: unknown }>(c.req.raw);
  const name = str(body.name, 60);
  if (!name) throw badRequest('name_required');
  const loc = await db.prepare(`SELECT slug FROM locations WHERE id = ?`).bind(locId).first<{ slug: string }>();
  const base = proposeLogin('terminal', `${loc?.slug ?? ''} ${name}`) || 'terminal';
  let login = base;
  for (let i = 2; await db.prepare(`SELECT 1 FROM users WHERE login = ?`).bind(login).first(); i++) login = `${base}${i}`;
  const password = generateTempPassword();
  const { hash, salt } = await hashSecret(password, c.env.AUTH_SECRET);
  const userId = newId('usr');
  const id = newId('trm');
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_salt, secret_kind, must_change_secret)
         VALUES (?, 'Terminal', ?, ?, 'terminal', 'active', ?, ?, 'password', 0)`,
      )
      .bind(userId, name, login, hash, salt),
    db.prepare(`INSERT INTO terminals (id, location_id, user_id, name) VALUES (?, ?, ?, ?)`).bind(id, locId, userId, name),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'terminal.create', entityType: 'terminal', entityId: id, after: { name, login } }),
  ]);
  return c.json({ id, login, tempSecret: password, secretKind: 'password' }, 201);
});

async function loadTerminalAdmin(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireOwner(access);
  const t = await db
    .prepare(`SELECT t.id, t.location_id AS locationId, t.user_id AS userId, t.name, u.login FROM terminals t JOIN users u ON u.id = t.user_id WHERE t.id = ?`)
    .bind(id)
    .first<{ id: string; locationId: string; userId: string; name: string; login: string }>();
  if (!t || !access.locations.has(t.locationId)) throw notFound();
  return t;
}

/** New password for the terminal account; the phone is signed out. */
timeAdminRoutes.post('/terminals/:id/reset', async (c) => {
  const db = c.env.DB;
  const t = await loadTerminalAdmin(c, c.req.param('id'));
  const password = generateTempPassword();
  const { hash, salt } = await hashSecret(password, c.env.AUTH_SECRET);
  await db.batch([
    db
      .prepare(`UPDATE users SET secret_hash = ?, secret_salt = ?, status = 'active', failed_attempts = 0, lock_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
      .bind(hash, salt, Date.now(), t.userId),
    revokeUserSessions(db, t.userId),
    auditStatement(db, { actorId: c.var.user.id, locationId: t.locationId, action: 'terminal.reset', entityType: 'terminal', entityId: t.id }),
  ]);
  return c.json({ login: t.login, tempSecret: password, secretKind: 'password' });
});

/** Switch a terminal off (lost phone): the account stops working at once; history stays. */
timeAdminRoutes.post('/terminals/:id/disable', async (c) => {
  const db = c.env.DB;
  const t = await loadTerminalAdmin(c, c.req.param('id'));
  await db.batch([
    db.prepare(`UPDATE users SET status = 'inactive', deactivated_at = ?, updated_at = ? WHERE id = ?`).bind(Date.now(), Date.now(), t.userId),
    revokeUserSessions(db, t.userId),
    auditStatement(db, { actorId: c.var.user.id, locationId: t.locationId, action: 'terminal.disable', entityType: 'terminal', entityId: t.id }),
  ]);
  return c.json({ ok: true });
});
