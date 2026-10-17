/**
 * Grafik (D43): managers plan shifts per division, staff see only what was published.
 * Draft fields are edited freely; "Opublikuj" copies them to the pub_* fields that staff read.
 * Templates are saved automatically from planned shifts; staff report days off before a weekly deadline.
 */
import { Hono } from 'hono';
import { userPositions } from '../lib/learning';
import { myDeadlines } from '../lib/deadlines';
import { addDays, isIsoDate } from '../../shared/time';
import { shiftMinutes, unavailabilityDeadline, weekDays, weekStart } from '../../shared/schedule';
import { divisionOf } from '../../shared/constants';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { allowedDivisions, isDivision, loadAccess, requireDivision, requireLocation, requirePermission, userInScope, type Access } from '../auth/access';

export const scheduleAdminRoutes = new Hono<AppEnv>();
export const scheduleRoutes = new Hono<AppEnv>();

type Ctx = { env: AppEnv['Bindings']; var: AppEnv['Variables'] };

interface ShiftRow {
  id: string;
  locationId: string;
  userId: string;
  date: string;
  division: string;
  startMin: number;
  endMin: number;
  note: string | null;
  isDeleted: number;
  published: number;
  pubStartMin: number | null;
  pubEndMin: number | null;
  pubNote: string | null;
}

const SHIFT_SELECT = `SELECT id, location_id AS locationId, user_id AS userId, date, division, start_min AS startMin, end_min AS endMin, note,
  is_deleted AS isDeleted, published, pub_start_min AS pubStartMin, pub_end_min AS pubEndMin, pub_note AS pubNote FROM schedule_shifts`;

const changed = (s: ShiftRow) =>
  Boolean(s.isDeleted) || !s.published || s.pubStartMin !== s.startMin || s.pubEndMin !== s.endMin || (s.pubNote ?? '') !== (s.note ?? '');

async function guard(c: Ctx, locId: string): Promise<Access> {
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'schedule.manage');
  return access;
}

function mondayOf(v: unknown): string {
  if (!isIsoDate(v)) throw badRequest('invalid_input');
  const m = weekStart(v);
  if (m !== v) throw badRequest('week_invalid');
  return m;
}

/** A week (?week=Monday) or a calendar month (?month=YYYY-MM) — the panel shows both (D44). */
function periodOf(q: { week?: unknown; month?: unknown }): { days: string[]; monday: string | null } {
  if (typeof q.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) {
    const first = `${q.month}-01`;
    const days: string[] = [];
    for (let d = first; d.slice(0, 7) === q.month; d = addDays(d, 1)) days.push(d);
    return { days, monday: null };
  }
  const monday = mondayOf(q.week);
  return { days: weekDays(monday), monday };
}

async function rulesOf(db: D1Database, locId: string) {
  const r = await db
    .prepare(`SELECT unavail_deadline_dow AS dow, unavail_deadline_hour AS hour FROM locations WHERE id = ?`)
    .bind(locId)
    .first<{ dow: number; hour: number }>();
  return { dow: r?.dow ?? 0, hour: r?.hour ?? 23 };
}

