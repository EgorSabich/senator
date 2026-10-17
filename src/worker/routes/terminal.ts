/**
 * Time clock on a work phone (D35). The phone signs in with a terminal account (role "terminal") and stays signed in.
 * Staff enter only their PIN: the first PIN starts a shift, the next one ends it.
 * Punches made without internet are queued on the phone and sent later with their real time (client_id = idempotent).
 */
import { Hono } from 'hono';
import { AUTH } from '../../shared/constants';
import { checkPin } from '../../shared/secret-rules';
import { businessDate, DOUBLE_TAP_SECONDS, OFFLINE_MAX_AGE_HOURS } from '../../shared/time';
import { locationRules } from '../lib/location';
import type { AppEnv } from '../env';
import { ApiError, badRequest, newId, readJson } from '../lib/http';
import { pinLookup, verifySecret } from '../auth/crypto';
import { assignPinLookup, burnPinStatement } from '../lib/pin';
import { clearSessionCookie } from '../auth/session';
import { decodePunchPhoto } from '../jobs/punchPhotos';
import { clockPush } from '../lib/notifyRules';

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

terminalRoutes.get('/status', async (c) => {
  const t = await loadTerminal(c);
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE terminals SET last_seen_at = ? WHERE id = ?`).bind(now, t.id).run();
  const rules = await locationRules(c.env.DB, t.locationId);
  return c.json({ terminal: { name: t.name, location: t.locationName }, serverTime: now, photo: rules.punchPhoto });
});

/** Too many wrong PINs in a row on this terminal (live entries only; the phone is in the restaurant). */
async function checkPaused(db: D1Database, terminalId: string, now: number) {
  const recent = await db
    .prepare(`SELECT outcome FROM time_punches WHERE terminal_id = ? AND offline = 0 AND created_at > ? ORDER BY created_at DESC LIMIT ?`)
    .bind(terminalId, now - AUTH.terminalPauseSeconds * 1000, AUTH.terminalFailLimit)
    .all<{ outcome: string }>();
  if (recent.results.length >= AUTH.terminalFailLimit && recent.results.every((r) => r.outcome === 'unknown_pin')) {
    throw new ApiError(429, 'terminal_paused');
  }
}

/** Active employee of this location with this PIN, or null. */
async function personByPin(db: D1Database, secret: string, pin: string, locationId: string) {
  if (checkPin(pin) === 'pin_format') return null;
  const lookup = await pinLookup(pin, secret);
  const found = await db
    .prepare(
      `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName FROM users u
       WHERE u.pin_lookup = ? AND u.status = 'active' AND u.role = 'employee'
         AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1)`,
    )
    .bind(lookup, locationId)
    .first<{ id: string; firstName: string; lastName: string }>();
  return found ?? legacyPin(db, secret, pin, lookup, locationId);
}

/**
 * PINs set before the time clock existed (D35) have no terminal link yet; it was made only at the next sign-in,
 * and staff stay signed in for weeks. So when the quick lookup finds nobody, the PIN is checked against the people
 * of this location who still have no link (slow, but only until everyone is linked) and linked on success.
 * Two people with the same old PIN: neither keeps it — both must set a new one (same rule as D35).
 */
async function legacyPin(db: D1Database, secret: string, pin: string, lookup: string, locationId: string) {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.secret_hash AS hash, u.secret_salt AS salt FROM users u
       WHERE u.pin_lookup IS NULL AND u.status = 'active' AND u.role = 'employee' AND u.secret_kind = 'pin' AND u.must_change_secret = 0
         AND u.secret_hash IS NOT NULL AND u.secret_salt IS NOT NULL
         AND EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1)
       LIMIT 80`,
    )
    .bind(locationId)
    .all<{ id: string; firstName: string; lastName: string; hash: string; salt: string }>();
  if (!results.length) return null;
  const checks = await Promise.all(results.map((r) => verifySecret(pin, secret, r.hash, r.salt)));
  const matches = results.filter((_, i) => checks[i]);
  if (matches.length === 1) {
    const m = matches[0]!;
    if ((await assignPinLookup(db, m.id, lookup)) === 'ok') return { id: m.id, firstName: m.firstName, lastName: m.lastName };
    return null;
  }
  if (matches.length > 1) await db.batch(matches.map((m) => burnPinStatement(db, m.id)));
  return null;
}

/**
 * D40: shows who the PIN belongs to and what will happen (start or end of shift) before anything is saved.
 * The person confirms with the slider, which sends /punch. Wrong PINs count towards the terminal pause.
 */
terminalRoutes.post('/preview', async (c) => {
  const t = await loadTerminal(c);
  const db = c.env.DB;
  const body = await readJson<{ pin?: unknown }>(c.req.raw);
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const now = Date.now();
  await checkPaused(db, t.id, now);
  const person = await personByPin(db, c.env.AUTH_SECRET, pin, t.locationId);
  if (!person) {
    await record(db, t.id, `pv${newId('x').slice(-30)}`, null, now, false, 'unknown_pin', null);
    return c.json({ outcome: 'unknown_pin' as const });
  }
  const rules = await locationRules(db, t.locationId);
  const open = await db
    .prepare(`SELECT clock_in_at AS clockInAt FROM time_entries WHERE user_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`)
    .bind(person.id)
    .first<{ clockInAt: number }>();
  const name = `${person.firstName} ${person.lastName.trim().charAt(0)}.`;
  if (open && now - open.clockInAt < DOUBLE_TAP_SECONDS * 1000) return c.json({ outcome: 'duplicate' as const, name, since: open.clockInAt });
  if (open && now - open.clockInAt <= rules.staleHours * 3600_000) return c.json({ outcome: 'out' as const, name, since: open.clockInAt });
  return c.json({ outcome: 'in' as const, name, missingExit: Boolean(open) });
});

