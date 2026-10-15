import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AUTH } from '../../shared/constants';
import type { AppEnv, SessionUser } from '../env';
import { ApiError, newId, unauthorized } from '../lib/http';
import { randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = 'sa_session';
const SLIDE_AFTER_MS = 60 * 60 * 1000; // refresh expiry at most once an hour

export function sessionDays(role: SessionUser['role']): number {
  if (role === 'terminal') return AUTH.terminalSessionDays;
  return role === 'employee' ? AUTH.employeeSessionDays : AUTH.staffSessionDays;
}

function cookieOptions(c: Context<AppEnv>, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function createSession(c: Context<AppEnv>, userId: string, role: SessionUser['role']): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  const days = sessionDays(role);
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('ses'), await sha256(token), userId, (c.req.header('User-Agent') ?? '').slice(0, 200), now, now, now + days * 864e5)
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, days * 86400));
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

export function revokeUserSessions(db: D1Database, userId: string, exceptSessionId?: string): D1PreparedStatement {
  return exceptSessionId
    ? db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`).bind(userId, exceptSessionId)
    : db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId);
}

/** Paths reachable while the user still has to replace a temporary PIN/password. */
const ALLOWED_DURING_CHANGE = new Set(['/api/auth/me', '/api/auth/change-secret', '/api/auth/logout']);

/** Resolves the session cookie into c.var.user, or answers 401. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw unauthorized();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sessionId, s.last_seen_at AS lastSeenAt, s.expires_at AS expiresAt,
            u.id, u.first_name AS firstName, u.last_name AS lastName, u.login, u.role, u.status,
            u.secret_kind AS secretKind, u.must_change_secret AS mustChangeSecret
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<SessionUser & { lastSeenAt: number; expiresAt: number; status: string; mustChangeSecret: number | boolean }>();

  const now = Date.now();
  if (!row || row.expiresAt <= now || row.status !== 'active') {
    if (row) await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.sessionId).run();
    clearSessionCookie(c);
    throw unauthorized();
  }

  if (now - row.lastSeenAt > SLIDE_AFTER_MS) {
    const days = sessionDays(row.role);
    await c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
      .bind(now, now + days * 864e5, row.sessionId)
      .run();
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c, days * 86400));
  }

  const user: SessionUser = {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    login: row.login,
    role: row.role,
    secretKind: row.secretKind,
    mustChangeSecret: Boolean(row.mustChangeSecret),
    sessionId: row.sessionId,
  };
  if (user.mustChangeSecret && !ALLOWED_DURING_CHANGE.has(c.req.path)) {
    throw new ApiError(403, 'must_change_secret');
  }
  // A time-clock phone reaches only the terminal API (D35).
  if (user.role === 'terminal' && !c.req.path.startsWith('/api/terminal/') && c.req.path !== '/api/auth/me') {
    throw new ApiError(403, 'forbidden');
  }
  c.set('user', user);
  await next();
};

/** CSRF: state-changing API calls must come from our own origin. */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    if (!origin) throw new ApiError(403, 'bad_origin');
    let same = false;
    try {
      same = new URL(origin).host === new URL(c.req.url).host;
    } catch {
      same = false;
    }
    if (!same) throw new ApiError(403, 'bad_origin');
  }
  await next();
};