/** Employees of the location with their positions (= divisions they can be planned in). */
async function people(db: D1Database, locId: string) {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, group_concat(ul.position) AS positions
       FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
       WHERE u.role = 'employee' AND u.status = 'active'
       GROUP BY u.id ORDER BY u.first_name, u.last_name`,
    )
    .bind(locId)
    .all<{ id: string; firstName: string; lastName: string; positions: string }>();
  return results.map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, divisions: [...new Set(r.positions.split(',').map(divisionOf))] }));
}

const view = (s: ShiftRow) => ({
  id: s.id,
  userId: s.userId,
  date: s.date,
  division: s.division,
  startMin: s.startMin,
  endMin: s.endMin,
  note: s.note,
  deleted: Boolean(s.isDeleted),
  published: Boolean(s.published),
  changed: changed(s),
});

/* ───────── Panel ───────── */

scheduleAdminRoutes.get('/locations/:locId/schedule', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const { days, monday } = periodOf({ week: c.req.query('week'), month: c.req.query('month') });
  const last = days[days.length - 1]!;
  const allowed = allowedDivisions(access, locId);
  const [shifts, unav, templates, entries] = await db.batch([
    db.prepare(`${SHIFT_SELECT} WHERE location_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_min`).bind(locId, days[0], last),
    db
      .prepare(
        `SELECT n.user_id AS userId, n.date, n.note, n.from_min AS fromMin, n.to_min AS toMin,
                CASE WHEN m.id IS NULL THEN NULL ELSE m.first_name || ' ' || m.last_name END AS setByName
         FROM unavailability n LEFT JOIN users m ON m.id = n.set_by WHERE n.location_id = ? AND n.date BETWEEN ? AND ?`,
      )
      .bind(locId, days[0], last),
    db
      .prepare(
        `SELECT id, division, start_min AS startMin, end_min AS endMin, label, use_count AS useCount FROM shift_templates
         WHERE location_id = ? ORDER BY use_count DESC, start_min`,
      )
      .bind(locId),
    // plan vs actual: who clocked in on those days
    db
      .prepare(`SELECT user_id AS userId, business_date AS date, clock_in_at AS clockInAt, clock_out_at AS clockOutAt FROM time_entries WHERE location_id = ? AND business_date BETWEEN ? AND ?`)
      .bind(locId, days[0], last),
  ]);
  const { dow, hour } = await rulesOf(db, locId);
  // D44: everyone with the schedule sees the whole team; editing stays within one's divisions
  const inScope = (d: string) => !allowed || allowed.has(d);
  const rows = shifts!.results as ShiftRow[];
  const ppl = await people(db, locId);
  return c.json({
    week: monday ?? weekStart(days[0]!),
    days,
    people: ppl,
    shifts: rows.map(view),
    unavailability: unav!.results,
    templates: (templates!.results as { division: string }[]).filter((t) => inScope(t.division)),
    actual: entries!.results,
    unpublished: rows.filter((r) => inScope(r.division) && changed(r)).length,
    deadline: monday ? unavailabilityDeadline(monday, dow, hour) : null,
    divisions: allowed ? [...allowed] : null,
    editable: allowed ? [...allowed] : null,
  });
});

async function checkOverlap(db: D1Database, userId: string, date: string, startMin: number, endMin: number, exceptId: string | null) {
  const { results } = await db
    .prepare(`SELECT id, date, start_min AS startMin, end_min AS endMin FROM schedule_shifts WHERE user_id = ? AND is_deleted = 0 AND date BETWEEN ? AND ?`)
    .bind(userId, addDays(date, -1), addDays(date, 1))
    .all<{ id: string; date: string; startMin: number; endMin: number }>();
  const abs = (d: string, m: number) => Math.round(Date.parse(`${d}T00:00:00Z`) / 60000) + m;
  const a0 = abs(date, startMin);
  const a1 = abs(date, endMin);
  if (results.some((r) => r.id !== exceptId && abs(r.date, r.startMin) < a1 && abs(r.date, r.endMin) > a0)) throw new ApiError(409, 'shift_overlap');
}

function templateStatement(db: D1Database, locId: string, division: string, startMin: number, endMin: number) {
  return db
    .prepare(
      `INSERT INTO shift_templates (id, location_id, division, start_min, end_min, use_count, last_used_at) VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (location_id, division, start_min, end_min) DO UPDATE SET use_count = use_count + 1, last_used_at = excluded.last_used_at`,
    )
    .bind(newId('stp'), locId, division, startMin, endMin, Date.now());
}

scheduleAdminRoutes.post('/locations/:locId/schedule/shifts', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const body = await readJson<{ userId?: unknown; date?: unknown; division?: unknown; start?: unknown; end?: unknown; note?: unknown }>(c.req.raw);
  if (!isIsoDate(body.date) || typeof body.userId !== 'string') throw badRequest('invalid_input');
  const times = shiftMinutes(body.start, body.end);
  if (!times) throw badRequest('shift_time_invalid');
  const person = (await people(db, locId)).find((p) => p.id === body.userId);
  if (!person) throw notFound();
  const division = isDivision(body.division) && person.divisions.includes(body.division) ? body.division : person.divisions[0]!;
  requireDivision(access, locId, division);
  await checkOverlap(db, person.id, body.date, times.startMin, times.endMin, null);
  const id = newId('sh');
  const now = Date.now();
  const note = str(body.note, 200) || null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO schedule_shifts (id, location_id, user_id, date, division, start_min, end_min, note, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, locId, person.id, body.date, division, times.startMin, times.endMin, note, c.var.user.id, now),
    templateStatement(db, locId, division, times.startMin, times.endMin),
  ]);
  return c.json({ id }, 201);
});

async function loadShift(c: Ctx, id: string) {
  const s = await c.env.DB.prepare(`${SHIFT_SELECT} WHERE id = ?`).bind(id).first<ShiftRow>();
  if (!s) throw notFound();
  const access = await guard(c, s.locationId);
  requireDivision(access, s.locationId, s.division);
  return s;
}

scheduleAdminRoutes.put('/schedule/shifts/:id', async (c) => {
  const s = await loadShift(c, c.req.param('id'));
  if (s.isDeleted) throw notFound();
  const db = c.env.DB;
  const body = await readJson<{ start?: unknown; end?: unknown; note?: unknown }>(c.req.raw);
  const times = shiftMinutes(body.start, body.end);
  if (!times) throw badRequest('shift_time_invalid');
  await checkOverlap(db, s.userId, s.date, times.startMin, times.endMin, s.id);
  const note = body.note === undefined ? s.note : str(body.note, 200) || null;
  const stmts = [
    db.prepare(`UPDATE schedule_shifts SET start_min = ?, end_min = ?, note = ?, updated_at = ? WHERE id = ?`).bind(times.startMin, times.endMin, note, Date.now(), s.id),
  ];
  if (times.startMin !== s.startMin || times.endMin !== s.endMin) stmts.push(templateStatement(db, s.locationId, s.division, times.startMin, times.endMin));
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** A never-published shift disappears; a published one waits for the next publish (staff still see it until then). */
scheduleAdminRoutes.delete('/schedule/shifts/:id', async (c) => {
  const s = await loadShift(c, c.req.param('id'));
  const db = c.env.DB;
  if (s.published) await db.prepare(`UPDATE schedule_shifts SET is_deleted = 1, updated_at = ? WHERE id = ?`).bind(Date.now(), s.id).run();
  else await db.prepare(`DELETE FROM schedule_shifts WHERE id = ?`).bind(s.id).run();
  return c.json({ ok: true });
});

/** Undo the delete of a published shift before publishing. */
scheduleAdminRoutes.post('/schedule/shifts/:id/restore', async (c) => {
  const s = await loadShift(c, c.req.param('id'));
  await c.env.DB.prepare(`UPDATE schedule_shifts SET is_deleted = 0, updated_at = ? WHERE id = ?`).bind(Date.now(), s.id).run();
  return c.json({ ok: true });
});

/** Publish the week (all divisions the manager may plan, or the chosen ones). Returns who got changes — for notifications. */
scheduleAdminRoutes.post('/locations/:locId/schedule/publish', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const body = await readJson<{ week?: unknown; month?: unknown; divisions?: unknown }>(c.req.raw);
  const { days, monday } = periodOf(body);
  const allowed = allowedDivisions(access, locId);
  let chosen = Array.isArray(body.divisions) ? body.divisions.filter(isDivision) : null;
  if (chosen && !chosen.length) chosen = null;
  const inScope = (d: string) => (!allowed || allowed.has(d)) && (!chosen || chosen.includes(d));
  const { results } = await db.prepare(`${SHIFT_SELECT} WHERE location_id = ? AND date BETWEEN ? AND ?`).bind(locId, days[0], days[days.length - 1]).all<ShiftRow>();
  const todo = results.filter((s) => inScope(s.division) && changed(s));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const users = new Set<string>();
  for (const s of todo) {
    users.add(s.userId);
    if (s.isDeleted) stmts.push(db.prepare(`DELETE FROM schedule_shifts WHERE id = ?`).bind(s.id));
    else
      stmts.push(
        db
          .prepare(`UPDATE schedule_shifts SET published = 1, pub_start_min = start_min, pub_end_min = end_min, pub_note = note, published_at = ? WHERE id = ?`)
          .bind(now, s.id),
      );
  }
  if (!stmts.length) return c.json({ published: 0, people: 0, userIds: [] });
  stmts.push(
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: locId,
      action: 'schedule.publish',
      entityType: 'schedule',
      entityId: monday ?? days[0]!.slice(0, 7),
      after: { changes: todo.length, people: users.size, divisions: chosen ?? (allowed ? [...allowed] : 'all') },
    }),
  );
  await db.batch(stmts);
  return c.json({ published: todo.length, people: users.size, userIds: [...users] });
});

/** Copy last week's plan into this week where the person has nothing planned that day (drafts). */
scheduleAdminRoutes.post('/locations/:locId/schedule/copy-week', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const body = await readJson<{ week?: unknown }>(c.req.raw);
  const monday = mondayOf(body.week);
  const prev = weekDays(addDays(monday, -7));
  const allowed = allowedDivisions(access, locId);
  const active = new Map((await people(db, locId)).map((p) => [p.id, p]));
  const [src, dst] = await db.batch([
    db.prepare(`${SHIFT_SELECT} WHERE location_id = ? AND date BETWEEN ? AND ? AND is_deleted = 0`).bind(locId, prev[0], prev[6]),
    db.prepare(`SELECT user_id AS userId, date FROM schedule_shifts WHERE location_id = ? AND date BETWEEN ? AND ?`).bind(locId, monday, addDays(monday, 6)),
  ]);
  const taken = new Set((dst!.results as { userId: string; date: string }[]).map((r) => `${r.userId}|${r.date}`));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const s of src!.results as ShiftRow[]) {
    const date = addDays(s.date, 7);
    if (allowed && !allowed.has(s.division)) continue;
    if (!active.get(s.userId)?.divisions.includes(s.division)) continue;
    if (taken.has(`${s.userId}|${date}`)) continue;
    stmts.push(
      db
        .prepare(`INSERT INTO schedule_shifts (id, location_id, user_id, date, division, start_min, end_min, note, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId('sh'), locId, s.userId, date, s.division, s.startMin, s.endMin, s.note, c.var.user.id, now),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return c.json({ created: stmts.length });
});

