/**
 * People, locations and permissions (stage 2). Every handler: session → access → location/permission check.
 */
import { Hono } from 'hono';
import {
  DEFAULT_MANAGER_PERMISSIONS,
  DIVISION_SCOPE_PREFIX,
  MANAGER_ROLES,
  ROLE_PREFIX,
  PERMISSIONS,
  POSITIONS,
  type Permission,
} from '../../shared/constants';
import { foldPolish, proposeLogin } from '../../shared/text';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { generateTempPassword, generateTempPin, hashSecret } from '../auth/crypto';
import { revokeUserSessions } from '../auth/session';
import { allowedDivisions, loadAccess, requireManageableUser, requireOwner, requireOwnerOr, requirePermission, scopedUserIds, type Access } from '../auth/access';
import { confirmMatches, purgeUserStatements } from '../lib/purge';
import { deleteKeys } from '../jobs/punchPhotos';

export const adminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

async function uniqueLogin(db: D1Database, base: string): Promise<string> {
  const root = base || 'pracownik';
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}${i}`;
    const hit = await db.prepare(`SELECT 1 FROM users WHERE login = ?`).bind(candidate).first();
    if (!hit) return candidate;
  }
  throw new ApiError(409, 'login_taken');
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/* ───────── Locations ───────── */

adminRoutes.get('/locations', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  const ids = [...access.locations.keys()];
  if (!ids.length) return c.json({ locations: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, slug FROM locations WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`,
  )
    .bind(...ids)
    .all();
  return c.json({ locations: results });
});

adminRoutes.post('/locations', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireOwner(access);
  const body = await readJson<{ name?: unknown }>(c.req.raw);
  const name = str(body.name, 80);
  if (!name) throw badRequest('name_required');
  const slug = foldPolish(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lokal';
  if (await c.env.DB.prepare(`SELECT 1 FROM locations WHERE slug = ?`).bind(slug).first()) {
    throw new ApiError(409, 'location_exists');
  }
  const id = newId('loc');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO locations (id, name, slug) VALUES (?, ?, ?)`).bind(id, name, slug),
    auditStatement(c.env.DB, { actorId: c.var.user.id, locationId: id, action: 'location.create', entityType: 'location', entityId: id, after: { name } }),
  ]);
  return c.json({ id, name, slug }, 201);
});

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface LocationRow {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHoursJson: string | null;
  staffNote: string | null;
  dayStartHour: number;
  staleHours: number;
  punchPhoto: number;
  unavailDeadlineDow: number;
  unavailDeadlineHour: number;
}

const LOCATION_SELECT = `SELECT id, name, slug, address, phone, email, opening_hours_json AS openingHoursJson, staff_note AS staffNote,
  day_start_hour AS dayStartHour, stale_hours AS staleHours, punch_photo AS punchPhoto,
  unavail_deadline_dow AS unavailDeadlineDow, unavail_deadline_hour AS unavailDeadlineHour FROM locations`;

export function locationView(l: LocationRow) {
  let hours: Record<string, string> = {};
  try {
    hours = l.openingHoursJson ? (JSON.parse(l.openingHoursJson) as Record<string, string>) : {};
  } catch {
    hours = {};
  }
  return {
    id: l.id,
    name: l.name,
    address: l.address,
    phone: l.phone,
    email: l.email,
    openingHours: Object.fromEntries(DAYS.map((d) => [d, typeof hours[d] === 'string' ? hours[d] : ''])),
    staffNote: l.staffNote,
    dayStartHour: l.dayStartHour,
    staleHours: l.staleHours,
    punchPhoto: Boolean(l.punchPhoto),
    unavailDeadlineDow: l.unavailDeadlineDow ?? 0,
    unavailDeadlineHour: l.unavailDeadlineHour ?? 23,
  };
}

/** Location settings and a short summary (D38). Owner edits; managers of the location can read. */
adminRoutes.get('/locations/:id/settings', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const id = c.req.param('id');
  if (!access.locations.has(id)) throw notFound();
  const l = await db.prepare(`${LOCATION_SELECT} WHERE id = ?`).bind(id).first<LocationRow>();
  if (!l) throw notFound();
  const now = Date.now();
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT ul.user_id) FROM user_locations ul JOIN users u ON u.id = ul.user_id WHERE ul.location_id = ?1 AND ul.is_active = 1 AND u.status = 'active' AND u.role = 'employee') AS employees,
         (SELECT COUNT(DISTINCT mp.user_id) FROM manager_permissions mp JOIN users u ON u.id = mp.user_id WHERE mp.location_id = ?1 AND u.status = 'active') AS managers,
         (SELECT COUNT(*) FROM terminals t JOIN users u ON u.id = t.user_id WHERE t.location_id = ?1 AND u.status = 'active') AS terminals,
         (SELECT COUNT(*) FROM content_items WHERE (location_id = ?1 OR location_id IS NULL) AND status = 'published') AS materials,
         (SELECT COUNT(*) FROM menu_items WHERE location_id = ?1 AND is_active = 1) AS menuItems,
         (SELECT COUNT(*) FROM programs WHERE location_id = ?1) AS programs,
         (SELECT COUNT(*) FROM time_entries WHERE location_id = ?1 AND clock_out_at IS NULL AND clock_in_at > ?2) AS onShift`,
    )
    .bind(id, now - l.staleHours * 3600_000)
    .first<Record<string, number>>();
  return c.json({ location: locationView(l), counts, canEdit: access.role === 'owner' || Boolean(access.locations.get(id)?.has('locations.manage')) });
});

