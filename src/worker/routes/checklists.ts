/**
 * Daily checklists (D36, D42). Every list item of a published checklist is a task for the business day.
 * Staff mark the items they did, but only while on shift (clocked in on the terminal). Two modes:
 * - "shared": one item, one person; the list may be closed for the day with items left;
 * - "individual": everyone on shift does every item; the panel shows each person's progress, nothing to close.
 */
import { Hono } from 'hono';
import { checklistItems } from '../../shared/checklist';
import type { RtNode } from '../../shared/richtext';
import { businessDate, dateRange, isIsoDate } from '../../shared/time';
import { locationRules } from '../lib/location';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson } from '../lib/http';
import { loadAccess, requireLocation, requirePermission, type Access } from '../auth/access';
import { isVisibleFor, userPositions, visibleContent } from '../lib/learning';

export const checklistRoutes = new Hono<AppEnv>();
export const checklistAdminRoutes = new Hono<AppEnv>();

interface ChecklistRow {
  id: string;
  locationId: string | null;
  title: string;
  status: string;
  currentVersionId: string | null;
  positions: string | null;
  mode: 'individual' | 'shared';
}

async function loadChecklist(db: D1Database, id: string): Promise<ChecklistRow & { body: RtNode | null }> {
  const row = await db
    .prepare(
      `SELECT ci.id, ci.location_id AS locationId, ci.title, ci.status, ci.current_version_id AS currentVersionId, ci.checklist_mode AS mode,
              (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions,
              v.body_json AS bodyJson
       FROM content_items ci LEFT JOIN content_versions v ON v.id = ci.current_version_id
       WHERE ci.id = ? AND ci.kind = 'checklist'`,
    )
    .bind(id)
    .first<ChecklistRow & { bodyJson: string | null }>();
  if (!row) throw notFound();
  let body: RtNode | null = null;
  try {
    body = row.bodyJson ? (JSON.parse(row.bodyJson) as RtNode) : null;
  } catch {
    body = null;
  }
  return { ...row, body };
}

interface MarkRow {
  itemKey: string;
  itemText: string;
  section: string | null;
  userId: string;
  markedAt: number;
  name: string;
}

