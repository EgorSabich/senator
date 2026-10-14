/**
 * Access layer — every request that touches location data goes through here (spec section B, G).
 * Unknown or foreign locations/users answer 404, so their existence is never revealed.
 */
import { PERMISSIONS, type Permission } from '../../shared/constants';
import type { SessionUser } from '../env';
import { ApiError, notFound } from '../lib/http';

export interface Access {
  userId: string;
  role: SessionUser['role'];
  /** locationId → permissions held there (employees: empty set = may read own data there). */
  locations: Map<string, Set<Permission>>;
}

export async function loadAccess(db: D1Database, user: SessionUser): Promise<Access> {
  const locations = new Map<string, Set<Permission>>();
  if (user.role === 'owner') {
    const { results } = await db.prepare(`SELECT id FROM locations WHERE is_active = 1`).all<{ id: string }>();
    for (const r of results) locations.set(r.id, new Set(PERMISSIONS));
  } else if (user.role === 'manager') {
    const { results } = await db
      .prepare(
        `SELECT mp.location_id AS loc, mp.permission AS perm FROM manager_permissions mp
         JOIN locations l ON l.id = mp.location_id AND l.is_active = 1
         WHERE mp.user_id = ?`,
      )
      .bind(user.id)
      .all<{ loc: string; perm: string }>();
    for (const r of results) {
      if (!locations.has(r.loc)) locations.set(r.loc, new Set());
      if ((PERMISSIONS as readonly string[]).includes(r.perm)) locations.get(r.loc)!.add(r.perm as Permission);
    }
  } else {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT ul.location_id AS loc FROM user_locations ul
         JOIN locations l ON l.id = ul.location_id AND l.is_active = 1
         WHERE ul.user_id = ? AND ul.is_active = 1`,
      )
      .bind(user.id)
      .all<{ loc: string }>();
    for (const r of results) locations.set(r.loc, new Set());
  }
  return { userId: user.id, role: user.role, locations };
}

export function requireLocation(access: Access, locationId: string): void {
  if (!access.locations.has(locationId)) throw notFound();
}

export function requirePermission(access: Access, locationId: string, permission: Permission): void {
  const perms = access.locations.get(locationId);
  if (!perms) throw notFound();
  if (!perms.has(permission)) throw new ApiError(403, 'forbidden');
}

export function requireOwner(access: Access): void {
  if (access.role !== 'owner') throw new ApiError(403, 'forbidden');
}

export interface TargetUser {
  id: string;
  role: SessionUser['role'];
  status: 'active' | 'inactive' | 'anonymized';
  secretKind: 'pin' | 'password';
  firstName: string;
  lastName: string;
  login: string;
}

/**
 * The actor may manage `targetId` with `permission` when:
 * - actor is owner (any user), or
 * - target is an employee working in a location where the actor holds `permission`.
 * Anything else → 404.
 */
export async function requireManageableUser(
  db: D1Database,
  access: Access,
  targetId: string,
  permission: Permission,
): Promise<TargetUser & { sharedLocationId: string | null }> {
  const target = await db
    .prepare(
      `SELECT id, role, status, secret_kind AS secretKind, first_name AS firstName, last_name AS lastName, login
       FROM users WHERE id = ?`,
    )
    .bind(targetId)
    .first<TargetUser>();
  if (!target || target.status === 'anonymized') throw notFound();
  if (access.role === 'owner') return { ...target, sharedLocationId: null };
  if (target.role !== 'employee') throw notFound();

  const { results } = await db
    .prepare(`SELECT DISTINCT location_id AS loc FROM user_locations WHERE user_id = ?`)
    .bind(targetId)
    .all<{ loc: string }>();
  const shared = results.find((r) => access.locations.get(r.loc)?.has(permission));
  if (!shared) {
    // Visible to the actor at all? Then 403, otherwise hide it.
    if (results.some((r) => access.locations.has(r.loc))) throw new ApiError(403, 'forbidden');
    throw notFound();
  }
  return { ...target, sharedLocationId: shared.loc };
}