adminRoutes.put('/locations/:id/settings', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const id = c.req.param('id');
  if (!access.locations.has(id)) throw notFound();
  if (access.role !== 'owner') requirePermission(access, id, 'locations.manage');
  const before = await db.prepare(`${LOCATION_SELECT} WHERE id = ?`).bind(id).first<LocationRow>();
  if (!before) throw notFound();
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const name = body.name === undefined ? before.name : str(body.name, 80);
  if (!name) throw badRequest('name_required');
  const text = (k: string, max: number, old: string | null) => (body[k] === undefined ? old : str(body[k], max));
  const email = text('email', 120, before.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('email_invalid');
  const hoursIn = body.openingHours;
  let hoursJson = before.openingHoursJson;
  if (hoursIn !== undefined) {
    if (!hoursIn || typeof hoursIn !== 'object') throw badRequest('invalid_input');
    const h: Record<string, string> = {};
    for (const d of DAYS) {
      const v = (hoursIn as Record<string, unknown>)[d];
      h[d] = typeof v === 'string' ? v.trim().slice(0, 40) : '';
    }
    hoursJson = JSON.stringify(h);
  }
  const int = (k: string, min: number, max: number, old: number) => {
    if (body[k] === undefined) return old;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest('setting_invalid', { field: k });
    return n;
  };
  const dayStartHour = int('dayStartHour', 0, 12, before.dayStartHour);
  const staleHours = int('staleHours', 8, 24, before.staleHours);
  if (body.punchPhoto !== undefined && typeof body.punchPhoto !== 'boolean') throw badRequest('setting_invalid', { field: 'punchPhoto' });
  const unavailDeadlineDow = int('unavailDeadlineDow', 0, 6, before.unavailDeadlineDow);
  const unavailDeadlineHour = int('unavailDeadlineHour', 0, 23, before.unavailDeadlineHour);
  const punchPhoto = body.punchPhoto === undefined ? Boolean(before.punchPhoto) : (body.punchPhoto as boolean);
  const after = {
    name,
    address: text('address', 200, before.address),
    phone: text('phone', 40, before.phone),
    email,
    openingHoursJson: hoursJson,
    staffNote: text('staffNote', 1000, before.staffNote),
    dayStartHour,
    staleHours,
    punchPhoto,
    unavailDeadlineDow,
    unavailDeadlineHour,
  };
  await db.batch([
    db
      .prepare(
        `UPDATE locations SET name = ?, address = ?, phone = ?, email = ?, opening_hours_json = ?, staff_note = ?, day_start_hour = ?, stale_hours = ?, punch_photo = ?, unavail_deadline_dow = ?, unavail_deadline_hour = ? WHERE id = ?`,
      )
      .bind(after.name, after.address, after.phone, after.email, after.openingHoursJson, after.staffNote, after.dayStartHour, after.staleHours, after.punchPhoto ? 1 : 0, after.unavailDeadlineDow, after.unavailDeadlineHour, id),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: id,
      action: 'location.update',
      entityType: 'location',
      entityId: id,
      before: { name: before.name, dayStartHour: before.dayStartHour, staleHours: before.staleHours, punchPhoto: Boolean(before.punchPhoto) },
      after: { name, dayStartHour, staleHours, punchPhoto },
    }),
  ]);
  return c.json({ ok: true });
});

/* ───────── Employees ───────── */