scheduleAdminRoutes.put('/schedule/templates/:id', async (c) => {
  const db = c.env.DB;
  const t = await db.prepare(`SELECT id, location_id AS locationId, division FROM shift_templates WHERE id = ?`).bind(c.req.param('id')).first<{ id: string; locationId: string; division: string }>();
  if (!t) throw notFound();
  const access = await guard(c, t.locationId);
  requireDivision(access, t.locationId, t.division);
  const body = await readJson<{ label?: unknown }>(c.req.raw);
  await db.prepare(`UPDATE shift_templates SET label = ? WHERE id = ?`).bind(str(body.label, 40) || null, t.id).run();
  return c.json({ ok: true });
});

scheduleAdminRoutes.delete('/schedule/templates/:id', async (c) => {
  const db = c.env.DB;
  const t = await db.prepare(`SELECT id, location_id AS locationId, division FROM shift_templates WHERE id = ?`).bind(c.req.param('id')).first<{ id: string; locationId: string; division: string }>();
  if (!t) throw notFound();
  const access = await guard(c, t.locationId);
  requireDivision(access, t.locationId, t.division);
  await db.prepare(`DELETE FROM shift_templates WHERE id = ?`).bind(t.id).run();
  return c.json({ ok: true });
});

/** { date, fromMin?, toMin? } → validated; both null = whole day. */
function parsePart(x: unknown, days: string[]): { date: string; fromMin: number | null; toMin: number | null } {
  const o = (x ?? {}) as { date?: unknown; fromMin?: unknown; toMin?: unknown };
  if (typeof o.date !== 'string' || !days.includes(o.date)) throw badRequest('invalid_input');
  const num = (v: unknown) => (v === undefined || v === null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1440 ? (v as number) : NaN);
  const fromMin = num(o.fromMin);
  const toMin = num(o.toMin);
  if (Number.isNaN(fromMin) || Number.isNaN(toMin)) throw badRequest('invalid_input');
  if (fromMin === null && toMin === null) return { date: o.date, fromMin: null, toMin: null };
  const f = fromMin ?? 0;
  const t = toMin ?? 1440;
  if (f >= t || (f === 0 && t === 1440)) return { date: o.date, fromMin: null, toMin: null };
  return { date: o.date, fromMin: f, toMin: t };
}

