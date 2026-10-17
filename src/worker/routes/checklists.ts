/**
 * Daily checklists (D36, D42). Every list item of a published checklist is a task for the business day.
 * Staff mark the items they did, but only while on shift (clocked in on the terminal).
 * Since 2026-10-17 the mode is per item: "Każdy" (everyone ticks it) or "Jeden za zmianę" (one tick for the shift);
 * lists are no longer closed for the day (old closings stay in history).
 */
import { Hono } from 'hono';
import { checklistItems } from '../../shared/checklist';
import type { RtNode } from '../../shared/richtext';
import { businessDate, dateRange, isIsoDate } from '../../shared/time';
import { locationRules } from '../lib/location';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson } from '../lib/http';
import { allowedDivisions, loadAccess, requireLocation, requirePermission, scopedUserIds, type Access } from '../auth/access';
import { isVisibleFor, userPositions, visibleContent } from '../lib/learning';
import { CHECKLIST_PHOTO_MAX_BYTES, decodeJpeg } from '../jobs/punchPhotos';

export const checklistRoutes = new Hono<AppEnv>();
export const checklistAdminRoutes = new Hono<AppEnv>();

export interface ChecklistRow {
  id: string;
  locationId: string | null;
  title: string;
  status: string;
  currentVersionId: string | null;
  positions: string | null;
  mode: 'individual' | 'shared';
  photoKeysJson: string | null;
  sharedKeysJson: string | null;
}