/** Employees who worked that day at the location and whose position the list is for (individual lists). */
async function expectedPeople(db: D1Database, cl: ChecklistRow, date: string, locationId: string) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT u.id AS userId, u.first_name || ' ' || u.last_name AS name,
              (SELECT group_concat(position) FROM user_locations ul WHERE ul.user_id = u.id AND ul.location_id = ?1 AND ul.is_active = 1) AS positions
       FROM time_entries e JOIN users u ON u.id = e.user_id
       WHERE e.location_id = ?1 AND e.business_date = ?2 AND u.role = 'employee'`,
    )
    .bind(locationId, date)
    .all<{ userId: string; name: string; positions: string | null }>();
  return results.filter((r) => isVisibleFor(cl.positions, r.positions ? r.positions.split(',') : []));
}

/**
 * Items of the day with their marks.
 * Shared: each item's single mark and the closing record. Individual: `viewerId`'s own marks (staff view),
 * or — for the panel (viewerId null) — how many people did each item and every person's progress.
 */
async function dayView(db: D1Database, cl: ChecklistRow & { body: RtNode | null }, date: string, locationId: string, viewerId: string | null = null) {
  const items = checklistItems(cl.body);
  const [marksRes, day] = await db.batch([
    db
      .prepare(
        `SELECT m.item_key AS itemKey, m.item_text AS itemText, m.section, m.user_id AS userId, m.marked_at AS markedAt,
                u.first_name || ' ' || u.last_name AS name
         FROM checklist_marks m JOIN users u ON u.id = m.user_id
         WHERE m.content_item_id = ? AND m.business_date = ? AND m.location_id = ? ORDER BY m.marked_at`,
      )
      .bind(cl.id, date, locationId),
    db
      .prepare(
        `SELECT d.closed_at AS closedAt, d.done_count AS doneCount, d.total_count AS totalCount,
                CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END AS closedByName
         FROM checklist_days d LEFT JOIN users u ON u.id = d.closed_by
         WHERE d.content_item_id = ? AND d.business_date = ? AND d.location_id = ?`,
      )
      .bind(cl.id, date, locationId),
  ]);
  const marks = marksRes!.results as MarkRow[];

  if (cl.mode === 'individual') {
    const known = new Set(items.map((i) => i.key));
    const mine = new Map(marks.filter((m) => m.userId === viewerId).map((m) => [m.itemKey, m]));
    const byItem = new Map<string, MarkRow[]>();
    for (const m of marks) if (known.has(m.itemKey)) byItem.set(m.itemKey, [...(byItem.get(m.itemKey) ?? []), m]);
    const people = new Map<string, { userId: string; name: string; done: number; total: number; lastAt: number | null }>();
    if (viewerId === null) for (const p of await expectedPeople(db, cl, date, locationId)) people.set(p.userId, { ...p, done: 0, total: items.length, lastAt: null });
    for (const m of marks) {
      if (!known.has(m.itemKey)) continue;
      const p = people.get(m.userId) ?? { userId: m.userId, name: m.name, done: 0, total: items.length, lastAt: null };
      p.done += 1;
      p.lastAt = Math.max(p.lastAt ?? 0, m.markedAt);
      people.set(m.userId, p);
    }
    const view = items.map((it) => {
      const own = mine.get(it.key);
      const all = byItem.get(it.key) ?? [];
      return {
        key: it.key,
        section: it.section,
        text: it.text,
        mark: own ? { userId: own.userId, name: own.name, at: own.markedAt } : null,
        ...(viewerId === null ? { count: all.length, by: all.map((m) => ({ name: m.name, at: m.markedAt })) } : {}),
      };
    });
    const list = [...people.values()].sort((x, y) => y.done - x.done || x.name.localeCompare(y.name, 'pl'));
    const done = viewerId === null ? list.reduce((a, p) => a + p.done, 0) : mine.size;
    const total = viewerId === null ? items.length * list.length : items.length;
    return { mode: cl.mode, items: view, done, total, itemCount: items.length, people: viewerId === null ? list : undefined, closed: null };
  }

  const byKey = new Map(marks.map((m) => [m.itemKey, m]));
  const view = items.map((it) => {
    const m = byKey.get(it.key);
    return { key: it.key, section: it.section, text: it.text, mark: m ? { userId: m.userId, name: m.name, at: m.markedAt } : null };
  });
  // Marks of items that were later removed from the checklist stay visible in history.
  const known = new Set(items.map((i) => i.key));
  for (const m of byKey.values()) {
    if (!known.has(m.itemKey)) view.push({ key: m.itemKey, section: m.section, text: m.itemText, mark: { userId: m.userId, name: m.name, at: m.markedAt } });
  }
  const closed = (day!.results[0] as { closedAt: number; doneCount: number; totalCount: number; closedByName: string | null } | undefined) ?? null;
  return { mode: cl.mode, items: view, done: view.filter((v) => v.mark).length, total: view.length, itemCount: items.length, people: undefined, closed };
}

async function openShift(db: D1Database, userId: string, locationId: string, now: number) {
  const { staleHours } = await locationRules(db, locationId);
  return db
    .prepare(`SELECT id, clock_in_at AS since FROM time_entries WHERE user_id = ? AND location_id = ? AND clock_out_at IS NULL AND clock_in_at > ? ORDER BY clock_in_at DESC LIMIT 1`)
    .bind(userId, locationId, now - staleHours * 3600_000)
    .first<{ id: string; since: number }>();
}

/* ───────── Staff ───────── */

/** Today: am I on shift, and the checklists of my position with progress. */
checklistRoutes.get('/locations/:locId/checklists/today', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireLocation(access, locId);
  const now = Date.now();
  const { dayStartHour } = await locationRules(db, locId);
  const date = businessDate(now, dayStartHour);
  const positions = await userPositions(db, c.var.user, locId);
  const lists = await visibleContent(db, locId, positions, ['checklist']);
  const shift = await openShift(db, c.var.user.id, locId, now);
  const out = [];
  for (const l of lists) {
    const cl = await loadChecklist(db, l.id);
    const v = await dayView(db, cl, date, locId, c.var.user.id);
    out.push({
      id: l.id,
      title: l.title,
      mode: cl.mode,
      done: v.done,
      total: v.total,
      closed: Boolean(v.closed),
      mine: v.items.filter((i) => i.mark?.userId === c.var.user.id).length,
    });
  }
  return c.json({ date, onShift: shift ? { since: shift.since } : null, checklists: out.filter((x) => x.total > 0) });
});

async function staffChecklist(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const cl = await loadChecklist(db, id);
  if (cl.status !== 'published' || !cl.currentVersionId) throw notFound();
  const locId = cl.locationId ?? [...access.locations.keys()][0];
  if (!locId || !access.locations.has(locId)) throw notFound();
  const positions = await userPositions(db, c.var.user, locId);
  if (!isVisibleFor(cl.positions, positions)) throw notFound();
  const { dayStartHour: day } = await locationRules(db, locId);
  return { cl, locId, day };
}

checklistRoutes.get('/checklists/:id/today', async (c) => {
  const { cl, locId, day } = await staffChecklist(c, c.req.param('id'));
  const now = Date.now();
  const date = businessDate(now, day);
  const shift = await openShift(c.env.DB, c.var.user.id, locId, now);
  return c.json({ id: cl.id, title: cl.title, date, me: c.var.user.id, onShift: shift ? { since: shift.since } : null, ...(await dayView(c.env.DB, cl, date, locId, c.var.user.id)) });
});

async function requireShift(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string) {
  const shift = await openShift(c.env.DB, c.var.user.id, locId, Date.now());
  if (!shift) throw new ApiError(409, 'not_on_shift');
}

async function requireOpenDay(db: D1Database, id: string, date: string) {
  const closed = await db.prepare(`SELECT 1 FROM checklist_days WHERE content_item_id = ? AND business_date = ?`).bind(id, date).first();
  if (closed) throw new ApiError(409, 'checklist_closed');
}

checklistRoutes.post('/checklists/:id/marks', async (c) => {
  const db = c.env.DB;
  const { cl, locId, day } = await staffChecklist(c, c.req.param('id'));
  await requireShift(c, locId);
  const date = businessDate(Date.now(), day);
  await requireOpenDay(db, cl.id, date);
  const body = await readJson<{ key?: unknown }>(c.req.raw);
  const item = checklistItems(cl.body).find((i) => i.key === body.key);
  if (!item) throw badRequest('item_unknown');
  const individual = cl.mode === 'individual';
  const taken = individual
    ? null
    : await db
    .prepare(`SELECT u.first_name || ' ' || u.last_name AS name FROM checklist_marks m JOIN users u ON u.id = m.user_id WHERE m.content_item_id = ? AND m.business_date = ? AND m.item_key = ?`)
    .bind(cl.id, date, item.key)
    .first<{ name: string }>();
  if (taken) throw new ApiError(409, 'item_taken', { name: taken.name });
  const res = await db
    .prepare(
      `INSERT INTO checklist_marks (id, location_id, content_item_id, business_date, item_key, item_text, section, user_id, marked_at, owner_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (content_item_id, business_date, item_key, owner_key) DO NOTHING`,
    )
    .bind(newId('cm'), locId, cl.id, date, item.key, item.text, item.section, c.var.user.id, Date.now(), individual ? c.var.user.id : '')
    .run();
  if (!individual && !res.meta.changes) {
    // someone was faster by a split second
    const who = await db
      .prepare(`SELECT u.first_name || ' ' || u.last_name AS name, m.user_id AS userId FROM checklist_marks m JOIN users u ON u.id = m.user_id WHERE m.content_item_id = ? AND m.business_date = ? AND m.item_key = ?`)
      .bind(cl.id, date, item.key)
      .first<{ name: string; userId: string }>();
    if (who && who.userId !== c.var.user.id) throw new ApiError(409, 'item_taken', { name: who.name });
  }
  return c.json({ ok: true });
});

/** Undo your own mark (same day, before the list is closed). */
checklistRoutes.delete('/checklists/:id/marks/:key', async (c) => {
  const db = c.env.DB;
  const { cl, day } = await staffChecklist(c, c.req.param('id'));
  const date = businessDate(Date.now(), day);
  await requireOpenDay(db, cl.id, date);
  const res = await db
    .prepare(`DELETE FROM checklist_marks WHERE content_item_id = ? AND business_date = ? AND item_key = ? AND user_id = ?`)
    .bind(cl.id, date, c.req.param('key'), c.var.user.id)
    .run();
  if (!res.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** Close the checklist for today; items not marked stay "not done". */
checklistRoutes.post('/checklists/:id/close', async (c) => {
  const db = c.env.DB;
  const { cl, locId, day } = await staffChecklist(c, c.req.param('id'));
  if (cl.mode === 'individual') throw new ApiError(409, 'checklist_individual');
  await requireShift(c, locId);
  const date = businessDate(Date.now(), day);
  await requireOpenDay(db, cl.id, date);
  const v = await dayView(db, cl, date, locId);
  await db.batch([
    db
      .prepare(`INSERT INTO checklist_days (content_item_id, business_date, location_id, closed_by, closed_at, done_count, total_count) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(cl.id, date, locId, c.var.user.id, Date.now(), v.done, v.total),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'checklist.close', entityType: 'content', entityId: cl.id, after: { date, done: v.done, total: v.total } }),
  ]);
  return c.json({ ok: true });
});