adminRoutes.get('/locations/:locId/employees', async (c) => {
  const locId = c.req.param('locId');
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'employees.view');
  const scope = allowedDivisions(access, locId);
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.login, u.role, u.status,
            ul.position, ul.start_date AS startDate, u.last_login_at AS lastLoginAt,
            CASE WHEN u.locked_until > ? THEN 1 ELSE 0 END AS locked
     FROM user_locations ul JOIN users u ON u.id = ul.user_id
     WHERE ul.location_id = ? AND u.status <> 'anonymized'
     ORDER BY u.last_name, u.first_name`,
  )
    .bind(now, locId)
    .all<{ position: string; role: string }>();
  // D44: a chef sees the kitchen, a floor manager the floor… (managers themselves only for unscoped people)
  // leaders are listed in "Kadra kierownicza", not among the staff (owner, 2026-10-17)
  const staff = results.filter((r) => r.role === 'employee');
  return c.json({ employees: scope ? staff.filter((r) => scope.has(r.position)) : staff, divisions: scope ? [...(access.divisions.get(locId) ?? [])] : null });
});

adminRoutes.post('/locations/:locId/employees', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'employees.manage');

  const body = await readJson<{ firstName?: unknown; lastName?: unknown; position?: unknown; startDate?: unknown }>(c.req.raw);
  const firstName = str(body.firstName, 60);
  const lastName = str(body.lastName, 80);
  const position = typeof body.position === 'string' && (POSITIONS as readonly string[]).includes(body.position) ? body.position : null;
  if (!firstName || !lastName) throw badRequest('name_required');
  if (!position) throw badRequest('position_invalid');
  const scope = allowedDivisions(access, locId);
  if (scope && !scope.has(position)) throw new ApiError(403, 'outside_divisions');
  if (body.startDate !== undefined && body.startDate !== null && !isIsoDate(body.startDate)) throw badRequest('start_date_invalid');

  const id = newId('usr');
  const login = await uniqueLogin(db, proposeLogin(firstName, lastName));
  const tempSecret = generateTempPin();
  const { hash, salt } = await hashSecret(tempSecret, c.env.AUTH_SECRET);

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_salt, secret_kind, must_change_secret)
         VALUES (?, ?, ?, ?, 'employee', 'active', ?, ?, 'pin', 1)`,
      )
      .bind(id, firstName, lastName, login, hash, salt),
    db
      .prepare(`INSERT INTO user_locations (id, user_id, location_id, position, start_date) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId('ul'), id, locId, position, (body.startDate as string | undefined) ?? null),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: locId,
      action: 'user.create',
      entityType: 'user',
      entityId: id,
      after: { firstName, lastName, login, position, startDate: body.startDate ?? null },
    }),
  ]);
  // The temporary PIN is shown once and never stored in clear text.
  return c.json({ id, login, tempSecret, secretKind: 'pin' }, 201);
});

adminRoutes.post('/users/:id/reset-secret', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  if (target.status !== 'active') throw new ApiError(409, 'user_inactive');
  const tempSecret = target.secretKind === 'pin' ? generateTempPin() : generateTempPassword();
  const { hash, salt } = await hashSecret(tempSecret, c.env.AUTH_SECRET);
  await db.batch([
    db
      .prepare(
        `UPDATE users SET secret_hash = ?, secret_salt = ?, must_change_secret = 1, failed_attempts = 0, lock_count = 0,
           locked_until = NULL, pin_lookup = CASE WHEN secret_kind = 'pin' THEN NULL ELSE pin_lookup END, updated_at = ? WHERE id = ?`,
      )
      .bind(hash, salt, Date.now(), target.id),
    revokeUserSessions(db, target.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.reset_secret', entityType: 'user', entityId: target.id }),
  ]);
  return c.json({ login: target.login, tempSecret, secretKind: target.secretKind });
});

adminRoutes.post('/users/:id/unlock', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  await db.batch([
    db.prepare(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`).bind(target.id),
    // Clears the per-login window too, so the next attempt is not counted against old failures.
    db.prepare(`DELETE FROM login_attempts WHERE login = ? AND success = 0`).bind(target.login),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.unlock', entityType: 'user', entityId: target.id }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/logout-all', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  await db.batch([
    revokeUserSessions(db, target.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.logout_all', entityType: 'user', entityId: target.id }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/deactivate', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  if (target.id === c.var.user.id) throw new ApiError(409, 'cannot_deactivate_self');
  if (target.role === 'owner') throw new ApiError(409, 'cannot_deactivate_owner');
  if (target.status !== 'active') throw new ApiError(409, 'user_inactive');
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE users SET status = 'inactive', deactivated_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, target.id),
    db.prepare(`UPDATE user_locations SET is_active = 0 WHERE user_id = ?`).bind(target.id),
    revokeUserSessions(db, target.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.deactivate', entityType: 'user', entityId: target.id, before: { status: 'active' }, after: { status: 'inactive' } }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/reactivate', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  if (target.status !== 'inactive') throw new ApiError(409, 'user_active');
  const tempSecret = target.secretKind === 'pin' ? generateTempPin() : generateTempPassword();
  const { hash, salt } = await hashSecret(tempSecret, c.env.AUTH_SECRET);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'active', deactivated_at = NULL, secret_hash = ?, secret_salt = ?, must_change_secret = 1,
           failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(hash, salt, now, target.id),
    db.prepare(`UPDATE user_locations SET is_active = 1 WHERE user_id = ?`).bind(target.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.reactivate', entityType: 'user', entityId: target.id, before: { status: 'inactive' }, after: { status: 'active' } }),
  ]);
  return c.json({ login: target.login, tempSecret, secretKind: target.secretKind });
});