type Outcome = 'in' | 'out' | 'duplicate' | 'unknown_pin' | 'rejected';

terminalRoutes.post('/punch', async (c) => {
  const t = await loadTerminal(c);
  const db = c.env.DB;
  const body = await readJson<{ pin?: unknown; clientId?: unknown; at?: unknown; offline?: unknown; photo?: unknown }>(c.req.raw);
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

  if (!offline) await checkPaused(db, t.id, now);

  let at = now;
  if (offline) {
    const claimed = typeof body.at === 'number' && Number.isFinite(body.at) ? Math.round(body.at) : NaN;
    if (!(claimed <= now + 120_000 && claimed >= now - OFFLINE_MAX_AGE_HOURS * 3600_000)) {
      await record(db, t.id, clientId, null, now, true, 'rejected', null);
      return c.json({ outcome: 'rejected' as Outcome, at: now, firstName: null });
    }
    at = Math.min(claimed, now);
  }

  const person = await personByPin(db, c.env.AUTH_SECRET, pin, t.locationId);
  if (!person) {
    await record(db, t.id, clientId, null, at, offline, 'unknown_pin', null);
    return c.json({ outcome: 'unknown_pin' as Outcome, at, firstName: null });
  }

  const open = await db
    .prepare(`SELECT id, clock_in_at AS clockInAt, business_date AS businessDate, position FROM time_entries WHERE user_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`)
    .bind(person.id)
    .first<{ id: string; clockInAt: number; businessDate: string; position: string | null }>();
  const source = offline ? 'offline' : 'terminal';
  const rules = await locationRules(db, t.locationId);

  if (open && at <= open.clockInAt) {
    // An old offline punch arriving after a newer one: keep it in the log for the manager, change nothing.
    await record(db, t.id, clientId, person.id, at, offline, 'rejected', open.id);
    return c.json({ outcome: 'rejected' as Outcome, at, firstName: person.firstName });
  }
  if (open && at - open.clockInAt < DOUBLE_TAP_SECONDS * 1000) {
    await record(db, t.id, clientId, person.id, at, offline, 'duplicate', open.id);
    return c.json({ outcome: 'duplicate' as Outcome, at: open.clockInAt, firstName: person.firstName });
  }
  const photoKey = rules.punchPhoto ? await storePhoto(c.env.PHOTOS, body.photo, t.id, clientId) : null;
  if (open && at - open.clockInAt <= rules.staleHours * 3600_000) {
    await db.batch([
      db.prepare(`UPDATE time_entries SET clock_out_at = ?, out_source = ?, out_terminal_id = ? WHERE id = ?`).bind(at, source, t.id, open.id),
      recordStatement(db, t.id, clientId, person.id, at, offline, 'out', open.id, photoKey),
    ]);
    const minutes = Math.round((at - open.clockInAt) / 60000);
    if (now - at < PUSH_MAX_AGE) later(c, clockPush(c.env, t.locationId, person.id, open, { at, minutes }));
    return c.json({ outcome: 'out' as Outcome, at, firstName: person.firstName, since: open.clockInAt, minutes });
  }

  // New shift. A stale open one (no exit) stays open and is flagged for the manager.
  const id = newId('te');
  await db.batch([
    db
      .prepare(
        `INSERT INTO time_entries (id, location_id, user_id, business_date, clock_in_at, in_source, in_terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, t.locationId, person.id, businessDate(at, rules.dayStartHour), at, source, t.id, now),
    recordStatement(db, t.id, clientId, person.id, at, offline, 'in', id, photoKey),
  ]);
  if (now - at < PUSH_MAX_AGE) later(c, clockPush(c.env, t.locationId, person.id, { id, businessDate: businessDate(at, rules.dayStartHour), clockInAt: at }, null));
  return c.json({ outcome: 'in' as Outcome, at, firstName: person.firstName, missingExit: Boolean(open) });
});

/** Push „Wejście / Wyjście” to the person (2026-10-17). An offline punch sent much later gets none. */
const PUSH_MAX_AGE = 10 * 60_000;
function later(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, p: Promise<unknown>) {
  const safe = p.catch((e) => console.warn('clock push', String(e)));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* no execution context (tests) — the promise runs anyway */
  }
}

function recordStatement(
  db: D1Database,
  terminalId: string,
  clientId: string,
  userId: string | null,
  at: number,
  offline: boolean,
  outcome: Outcome,
  entryId: string | null,
  photoKey: string | null = null,
) {
  return db
    .prepare(
      `INSERT INTO time_punches (id, client_id, terminal_id, user_id, at, offline, outcome, entry_id, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (terminal_id, client_id) DO NOTHING`,
    )
    .bind(newId('tp'), clientId, terminalId, userId, at, offline ? 1 : 0, outcome, entryId, photoKey, Date.now());
}

/** Saves the punch photo (D40) when the location asks for it; a missing or bad photo never blocks the punch. */
async function storePhoto(bucket: R2Bucket, photo: unknown, terminalId: string, clientId: string): Promise<string | null> {
  const bytes = decodePunchPhoto(photo);
  if (!bytes) return null;
  const key = `punch-photos/${terminalId}/${clientId}.jpg`;
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
    return key;
  } catch {
    return null;
  }
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
