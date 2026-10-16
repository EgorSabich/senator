/**
 * Access layer — every request that touches location data goes through here (spec section B, G).
 * Unknown or foreign locations/users answer 404, so their existence is never revealed.
 */
import { DIVISION_SCOPE_PREFIX, PERMISSIONS, POSITIONS, type Permission } from '../../shared/constants';
import type { SessionUser } from '../env';
import { ApiError, notFound } from '../lib/http';

export interface Access {
  userId: string;
  role: SessionUser['role'];
  /** locationId → permissions held there (employees: empty set = may read own data there). */
  locations: Map<string, Set<Permission>>;
  /** locationId → divisions a manager is limited to (D43); missing or empty = all divisions. */
  divisions: Map<string, Set<string>>;
}

export async function loadAccess(db: D1Database, user: SessionUser): Promise<Access> {
  const locations = new Map<string, Set<Permission>>();
  const divisions = new Map<string, Set<string>>();
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
      else if (r.perm.startsWith(DIVISION_SCOPE_PREFIX)) {
        if (!divisions.has(r.loc)) divisions.set(r.loc, new Set());
        divisions.get(r.loc)!.add(r.perm.slice(DIVISION_SCOPE_PREFIX.length));
      }
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
  return { userId: user.id, role: user.role, locations, divisions };
}

/** Divisions this person may manage at a location (null = all). */
export function allowedDivisions(access: Access, locationId: string): Set<string> | null {
  const d = access.divisions.get(locationId);
  return d && d.size ? d : null;
}

export function requireDivision(access: Access, locationId: string, division: string): void {
  const d = allowedDivisions(access, locationId);
  if (d && !d.has(division)) throw new ApiError(403, 'forbidden');
}

/** Does a person (by positions at the location) fall into the actor's divisions? Owner / unscoped: always. */
export async function userInScope(db: D1Database, access: Access, locationId: string, userId: string): Promise<boolean> {
  const scope = allowedDivisions(access, locationId);
  if (!scope) return true;
  const { results } = await db.prepare(`SELECT position FROM user_locations WHERE user_id = ? AND location_id = ?`).bind(userId, locationId).all<{ position: string }>();
  return results.some((r) => scope.has(r.position));
}

/** Ids of people at the location the actor may see in staff data (null = everyone). */
export async function scopedUserIds(db: D1Database, access: Access, locationId: string): Promise<Set<string> | null> {
  const scope = allowedDivisions(access, locationId);
  if (!scope) return null;
  const { results } = await db
    .prepare(`SELECT DISTINCT user_id AS id FROM user_locations WHERE location_id = ? AND position IN (${[...scope].map(() => '?').join(', ')})`)
    .bind(locationId, ...scope)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/** Material/program positions must stay inside the actor's divisions (an empty list = "everyone" is not allowed then). */
export function requirePositionsInScope(access: Access, locationId: string | null, positions: string[]): void {
  if (locationId === null) return;
  const scope = allowedDivisions(access, locationId);
  if (!scope) return;
  if (!positions.length || positions.some((p) => !scope.has(p))) throw new ApiError(403, 'outside_divisions');
}

/** Owner, or a manager holding `permission` in at least one location (D44: zarządzający). */
export function requireOwnerOr(access: Access, permission: Permission): void {
  if (access.role === 'owner') return;
  if (![...access.locations.values()].some((p) => p.has(permission))) throw new ApiError(403, 'forbidden');
}

export const isDivision = (v: unknown): v is string => typeof v === 'string' && (POSITIONS as readonly string[]).includes(v);

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
  const candidates = results.filter((r) => access.locations.get(r.loc)?.has(permission));
  let shared: { loc: string } | undefined;
  for (const r of candidates) if (await userInScope(db, access, r.loc, targetId)) shared = r;
  if (!shared) {
    // Visible to the actor at all? Then 403, otherwise hide it.
    if (results.some((r) => access.locations.has(r.loc))) throw new ApiError(403, 'forbidden');
    throw notFound();
  }
  return { ...target, sharedLocationId: shared.loc };
}
