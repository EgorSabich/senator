/**
 * Time clock on a work phone (D35). The phone signs in with a terminal account (role "terminal") and stays signed in.
 * Staff enter only their PIN: the first PIN starts a shift, the next one ends it.
 * Punches made without internet are queued on the phone and sent later with their real time (client_id = idempotent).
 */
import { Hono } from 'hono';
import { AUTH } from '../../shared/constants';
import { checkPin } from '../../shared/secret-rules';
import { businessDate, DOUBLE_TAP_SECONDS, OFFLINE_MAX_AGE_HOURS, OPEN_SHIFT_STALE_HOURS } from '../../shared/time';
import type { AppEnv } from '../env';
import { ApiError, badRequest, newId, readJson } from '../lib/http';
import { pinLookup, verifySecret } from '../auth/crypto';
import { clearSessionCookie } from '../auth/session';

export const terminalRoutes = new Hono<AppEnv>();
// Session is enforced in index.ts.

interface TerminalRow {
  id: string;
  locationId: string;
  name: string;
  locationName: string;
}

async function loadTerminal(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }): Promise<TerminalRow> {
  if (c.var.user.role !== 'terminal') throw new ApiError(403, 'forbidden');
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.location_id AS locationId, t.name, l.name AS locationName
     FROM terminals t JOIN locations l ON l.id = t.location_id WHERE t.user_id = ?`,
  )
    .bind(c.var.user.id)
    .first<TerminalRow>();
  if (!t) throw new ApiError(403, 'forbidden');
  return t;
}

/** People currently on shift at the location (open, not stale). */
async function onShift(db: D1Database, locationId: string, now: number) {
  const { results } = await db
    .prepare(
      `SELECT u.first_name AS firstName, u.last_name AS lastName, e.clock_in_at AS since
       FROM time_entries e JOIN users u ON u.id = e.user_id
       WHERE e.location_id = ? AND e.clock_out_at IS NULL AND e.clock_in_at > ?
       ORDER BY e.clock_in_at`,
    )
    .bind(locationId, now - OPEN_SHIFT_STALE_HOURS * 3600_000)
    .all<{ firstName: string; lastName: string; since: number }>();
  return results.map((r) => ({ name: `${r.firstName} ${r.lastName.slice(0, 1)}.`, since: r.since }));
}

terminalRoutes.get('/status', async (c) => {
  const t = await loadTerminal(c);
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE terminals SET last_seen_at = ? WHERE id = ?`).bind(now, t.id).run();
  return c.json({ terminal: { name: t.name, location: t.locationName }, serverTime: now, onShift: await onShift(c.env.DB, t.locationId, now) });
});

type Outcome = 'in' | 'out' | 'duplicate' | 'unknown_pin' | 'rejected';