/* ───────── Panel ───────── */

async function adminGuard(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string): Promise<Access> {
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'checklists.view');
  return access;
}

/** One day: every checklist with items, who marked them and when, and who closed the list. */
checklistAdminRoutes.get('/locations/:locId/checklists/day', async (c) => {
  const locId = c.req.param('locId');
  await adminGuard(c, locId);
  const date = c.req.query('date');
  if (!isIsoDate(date)) throw badRequest('invalid_input');
  const db = c.env.DB;
  const lists = await visibleContent(db, locId, null, ['checklist']);
  const out = [];
  for (const l of lists) {
    const cl = await loadChecklist(db, l.id);
    const v = await dayView(db, cl, date, locId);
    if (v.total) out.push({ id: l.id, title: l.title, ...v });
  }
  return c.json({ date, checklists: out });
});

/** Range: completion per checklist per day and items done per person. */
checklistAdminRoutes.get('/locations/:locId/checklists/stats', async (c) => {
  const locId = c.req.param('locId');
  await adminGuard(c, locId);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest('invalid_input');
  const days = dateRange(from, to);
  const last = days[days.length - 1]!;
  const db = c.env.DB;
  const lists = await visibleContent(db, locId, null, ['checklist']);
  const totals = new Map<string, number>();
  const loaded = new Map<string, ChecklistRow>();
  for (const l of lists) {
    const cl = await loadChecklist(db, l.id);
    loaded.set(l.id, cl);
    totals.set(l.id, checklistItems(cl.body).length);
  }
  const [perDay, perPerson, closed] = await db.batch([
    db
      .prepare(`SELECT content_item_id AS id, business_date AS date, COUNT(*) AS done FROM checklist_marks WHERE location_id = ? AND business_date BETWEEN ? AND ? GROUP BY 1, 2`)
      .bind(locId, from, last),
    db
      .prepare(
        `SELECT m.user_id AS userId, u.first_name || ' ' || u.last_name AS name, COUNT(*) AS items, COUNT(DISTINCT m.business_date) AS days
         FROM checklist_marks m JOIN users u ON u.id = m.user_id
         WHERE m.location_id = ? AND m.business_date BETWEEN ? AND ? GROUP BY 1, 2 ORDER BY items DESC`,
      )
      .bind(locId, from, last),
    db
      .prepare(
        `SELECT d.content_item_id AS id, d.business_date AS date, d.done_count AS done, d.total_count AS total,
                CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END AS closedBy
         FROM checklist_days d LEFT JOIN users u ON u.id = d.closed_by WHERE d.location_id = ? AND d.business_date BETWEEN ? AND ?`,
      )
      .bind(locId, from, last),
  ]);
  // Individual lists: how many people should have done them each day (worked that day, matching position) or did something.
  const [worked, markers] = await db.batch([
    db
      .prepare(
        `SELECT DISTINCT e.business_date AS date, e.user_id AS userId,
                (SELECT group_concat(position) FROM user_locations ul WHERE ul.user_id = e.user_id AND ul.location_id = ?1 AND ul.is_active = 1) AS positions
         FROM time_entries e JOIN users u ON u.id = e.user_id
         WHERE e.location_id = ?1 AND e.business_date BETWEEN ?2 AND ?3 AND u.role = 'employee'`,
      )
      .bind(locId, from, last),
    db
      .prepare(`SELECT DISTINCT content_item_id AS id, business_date AS date, user_id AS userId FROM checklist_marks WHERE location_id = ? AND business_date BETWEEN ? AND ?`)
      .bind(locId, from, last),
  ]);
  const workedRows = worked!.results as { date: string; userId: string; positions: string | null }[];
  const markerRows = markers!.results as { id: string; date: string; userId: string }[];
  const perDayRows = (perDay!.results as { id: string; date: string; done: number }[]).map((r) => {
    const cl = loaded.get(r.id);
    if (cl?.mode !== 'individual') return r;
    const people = new Set(workedRows.filter((w) => w.date === r.date && isVisibleFor(cl.positions, w.positions ? w.positions.split(',') : [])).map((w) => w.userId));
    for (const m of markerRows) if (m.id === r.id && m.date === r.date) people.add(m.userId);
    return { ...r, people: people.size };
  });
  return c.json({
    days,
    checklists: lists
      .filter((l) => (totals.get(l.id) ?? 0) > 0)
      .map((l) => ({ id: l.id, title: l.title, total: totals.get(l.id), mode: loaded.get(l.id)?.mode ?? 'shared' })),
    perDay: perDayRows,
    closed: closed!.results,
    people: perPerson!.results,
  });
});

/** A manager reopens a closed day (e.g. closed by mistake). */
checklistAdminRoutes.delete('/locations/:locId/checklists/:id/days/:date', async (c) => {
  const locId = c.req.param('locId');
  await adminGuard(c, locId);
  const date = c.req.param('date');
  if (!isIsoDate(date)) throw badRequest('invalid_input');
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM checklist_days WHERE content_item_id = ? AND business_date = ? AND location_id = ?`).bind(c.req.param('id'), date, locId),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'checklist.reopen', entityType: 'content', entityId: c.req.param('id'), after: { date } }),
  ]);
  return c.json({ ok: true });
});