/** A leader marks a day (or part of it) as unavailable — e.g. the person asked in person (owner, 2026-10-17). */
scheduleAdminRoutes.put('/locations/:locId/schedule/unavailability', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const body = await readJson<{ userId?: unknown; date?: unknown; fromMin?: unknown; toMin?: unknown; note?: unknown }>(c.req.raw);
  if (typeof body.userId !== 'string' || !isIsoDate(body.date)) throw badRequest('invalid_input');
  if (!(await userInScope(db, access, locId, body.userId))) throw new ApiError(403, 'outside_divisions');
  const person = (await people(db, locId)).find((p) => p.id === body.userId);
  if (!person) throw notFound();
  const part = parsePart(body, [body.date]);
  await db
    .prepare(
      `INSERT INTO unavailability (user_id, location_id, date, note, from_min, to_min, set_by) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, location_id, date) DO UPDATE SET note = excluded.note, from_min = excluded.from_min, to_min = excluded.to_min, set_by = excluded.set_by`,
    )
    .bind(person.id, locId, part.date, str(body.note, 200) || null, part.fromMin, part.toMin, c.var.user.id)
    .run();
  return c.json({ ok: true });
});

scheduleAdminRoutes.delete('/locations/:locId/schedule/unavailability', async (c) => {
  const locId = c.req.param('locId');
  const access = await guard(c, locId);
  const db = c.env.DB;
  const userId = c.req.query('userId');
  const date = c.req.query('date');
  if (!userId || !isIsoDate(date)) throw badRequest('invalid_input');
  if (!(await userInScope(db, access, locId, userId))) throw new ApiError(403, 'outside_divisions');
  await db.prepare(`DELETE FROM unavailability WHERE user_id = ? AND location_id = ? AND date = ?`).bind(userId, locId, date).run();
  return c.json({ ok: true });
});