export function keySet(json: string | null): Set<string> {
  if (!json) return new Set();
  try {
    const v = JSON.parse(json) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
/** Item keys that need a photo when ticked (any item, 2026-10-17). */
const photoKeys = (cl: ChecklistRow) => keySet(cl.photoKeysJson);
/** Items one person ticks for the whole shift; every other item each person ticks for themselves (2026-10-17). */
const sharedKeys = (cl: ChecklistRow) => keySet(cl.sharedKeysJson);

export async function loadChecklist(db: D1Database, id: string): Promise<ChecklistRow & { body: RtNode | null }> {
  const row = await db
    .prepare(
      `SELECT ci.id, ci.location_id AS locationId, ci.title, ci.status, ci.current_version_id AS currentVersionId, ci.checklist_mode AS mode, ci.checklist_photo_keys AS photoKeysJson, ci.checklist_shared_keys AS sharedKeysJson,
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
  markId: string;
  hasPhoto: number;
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
 * Items of the day with their marks (2026-10-17: the mode is per item).
 * - "Każdy" item: everyone on shift ticks it for themselves;
 * - "Jeden za zmianę" item: one tick for the whole shift, others see who did it.
 * Staff view (viewerId): own ticks of personal items + any tick of shared items.
 * Panel (viewerId null): per item how many people did it / who did the shared one, and each person's progress
 * (their personal ticks + the shift's shared ticks).
 */
async function dayView(db: D1Database, cl: ChecklistRow & { body: RtNode | null }, date: string, locationId: string, viewerId: string | null = null) {
  const items = checklistItems(cl.body);
  const [marksRes, day] = await db.batch([
    db
      .prepare(
        `SELECT m.item_key AS itemKey, m.item_text AS itemText, m.section, m.user_id AS userId, m.marked_at AS markedAt, m.id AS markId,
                (m.photo_key IS NOT NULL) AS hasPhoto, u.first_name || ' ' || u.last_name AS name
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
  const needPhoto = photoKeys(cl);
  const shared = sharedKeys(cl);
  const known = new Set(items.map((i) => i.key));
  const byItem = new Map<string, MarkRow[]>();
  for (const m of marks) if (known.has(m.itemKey)) byItem.set(m.itemKey, [...(byItem.get(m.itemKey) ?? []), m]);
  const sharedDone = items.filter((it) => shared.has(it.key) && byItem.get(it.key)?.length).length;

  const view = items.map((it) => {
    const all = byItem.get(it.key) ?? [];
    const isShared = shared.has(it.key);
    const own = isShared ? all[0] : all.find((m) => m.userId === viewerId);
    return {
      key: it.key,
      section: it.section,
      text: it.text,
      shared: isShared,
      photo: needPhoto.has(it.key),
      mark: own && (isShared || viewerId !== null) ? { userId: own.userId, name: own.name, at: own.markedAt, photo: Boolean(own.hasPhoto), photoId: own.hasPhoto ? own.markId : null } : null,
      ...(viewerId === null ? { count: all.length, by: all.map((m) => ({ name: m.name, at: m.markedAt, photoId: m.hasPhoto ? m.markId : null })) } : {}),
    };
  });
  const closed = (day!.results[0] as { closedAt: number; doneCount: number; totalCount: number; closedByName: string | null } | undefined) ?? null;

  if (viewerId !== null) {
    const done = view.filter((v) => v.mark).length;
    return { mode: cl.mode, items: view, done, total: items.length, itemCount: items.length, people: undefined, closed };
  }
  // panel: everyone expected that day, each with their own progress
  const personal = items.filter((it) => !shared.has(it.key));
  const people = new Map<string, { userId: string; name: string; done: number; total: number; lastAt: number | null }>();
  for (const p of await expectedPeople(db, cl, date, locationId)) people.set(p.userId, { userId: p.userId, name: p.name, done: sharedDone, total: items.length, lastAt: null });
  for (const m of marks) {
    if (!known.has(m.itemKey)) continue;
    const p = people.get(m.userId) ?? { userId: m.userId, name: m.name, done: sharedDone, total: items.length, lastAt: null };
    if (!shared.has(m.itemKey)) p.done += 1;
    p.lastAt = Math.max(p.lastAt ?? 0, m.markedAt);
    people.set(m.userId, p);
  }
  const list = [...people.values()].sort((x, y) => y.done - x.done || x.name.localeCompare(y.name, 'pl'));
  const done = list.length ? list.reduce((a, p) => a + p.done, 0) : sharedDone;
  const total = list.length ? items.length * list.length : shared.size ? items.filter((i) => shared.has(i.key)).length : 0;
  return { mode: cl.mode, items: view, done, total, itemCount: items.length, personalCount: personal.length, people: list, closed };
}

/** Has this person ticked everything of the list that is theirs to tick today (own items + the shift's shared ones)? */
export async function checklistDoneFor(db: D1Database, listId: string, userId: string, date: string, locationId: string): Promise<{ done: boolean; title: string } | null> {
  let cl: ChecklistRow & { body: RtNode | null };
  try {
    cl = await loadChecklist(db, listId);
  } catch {
    return null;
  }
  if (cl.status !== 'published' || !cl.body) return null;
  const v = await dayView(db, cl, date, locationId, userId);
  if (!v.total) return null; // nothing to tick — nothing to remind about
  return { done: v.done >= v.total, title: cl.title };
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
  const body = await readJson<{ key?: unknown; photo?: unknown }>(c.req.raw);
  const item = checklistItems(cl.body).find((i) => i.key === body.key);
  if (!item) throw badRequest('item_unknown');
  const individual = !sharedKeys(cl).has(item.key);
  // An item that needs a photo is ticked only together with one.
  let photo: Uint8Array | null = null;
  if (photoKeys(cl).has(item.key)) {
    photo = decodeJpeg(body.photo, CHECKLIST_PHOTO_MAX_BYTES);
    if (!photo) throw badRequest('photo_required');
  }
  const markId = newId('cm');
  const photoKey = photo ? `checklist-photos/${locId}/${date}/${markId}.jpg` : null;
  const taken = individual
    ? null
    : await db
    .prepare(`SELECT u.first_name || ' ' || u.last_name AS name FROM checklist_marks m JOIN users u ON u.id = m.user_id WHERE m.content_item_id = ? AND m.business_date = ? AND m.item_key = ?`)
    .bind(cl.id, date, item.key)
    .first<{ name: string }>();
  if (taken) throw new ApiError(409, 'item_taken', { name: taken.name });
  const res = await db
    .prepare(
      `INSERT INTO checklist_marks (id, location_id, content_item_id, business_date, item_key, item_text, section, user_id, marked_at, owner_key, photo_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (content_item_id, business_date, item_key, owner_key) DO NOTHING`,
    )
    .bind(markId, locId, cl.id, date, item.key, item.text, item.section, c.var.user.id, Date.now(), individual ? c.var.user.id : '', photoKey)
    .run();
  if (photo && photoKey && res.meta.changes) {
    try {
      await c.env.PHOTOS.put(photoKey, photo, { httpMetadata: { contentType: 'image/jpeg' } });
    } catch (e) {
      await db.prepare(`DELETE FROM checklist_marks WHERE id = ?`).bind(markId).run();
      throw e;
    }
  }
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
  const mark = await db
    .prepare(`SELECT id, photo_key AS photoKey FROM checklist_marks WHERE content_item_id = ? AND business_date = ? AND item_key = ? AND user_id = ?`)
    .bind(cl.id, date, c.req.param('key'), c.var.user.id)
    .first<{ id: string; photoKey: string | null }>();
  if (!mark) throw notFound();
  await db.prepare(`DELETE FROM checklist_marks WHERE id = ?`).bind(mark.id).run();
  if (mark.photoKey) await c.env.PHOTOS.delete(mark.photoKey);
  return c.json({ ok: true });
});

/** Close the checklist for today; items not marked stay "not done". */
checklistRoutes.post('/checklists/:id/close', async (c) => {
  const db = c.env.DB;
  const { cl, locId, day } = await staffChecklist(c, c.req.param('id'));
  throw new ApiError(409, 'checklist_no_closing'); // owner, 2026-10-17: lists are not closed any more
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
  const access = await loadAccess(db, c.var.user);
  const scope = allowedDivisions(access, locId);
  const lists = await visibleContent(db, locId, scope ? [...scope] : null, ['checklist']);
  const people = await scopedUserIds(db, access, locId);
  const out = [];
  for (const l of lists) {
    const cl = await loadChecklist(db, l.id);
    const v = await dayView(db, cl, date, locId);
    if (!v.itemCount) continue; // a list nobody worked on today still shows (division filter, 2026-10-17)
    // D44: only people of my divisions
    const keep = (userId: string) => !people || people.has(userId);
    out.push({
      id: l.id,
      title: l.title,
      positions: l.positions ? l.positions.split(',') : [],
      ...v,
      people: v.people?.filter((p) => keep(p.userId)),
    });
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
  const access = await loadAccess(db, c.var.user);
  const scope = allowedDivisions(access, locId);
  const lists = await visibleContent(db, locId, scope ? [...scope] : null, ['checklist']);
  const people = await scopedUserIds(db, access, locId);
  const totals = new Map<string, number>();
  const sharedCount = new Map<string, number>();
  const loaded = new Map<string, ChecklistRow>();
  for (const l of lists) {
    const cl = await loadChecklist(db, l.id);
    loaded.set(l.id, cl);
    const its = checklistItems(cl.body);
    totals.set(l.id, its.length);
    const sk = sharedKeys(cl);
    sharedCount.set(l.id, its.filter((i) => sk.has(i.key)).length);
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
    if (!cl) return r;
    const people = new Set(workedRows.filter((w) => w.date === r.date && isVisibleFor(cl.positions, w.positions ? w.positions.split(',') : [])).map((w) => w.userId));
    for (const m of markerRows) if (m.id === r.id && m.date === r.date) people.add(m.userId);
    return { ...r, people: people.size };
  });
  return c.json({
    days,
    checklists: lists
      .filter((l) => (totals.get(l.id) ?? 0) > 0)
      .map((l) => ({ id: l.id, title: l.title, total: totals.get(l.id), shared: sharedCount.get(l.id) ?? 0, positions: l.positions ? l.positions.split(',') : [] })),
    perDay: perDayRows,
    closed: closed!.results,
    people: (perPerson!.results as { userId: string }[]).filter((p) => !people || people.has(p.userId)),
  });
});

/** The photo a person took when ticking an item — for leaders who see that person's checklists. */
checklistAdminRoutes.get('/checklists/marks/:markId/photo', async (c) => {
  const db = c.env.DB;
  const m = await db
    .prepare(`SELECT photo_key AS photoKey, location_id AS locationId, user_id AS userId FROM checklist_marks WHERE id = ?`)
    .bind(c.req.param('markId'))
    .first<{ photoKey: string | null; locationId: string; userId: string }>();
  if (!m || !m.photoKey) throw notFound();
  const access = await adminGuard(c, m.locationId);
  const people = await scopedUserIds(db, access, m.locationId);
  if (people && !people.has(m.userId)) throw notFound();
  const obj = await c.env.PHOTOS.get(m.photoKey);
  if (!obj) throw notFound();
  return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
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
