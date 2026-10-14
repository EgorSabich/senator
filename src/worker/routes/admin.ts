/**
 * People, locations and permissions (stage 2). Every handler: session → access → location/permission check.
 */
import { Hono } from 'hono';
import {
  DEFAULT_MANAGER_PERMISSIONS,
  PERMISSIONS,
  POSITIONS,
  type Permission,
} from '../../shared/constants';
import { foldPolish, proposeLogin } from '../../shared/text';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, readJson, str } from '../lib/http';
import { generateTempPassword, generateTempPin, hashSecret } from '../auth/crypto';
import { revokeUserSessions } from '../auth/session';
import { loadAccess, requireManageableUser, requireOwner, requirePermission } from '../auth/access';

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

/* ───────── Employees ───────── */

adminRoutes.get('/locations/:locId/employees', async (c) => {
  const locId = c.req.param('locId');
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'employees.view');
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
    .all();
  return c.json({ employees: results });
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
           locked_until = NULL, updated_at = ? WHERE id = ?`,
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

/* ───────── Managers & permissions (owner only) ───────── */

function parsePermissions(v: unknown): Permission[] {
  if (!Array.isArray(v)) throw badRequest('permissions_invalid');
  const out = [...new Set(v)];
  if (!out.every((p) => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p))) {
    throw badRequest('permissions_invalid');
  }
  return out as Permission[];
}

adminRoutes.post('/managers', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireOwner(access);
  const body = await readJson<{ firstName?: unknown; lastName?: unknown; locationId?: unknown; permissions?: unknown }>(c.req.raw);
  const firstName = str(body.firstName, 60);
  const lastName = str(body.lastName, 80);
  const locationId = str(body.locationId, 80);
  if (!firstName || !lastName) throw badRequest('name_required');
  if (!locationId || !access.locations.has(locationId)) throw badRequest('location_invalid');
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
  requireOwner(access);
  const managerId = c.req.param('id');
  const body = await readJson<{ locationId?: unknown; permissions?: unknown }>(c.req.raw);
  const locationId = str(body.locationId, 80);
  if (!locationId || !access.locations.has(locationId)) throw badRequest('location_invalid');
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
  requireOwner(access);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.location_id AS locationId,
            a.before_json AS beforeJson, a.after_json AS afterJson, a.created_at AS createdAt,
            u.first_name AS actorFirstName, u.last_name AS actorLastName
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ entries: results });
});

adminRoutes.get('/managers', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireOwner(access);
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
      for (const p of perms) if (p.userId === m.id) (byLoc[p.locationId] ??= []).push(p.permission);
      return { ...m, permissions: byLoc };
    }),
  });
});