/* ───────── Staff ───────── */

async function staffGuard(c: Ctx, locId: string) {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireLocation(access, locId);
}

/** 2026-10-17: Grafik is locked for a person whose mandatory documents are past the reading period. */
async function scheduleLock(c: Ctx, locId: string) {
  const d = await myDeadlines(c.env.DB, locId, c.var.user, await userPositions(c.env.DB, c.var.user, locId));
  return d.lockedSince === null ? null : { since: d.lockedSince, documents: d.items.filter((i) => i.overdue).map((i) => ({ id: i.id, title: i.title, due: i.due })) };
}

/** My published shifts in a week (and who else works in my division those days), plus my next shifts. */
scheduleRoutes.get('/locations/:locId/my-schedule', async (c) => {
  const locId = c.req.param('locId');
  await staffGuard(c, locId);
  const db = c.env.DB;
  const me = c.var.user.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const q = c.req.query('week');
  const monday = q && isIsoDate(q) ? weekStart(q) : weekStart(today);
  const days = weekDays(monday);
  const locked = await scheduleLock(c, locId);
  if (locked) return c.json({ week: monday, days, today, locked, shifts: [], team: [], upcoming: [] });
  const [week, upcoming] = await db.batch([
    db
      .prepare(
        `SELECT s.id, s.user_id AS userId, s.date, s.division, s.pub_start_min AS startMin, s.pub_end_min AS endMin, s.pub_note AS note,
                u.first_name AS firstName, u.last_name AS lastName
         FROM schedule_shifts s JOIN users u ON u.id = s.user_id
         WHERE s.location_id = ? AND s.published = 1 AND s.date BETWEEN ? AND ? ORDER BY s.date, s.pub_start_min`,
      )
      .bind(locId, days[0], days[6]),
    db
      .prepare(
        `SELECT id, date, division, pub_start_min AS startMin, pub_end_min AS endMin, pub_note AS note FROM schedule_shifts
         WHERE location_id = ? AND user_id = ? AND published = 1 AND date >= ? ORDER BY date, pub_start_min LIMIT 8`,
      )
      .bind(locId, me, today),
  ]);
  const all = week!.results as { id: string; userId: string; date: string; division: string; startMin: number; endMin: number; note: string | null; firstName: string; lastName: string }[];
  const mine = all.filter((s) => s.userId === me);
  const myDivisions = new Set(mine.map((s) => s.division));
  return c.json({
    week: monday,
    days,
    today,
    shifts: mine.map(({ id, date, division, startMin, endMin, note }) => ({ id, date, division, startMin, endMin, note })),
    team: all
      .filter((s) => s.userId !== me && myDivisions.has(s.division) && mine.some((m) => m.date === s.date))
      .map((s) => ({ date: s.date, name: `${s.firstName} ${s.lastName.trim().charAt(0)}.`, startMin: s.startMin, endMin: s.endMin })),
    upcoming: upcoming!.results,
  });
});