/** What a permanent deletion removes — shown in the confirmation dialog. */
adminRoutes.get('/users/:id/deletion', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM test_attempts WHERE user_id = ?1) AS attempts,
              (SELECT COUNT(*) FROM content_acknowledgements WHERE user_id = ?1) AS acknowledgements`,
    )
    .bind(target.id)
    .first<{ attempts: number; acknowledgements: number }>();
  return c.json({ confirmText: target.login, attempts: row?.attempts ?? 0, acknowledgements: row?.acknowledgements ?? 0 });
});

/** Permanent deletion (D30): only a deactivated person, never yourself or the owner; the login must be typed. */
adminRoutes.delete('/users/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const target = await requireManageableUser(db, access, c.req.param('id'), 'employees.manage');
  if (target.id === c.var.user.id) throw new ApiError(409, 'cannot_delete_self');
  if (target.role === 'owner') throw new ApiError(409, 'cannot_delete_owner');
  if (target.status !== 'inactive') throw new ApiError(409, 'delete_needs_inactive');
  const body = await readJson<{ confirm?: unknown }>(c.req.raw);
  if (!confirmMatches(body.confirm, target.login)) throw badRequest('delete_confirm_mismatch');
  const photos = await db
    .prepare(`SELECT photo_key AS k FROM time_punches WHERE user_id = ?1 AND photo_key IS NOT NULL UNION ALL SELECT photo_key FROM checklist_marks WHERE user_id = ?1 AND photo_key IS NOT NULL`)
    .bind(target.id)
    .all<{ k: string }>();
  await db.batch([
    ...purgeUserStatements(db, target.id, target.login),
    auditStatement(db, { actorId: c.var.user.id, locationId: target.sharedLocationId, action: 'user.delete', entityType: 'user', entityId: target.id }),
  ]);
  await deleteKeys(
    c.env.PHOTOS,
    photos.results.map((r) => r.k),
  ).catch(() => undefined); // a failed delete leaves an unlinked file in the private bucket; nothing points to it
  return c.json({ ok: true });
});

/* ───────── Managers & permissions (owner only) ───────── */

function parsePermissions(v: unknown): Permission[] {
  if (!Array.isArray(v)) throw badRequest('permissions_invalid');
  const out = [...new Set(v)];
  const ok = (p: unknown) =>
    typeof p === 'string' &&
    ((PERMISSIONS as readonly string[]).includes(p) ||
      (p.startsWith(DIVISION_SCOPE_PREFIX) && (POSITIONS as readonly string[]).includes(p.slice(DIVISION_SCOPE_PREFIX.length))) ||
      (p.startsWith(ROLE_PREFIX) && p.slice(ROLE_PREFIX.length) in MANAGER_ROLES));
  if (!out.every(ok)) {
    throw badRequest('permissions_invalid');
  }
  return out as Permission[];
}

adminRoutes.post('/managers', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireOwnerOr(access, 'managers.manage');
  const body = await readJson<{ firstName?: unknown; lastName?: unknown; locationId?: unknown; permissions?: unknown }>(c.req.raw);
  const firstName = str(body.firstName, 60);
  const lastName = str(body.lastName, 80);
  const locationId = str(body.locationId, 80);
  if (!firstName || !lastName) throw badRequest('name_required');
  if (!locationId || !access.locations.has(locationId)) throw badRequest('location_invalid');
  if (access.role !== 'owner') requirePermission(access, locationId, 'managers.manage');
  const permissions = body.permissions === undefined ? DEFAULT_MANAGER_PERMISSIONS : parsePermissions(body.permissions);

  const id = newId('usr');
  const login = await uniqueLogin(db, proposeLogin(firstName, lastName));
  const tempSecret = generateTempPassword();
  const { hash, salt } = await hashSecret(tempSecret, c.env.AUTH_SECRET);
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, first_name, last_name, login, role, status, secret_hash, secret_salt, secret_kind, must_change_secret)
         VALUES (?, ?, ?, ?, 'manager', 'active', ?, ?, 'password', 1)`,
      )
      .bind(id, firstName, lastName, login, hash, salt),
    db
      .prepare(`INSERT INTO user_locations (id, user_id, location_id, position) VALUES (?, ?, ?, 'shift_manager')`)
      .bind(newId('ul'), id, locationId),
    ...permissions.map((p) =>
      db
        .prepare(`INSERT INTO manager_permissions (user_id, location_id, permission, granted_by) VALUES (?, ?, ?, ?)`)
        .bind(id, locationId, p, c.var.user.id),
    ),
    auditStatement(db, { actorId: c.var.user.id, locationId, action: 'manager.create', entityType: 'user', entityId: id, after: { firstName, lastName, login, permissions } }),
  ]);
  return c.json({ id, login, tempSecret, secretKind: 'password', permissions }, 201);
});