terminalRoutes.post('/punch', async (c) => {
  const t = await loadTerminal(c);
  const db = c.env.DB;
  const body = await readJson<{ pin?: unknown; clientId?: unknown; at?: unknown; offline?: unknown }>(c.req.raw);
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const clientId = typeof body.clientId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientId) ? body.clientId : null;
  if (!clientId) throw badRequest('invalid_input');
  const now = Date.now();
  const offline = body.offline === true;

  // Already handled (a re-send after a lost answer)?
  const prev = await db
    .prepare(
      `SELECT p.outcome, p.at, u.first_name AS firstName FROM time_punches p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.terminal_id = ? AND p.client_id = ?`,
    )
    .bind(t.id, clientId)
    .first<{ outcome: Outcome; at: number; firstName: string | null }>();
  if (prev) return c.json({ outcome: prev.outcome, at: prev.at, firstName: prev.firstName, repeated: true });

  // Pause after several wrong PINs in a row (only live punches count; the phone is in the restaurant).
  if (!offline) {
    const recent = await db
      .prepare(`SELECT outcome FROM time_punches WHERE terminal_id = ? AND offline = 0 AND created_at > ? ORDER BY created_at DESC LIMIT ?`)
      .bind(t.id, now - AUTH.terminalPauseSeconds * 1000, AUTH.terminalFailLimit)
      .all<{ outcome: string }>();
    if (recent.results.length >= AUTH.terminalFailLimit && recent.results.every((r) => r.outcome === 'unknown_pin')) {
      throw new ApiError(429, 'terminal_paused');
    }
  }

  let at = now;
  if (offline) {
    const claimed = typeof body.at === 'number' && Number.isFinite(body.at) ? Math.round(body.at) : NaN;
    if (!(claimed <= now + 120_000 && claimed >= now - OFFLINE_MAX_AGE_HOURS * 3600_000)) {
      await record(db, t.id, clientId, null, now, true, 'rejected', null);
      return c.json({ outcome: 'rejected' as Outcome, at: now, firstName: null });
    }
    at = Math.min(claimed, now);
  }

  if (checkPin(pin) === 'pin_format') {
    await record(db, t.id, clientId, null, at, offline, 'unknown_pin', null);
    return c.json({ outcome: 'unknown_pin' as Outcome, at, firstName: null });
  }
  const lookup = await pinLookup(pin, c.env.AUTH_SECRET);
  const person = await db
    .prepare(
      `SELECT u.id, u.first_name AS firstName FROM users u
       WHERE u.pin_lookup = ? AND u.status = 'active' AND u.role = 'employee'
         AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1)`,
    )
    .bind(lookup, t.locationId)
    .first<{ id: string; firstName: string }>();
  if (!person) {
    await record(db, t.id, clientId, null, at, offline, 'unknown_pin', null);
    return c.json({ outcome: 'unknown_pin' as Outcome, at, firstName: null });
  }

  const open = await db
    .prepare(`SELECT id, clock_in_at AS clockInAt FROM time_entries WHERE user_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`)
    .bind(person.id)
    .first<{ id: string; clockInAt: number }>();
  const source = offline ? 'offline' : 'terminal';

  if (open && at <= open.clockInAt) {
    // An old offline punch arriving after a newer one: keep it in the log for the manager, change nothing.
    await record(db, t.id, clientId, person.id, at, offline, 'rejected', open.id);
    return c.json({ outcome: 'rejected' as Outcome, at, firstName: person.firstName });
  }
  if (open && at - open.clockInAt < DOUBLE_TAP_SECONDS * 1000) {
    await record(db, t.id, clientId, person.id, at, offline, 'duplicate', open.id);
    return c.json({ outcome: 'duplicate' as Outcome, at: open.clockInAt, firstName: person.firstName });
  }
  if (open && at - open.clockInAt <= OPEN_SHIFT_STALE_HOURS * 3600_000) {
    await db.batch([
      db.prepare(`UPDATE time_entries SET clock_out_at = ?, out_source = ?, out_terminal_id = ? WHERE id = ?`).bind(at, source, t.id, open.id),
      recordStatement(db, t.id, clientId, person.id, at, offline, 'out', open.id),
    ]);
    return c.json({ outcome: 'out' as Outcome, at, firstName: person.firstName, since: open.clockInAt, minutes: Math.round((at - open.clockInAt) / 60000) });
  }

  // New shift. A stale open one (no exit) stays open and is flagged for the manager.
  const id = newId('te');
  await db.batch([
    db
      .prepare(
        `INSERT INTO time_entries (id, location_id, user_id, business_date, clock_in_at, in_source, in_terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, t.locationId, person.id, businessDate(at), at, source, t.id, now),
    recordStatement(db, t.id, clientId, person.id, at, offline, 'in', id),
  ]);
  return c.json({ outcome: 'in' as Outcome, at, firstName: person.firstName, missingExit: Boolean(open) });
});

function recordStatement(db: D1Database, terminalId: string, clientId: string, userId: string | null, at: number, offline: boolean, outcome: Outcome, entryId: string | null) {
  return db
    .prepare(
      `INSERT INTO time_punches (id, client_id, terminal_id, user_id, at, offline, outcome, entry_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (terminal_id, client_id) DO NOTHING`,
    )
    .bind(newId('tp'), clientId, terminalId, userId, at, offline ? 1 : 0, outcome, entryId, Date.now());
}

async function record(db: D1Database, terminalId: string, clientId: string, userId: string | null, at: number, offline: boolean, outcome: Outcome, entryId: string | null) {
  await recordStatement(db, terminalId, clientId, userId, at, offline, outcome, entryId).run();
}

/** Leaving terminal mode needs the terminal account's password; wrong passwords lock like a normal sign-in. */
terminalRoutes.post('/exit', async (c) => {
  await loadTerminal(c);
  const db = c.env.DB;
  const body = await readJson<{ password?: unknown }>(c.req.raw);
  const password = typeof body.password === 'string' ? body.password : '';
  const now = Date.now();
  const u = await db
    .prepare(`SELECT secret_hash AS hash, secret_salt AS salt, failed_attempts AS failed, lock_count AS lockCount, locked_until AS lockedUntil FROM users WHERE id = ?`)
    .bind(c.var.user.id)
    .first<{ hash: string | null; salt: string | null; failed: number; lockCount: number; lockedUntil: number | null }>();
  if (!u?.hash || !u.salt) throw new ApiError(403, 'forbidden');
  if (u.lockedUntil && u.lockedUntil > now) throw new ApiError(429, 'locked');
  if (!(await verifySecret(password, c.env.AUTH_SECRET, u.hash, u.salt))) {
    const failed = u.failed + 1;
    if (failed >= AUTH.maxFailedAttempts) {
      await db
        .prepare(`UPDATE users SET failed_attempts = 0, lock_count = lock_count + 1, locked_until = ? WHERE id = ?`)
        .bind(now + Math.min(AUTH.lockMinutesBase * 2 ** u.lockCount, 24 * 60) * 60_000, c.var.user.id)
        .run();
      throw new ApiError(429, 'locked');
    }
    await db.prepare(`UPDATE users SET failed_attempts = ? WHERE id = ?`).bind(failed, c.var.user.id).run();
    throw new ApiError(401, 'invalid_credentials');
  }
  await db.batch([
    db.prepare(`UPDATE users SET failed_attempts = 0, lock_count = 0, locked_until = NULL WHERE id = ?`).bind(c.var.user.id),
    db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(c.var.user.sessionId),
  ]);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