/** Weeks I can still report days off for (deadline not passed), up to six weeks ahead. */
scheduleRoutes.get('/locations/:locId/unavailability', async (c) => {
  const locId = c.req.param('locId');
  await staffGuard(c, locId);
  const db = c.env.DB;
  const { dow, hour } = await rulesOf(db, locId);
  const now = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(now));
  const first = addDays(weekStart(today), 7);
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(first, i * 7));
  const { results } = await db
    .prepare(
      `SELECT date, note, from_min AS fromMin, to_min AS toMin, (set_by IS NOT NULL) AS byManager FROM unavailability
       WHERE user_id = ? AND location_id = ? AND date BETWEEN ? AND ?`,
    )
    .bind(c.var.user.id, locId, weeks[0], addDays(weeks[5]!, 6))
    .all<{ date: string; note: string | null; fromMin: number | null; toMin: number | null; byManager: number }>();
  const locked = await scheduleLock(c, locId);
  return c.json({
    locked,
    deadlineRule: { dow, hour },
    weeks: weeks.map((w) => {
      const deadline = unavailabilityDeadline(w, dow, hour);
      const days = weekDays(w);
      return { week: w, days, deadline, open: now <= deadline, dates: results.filter((r) => days.includes(r.date)) };
    }),
  });
});

scheduleRoutes.put('/locations/:locId/unavailability', async (c) => {
  const locId = c.req.param('locId');
  await staffGuard(c, locId);
  if (c.var.user.role !== 'employee') throw new ApiError(403, 'forbidden');
  if (await scheduleLock(c, locId)) throw new ApiError(403, 'docs_overdue');
  const db = c.env.DB;
  const body = await readJson<{ week?: unknown; dates?: unknown; items?: unknown; note?: unknown }>(c.req.raw);
  const monday = mondayOf(body.week);
  const { dow, hour } = await rulesOf(db, locId);
  if (Date.now() > unavailabilityDeadline(monday, dow, hour)) throw new ApiError(409, 'unavailability_closed');
  const days = weekDays(monday);
  // items: [{ date, fromMin?, toMin? }] — part of a day (e.g. "until 17:00"); dates: whole days (older clients)
  const raw = Array.isArray(body.items) ? body.items : Array.isArray(body.dates) ? body.dates.map((d) => ({ date: d })) : null;
  if (!raw) throw badRequest('invalid_input');
  const items = raw.map((x) => parsePart(x, days));
  const note = str(body.note, 200) || null;
  await db.batch([
    // what a leader entered stays (the person talked to them); the rest of the week is replaced
    db.prepare(`DELETE FROM unavailability WHERE user_id = ? AND location_id = ? AND date BETWEEN ? AND ? AND set_by IS NULL`).bind(c.var.user.id, locId, days[0], days[6]),
    ...items.map((i) =>
      db
        .prepare(`INSERT INTO unavailability (user_id, location_id, date, note, from_min, to_min) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(c.var.user.id, locId, i.date, note, i.fromMin, i.toMin),
    ),
  ]);
  return c.json({ ok: true, dates: items.map((i) => i.date) });
});