adminRoutes.put('/managers/:id/permissions', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireOwnerOr(access, 'managers.manage');
  const managerId = c.req.param('id');
  if (managerId === c.var.user.id) throw new ApiError(403, 'own_permissions');
  const body = await readJson<{ locationId?: unknown; permissions?: unknown }>(c.req.raw);
  const locationId = str(body.locationId, 80);
  if (!locationId || !access.locations.has(locationId)) throw badRequest('location_invalid');
  if (access.role !== 'owner') requirePermission(access, locationId, 'managers.manage');
  const permissions = parsePermissions(body.permissions);
  const manager = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'manager'`).bind(managerId).first();
  if (!manager) throw new ApiError(404, 'not_found');

  const { results: before } = await db
    .prepare(`SELECT permission FROM manager_permissions WHERE user_id = ? AND location_id = ?`)
    .bind(managerId, locationId)
    .all<{ permission: string }>();
  await db.batch([
    db.prepare(`DELETE FROM manager_permissions WHERE user_id = ? AND location_id = ?`).bind(managerId, locationId),
    ...permissions.map((p) =>
      db
        .prepare(`INSERT INTO manager_permissions (user_id, location_id, permission, granted_by) VALUES (?, ?, ?, ?)`)
        .bind(managerId, locationId, p, c.var.user.id),
    ),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId,
      action: 'manager.permissions',
      entityType: 'user',
      entityId: managerId,
      before: before.map((r) => r.permission),
      after: permissions,
    }),
  ]);
  return c.json({ ok: true, permissions });
});

/* ───────── Audit log (owner) ───────── */

adminRoutes.get('/audit', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireOwnerOr(access, 'audit.view');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  // a zarządzający sees the log of the locations where he holds audit.view (D44)
  const locs = access.role === 'owner' ? null : [...access.locations.entries()].filter(([, p]) => p.has('audit.view')).map(([l]) => l);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.location_id AS locationId,
            a.before_json AS beforeJson, a.after_json AS afterJson, a.created_at AS createdAt,
            u.first_name AS actorFirstName, u.last_name AS actorLastName
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ${locs ? `WHERE a.location_id IN (${locs.map(() => '?').join(', ')})` : ''}
     ORDER BY a.created_at DESC LIMIT ?`,
  )
    .bind(...(locs ?? []), limit)
    .all();
  return c.json({ entries: results });
});

adminRoutes.get('/managers', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireOwnerOr(access, 'managers.manage');
  const now = Date.now();
  const { results: managers } = await c.env.DB.prepare(
    `SELECT id, first_name AS firstName, last_name AS lastName, login, status, last_login_at AS lastLoginAt,
            CASE WHEN locked_until > ? THEN 1 ELSE 0 END AS locked
     FROM users WHERE role = 'manager' AND status <> 'anonymized' ORDER BY last_name, first_name`,
  )
    .bind(now)
    .all<{ id: string }>();
  const { results: perms } = await c.env.DB.prepare(
    `SELECT mp.user_id AS userId, mp.location_id AS locationId, mp.permission FROM manager_permissions mp
     JOIN users u ON u.id = mp.user_id WHERE u.role = 'manager'`,
  ).all<{ userId: string; locationId: string; permission: string }>();
  return c.json({
    managers: managers.map((m) => {
      const byLoc: Record<string, string[]> = {};
      for (const p of perms) if (p.userId === m.id && (access.role === 'owner' || access.locations.get(p.locationId)?.has('managers.manage'))) (byLoc[p.locationId] ??= []).push(p.permission);
      return { ...m, permissions: byLoc, self: m.id === c.var.user.id };
    })
      .filter((m) => access.role === 'owner' || Object.keys(m.permissions).length > 0),
  });
});
