import { Hono } from 'hono';
import { AUTH } from '../../shared/constants';
import { checkSecret } from '../../shared/secret-rules';
import { normalizeLogin } from '../../shared/text';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, readJson } from '../lib/http';
import { hashIp, hashSecret, pinLookup, verifySecret } from '../auth/crypto';
import { assignPinLookup, burnPinStatement, pinTaken } from '../lib/pin';
import { clearSessionCookie, createSession, requireSession, revokeUserSessions } from '../auth/session';
import { loadAccess } from '../auth/access';

export const authRoutes = new Hono<AppEnv>();

const WINDOW_MS = AUTH.ipWindowMinutes * 60_000;

/** One message for unknown login and wrong PIN (no account enumeration). */
const invalid = () => new ApiError(401, 'invalid_credentials');
const locked = () => new ApiError(429, 'locked');

interface LoginRow {
  id: string;
  role: 'owner' | 'manager' | 'employee' | 'terminal';
  secretKind: 'pin' | 'password';
  pinLookup: string | null;
  mustChangeSecret: number;
  secretHash: string | null;
  secretSalt: string | null;
  failedAttempts: number;
  lockCount: number;
  lockedUntil: number | null;
}

function lockMs(lockCount: number): number {
  return Math.min(AUTH.lockMinutesBase * 2 ** lockCount, 24 * 60) * 60_000;
}

authRoutes.post('/login', async (c) => {
  const body = await readJson<{ login?: unknown; secret?: unknown }>(c.req.raw);
  const login = typeof body.login === 'string' ? normalizeLogin(body.login) : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const now = Date.now();
  const db = c.env.DB;
  const ipHash = await hashIp(c.req.header('CF-Connecting-IP') ?? 'local', c.env.AUTH_SECRET);

  const recordAttempt = (success: boolean) =>
    db
      .prepare(`INSERT INTO login_attempts (id, login, ip_hash, success, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId('la'), login || '-', ipHash, success ? 1 : 0, now)
      .run();

  const ipFails = await db
    .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND success = 0 AND created_at > ?`)
    .bind(ipHash, now - WINDOW_MS)
    .first<{ n: number }>();
  if ((ipFails?.n ?? 0) >= AUTH.ipFailedLimit) throw new ApiError(429, 'too_many_attempts');

  if (!login || !secret || secret.length > 200) {
    await recordAttempt(false);
    throw invalid();
  }

  const user = await db
    .prepare(
      `SELECT id, role, secret_kind AS secretKind, pin_lookup AS pinLookup, must_change_secret AS mustChangeSecret,
              secret_hash AS secretHash, secret_salt AS secretSalt, failed_attempts AS failedAttempts,
              lock_count AS lockCount, locked_until AS lockedUntil
       FROM users WHERE login = ? AND status = 'active'`,
    )
    .bind(login)
    .first<LoginRow>();

  if (!user || !user.secretHash || !user.secretSalt) {
    // Same cost and same lock behaviour as a real account.
    await hashSecret(secret, c.env.AUTH_SECRET);
    const fails = await db
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE login = ? AND success = 0 AND created_at > ?`)
      .bind(login, now - WINDOW_MS)
      .first<{ n: number }>();
    await recordAttempt(false);
    if ((fails?.n ?? 0) + 1 >= AUTH.maxFailedAttempts) throw locked();
    throw invalid();
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await recordAttempt(false);
    throw locked();
  }

  const ok = await verifySecret(secret, c.env.AUTH_SECRET, user.secretHash, user.secretSalt);
  if (!ok) {
    const failed = user.failedAttempts + 1;
    await recordAttempt(false);
    if (failed >= AUTH.maxFailedAttempts) {
      await db
        .prepare(`UPDATE users SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = ? WHERE id = ?`)
        .bind(now + lockMs(user.lockCount), user.id)
        .run();
      throw locked();
    }
    await db.prepare(`UPDATE users SET failed_attempts = ? WHERE id = ?`).bind(failed, user.id).run();
    throw invalid();
  }

  await db
    .prepare(`UPDATE users SET failed_attempts = 0, lock_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`)
    .bind(now, user.id)
    .run();
  await recordAttempt(true);
  // Link the PIN to the time terminal (D35). A temporary PIN is never linked.
  if (user.secretKind === 'pin' && !user.mustChangeSecret) {
    const lookup = await pinLookup(secret, c.env.AUTH_SECRET);
    if (user.pinLookup !== lookup && (await assignPinLookup(db, user.id, lookup)) === 'conflict') {
      await db.prepare(`UPDATE users SET must_change_secret = 1 WHERE id = ?`).bind(user.id).run();
    }
  }
  await createSession(c, user.id, user.role);
  return c.json({ ok: true });
});

authRoutes.post('/logout', requireSession, async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(c.var.user.sessionId).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireSession, async (c) => {
  const user = c.var.user;
  const access = await loadAccess(c.env.DB, user);
  const ids = [...access.locations.keys()];
  const names = new Map<string, string>();
  if (ids.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, name FROM locations WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
      .all<{ id: string; name: string }>();
    for (const r of results) names.set(r.id, r.name);
  }
  return c.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      login: user.login,
      role: user.role,
      secretKind: user.secretKind,
      mustChangeSecret: user.mustChangeSecret,
    },
    locations: ids.map((id) => ({ id, name: names.get(id) ?? '', permissions: [...access.locations.get(id)!] })),
  });
});

authRoutes.post('/change-secret', requireSession, async (c) => {
  const user = c.var.user;
  const body = await readJson<{ current?: unknown; next?: unknown }>(c.req.raw);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';
  const db = c.env.DB;

  const row = await db
    .prepare(`SELECT secret_hash AS hash, secret_salt AS salt FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ hash: string | null; salt: string | null }>();
  if (!row?.hash || !row.salt) throw new ApiError(400, 'wrong_current_secret');
  // First sign-in with a temporary PIN/password: the session itself was opened with it a moment ago,
  // so the person is not asked to type it again — only the new one (owner's request, 2026-10-17).
  const skipCurrent = user.mustChangeSecret && body.current === undefined;
  if (!skipCurrent && !(await verifySecret(current, c.env.AUTH_SECRET, row.hash, row.salt))) {
    throw new ApiError(400, 'wrong_current_secret');
  }
  const problem = checkSecret(user.secretKind, next);
  if (problem) throw badRequest(problem);
  if (skipCurrent ? await verifySecret(next, c.env.AUTH_SECRET, row.hash, row.salt) : next === current) throw badRequest('same_secret');

  // PINs are unique (time terminal, D35). A PIN someone tried to take is burned for its holder too.
  let lookup: string | null = null;
  if (user.secretKind === 'pin') {
    lookup = await pinLookup(next, c.env.AUTH_SECRET);
    const holder = await pinTaken(db, user.id, lookup);
    if (holder) {
      await burnPinStatement(db, holder).run();
      throw badRequest('pin_unavailable');
    }
  }

  const { hash, salt } = await hashSecret(next, c.env.AUTH_SECRET);
  await db.batch([
    db
      .prepare(`UPDATE users SET secret_hash = ?, secret_salt = ?, must_change_secret = 0, updated_at = ? WHERE id = ?`)
      .bind(hash, salt, Date.now(), user.id),
    ...(lookup ? [db.prepare(`UPDATE users SET pin_lookup = ? WHERE id = ?`).bind(lookup, user.id)] : []),
    revokeUserSessions(db, user.id, user.sessionId),
    auditStatement(db, { actorId: user.id, action: 'user.change_secret', entityType: 'user', entityId: user.id }),
  ]);
  return c.json({ ok: true });
});

