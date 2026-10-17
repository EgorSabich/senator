/**
 * "Dziś" for leaders (D45): who should be here today and who is, late arrivals, missing exits, today's checklists.
 * Limited to the divisions of the viewer (a chef sees the kitchen; a zarządzający everything).
 */
import { Hono } from 'hono';
import { checklistItems } from '../../shared/checklist';
import type { RtNode } from '../../shared/richtext';
import { shiftEndMs, shiftStartMs } from '../../shared/schedule';
import { businessDate } from '../../shared/time';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/http';
import { locationRules } from '../lib/location';
import { isVisibleFor, visibleContent } from '../lib/learning';
import { deadlinesFor } from '../lib/deadlines';
import { allowedDivisions, loadAccess, requireLocation } from '../auth/access';

export const todayAdminRoutes = new Hono<AppEnv>();

const LATE_MIN = 5;

todayAdminRoutes.get('/locations/:locId/today', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireLocation(access, locId);
  const perms = access.locations.get(locId)!;
  if (access.role !== 'owner' && !perms.has('time.manage') && !perms.has('schedule.manage')) throw new ApiError(403, 'forbidden');
  const scope = allowedDivisions(access, locId);
  const now = Date.now();
  const rules = await locationRules(db, locId);
  const date = businessDate(now, rules.dayStartHour);

  const [people, plan, entries, stale] = await db.batch([
    db
      .prepare(
        `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, group_concat(ul.position) AS positions, u.first_login_at AS firstLoginAt, u.status
         FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
         WHERE u.role = 'employee' GROUP BY u.id`,
      )
      .bind(locId),
    db
      .prepare(
        `SELECT user_id AS userId, division, pub_start_min AS startMin, pub_end_min AS endMin FROM schedule_shifts
         WHERE location_id = ? AND date = ? AND published = 1 ORDER BY pub_start_min`,
      )
      .bind(locId, date),
    db
      .prepare(`SELECT id, user_id AS userId, clock_in_at AS clockInAt, clock_out_at AS clockOutAt FROM time_entries WHERE location_id = ? AND business_date = ? ORDER BY clock_in_at`)
      .bind(locId, date),
    db
      .prepare(
        `SELECT e.id, e.user_id AS userId, e.business_date AS date, e.clock_in_at AS clockInAt FROM time_entries e
         WHERE e.location_id = ? AND e.clock_out_at IS NULL AND e.clock_in_at < ? ORDER BY e.clock_in_at`,
      )
      .bind(locId, now - rules.staleHours * 3600_000),
  ]);
  const ppl = new Map(
    (people!.results as { id: string; firstName: string; lastName: string; positions: string; firstLoginAt: number | null; status: string }[]).map((p) => [
      p.id,
      { ...p, positions: p.positions.split(',') },
    ]),
  );
  const inScope = (userId: string, division?: string) => {
    if (!scope) return ppl.has(userId);
    if (division) return scope.has(division);
    return Boolean(ppl.get(userId)?.positions.some((p) => scope.has(p)));
  };
  const name = (id: string) => {
    const p = ppl.get(id);
    return p ? `${p.firstName} ${p.lastName.trim().charAt(0)}.` : '—';
  };
  const division = (id: string) => ppl.get(id)?.positions[0] ?? null;

  const shifts = (plan!.results as { userId: string; division: string; startMin: number; endMin: number }[]).filter((s) => inScope(s.userId, s.division));
  const real = (entries!.results as { id: string; userId: string; clockInAt: number; clockOutAt: number | null }[]).filter((e) => inScope(e.userId));

  // one row per planned shift, then people who came without a plan
  const rows = shifts.map((s) => {
    const start = shiftStartMs(date, s.startMin);
    const end = shiftEndMs(date, s.endMin);
    const mine = real.filter((e) => e.userId === s.userId);
    const first = mine[0];
    const lateMin = first ? Math.round((first.clockInAt - start) / 60000) : Math.round((now - start) / 60000);
    let status: 'on_shift' | 'done' | 'late' | 'not_yet' | 'absent';
    if (first) status = mine.some((e) => !e.clockOutAt) ? 'on_shift' : 'done';
    else if (now < start) status = 'not_yet';
    else if (now > end) status = 'absent';
    else status = 'late';
    return {
      userId: s.userId,
      name: name(s.userId),
      division: s.division,
      startMin: s.startMin,
      endMin: s.endMin,
      status,
      clockInAt: first?.clockInAt ?? null,
      clockOutAt: first?.clockOutAt ?? null,
      lateMin: (first && lateMin > LATE_MIN) || status === 'late' ? Math.max(lateMin, 0) : 0,
    };
  });
  const planned = new Set(shifts.map((s) => s.userId));
  const unplanned = [...new Set(real.filter((e) => !planned.has(e.userId)).map((e) => e.userId))].map((id) => {
    const mine = real.filter((e) => e.userId === id);
    return { userId: id, name: name(id), division: division(id), clockInAt: mine[0]!.clockInAt, onShift: mine.some((e) => !e.clockOutAt) };
  });
  const missingExits = (stale!.results as { id: string; userId: string; date: string; clockInAt: number }[])
    .filter((e) => inScope(e.userId))
    .map((e) => ({ ...e, name: name(e.userId) }));

  // today's checklists for my divisions
  const lists = await visibleContent(db, locId, scope ? [...scope] : null, ['checklist']);
  const checklists = [];
  for (const l of lists) {
    const row = await db
      .prepare(`SELECT v.body_json AS body, ci.checklist_shared_keys AS shared FROM content_items ci JOIN content_versions v ON v.id = ci.current_version_id WHERE ci.id = ?`)
      .bind(l.id)
      .first<{ body: string; shared: string | null }>();
    let body: RtNode | null = null;
    let sharedKeys = new Set<string>();
    try {
      body = row ? (JSON.parse(row.body) as RtNode) : null;
      sharedKeys = new Set(row?.shared ? (JSON.parse(row.shared) as string[]) : []);
    } catch {
      body = null;
    }
    const items = checklistItems(body);
    const total = items.length;
    if (!total) continue;
    const keys = new Set(items.map((i) => i.key));
    const marks = (
      await db
        .prepare(`SELECT user_id AS userId, item_key AS itemKey FROM checklist_marks WHERE content_item_id = ? AND business_date = ?`)
        .bind(l.id, date)
        .all<{ userId: string; itemKey: string }>()
    ).results.filter((m) => keys.has(m.itemKey));
    // per item mode (2026-10-17): a person is done when their own items and the shift's shared items are all ticked
    const sharedDone = new Set(marks.filter((m) => sharedKeys.has(m.itemKey)).map((m) => m.itemKey)).size;
    const who = new Set([...real.map((e) => e.userId)].filter((id) => isVisibleFor(l.positions, ppl.get(id)?.positions ?? [])));
    for (const m of marks) who.add(m.userId);
    const doneOf = (id: string) => marks.filter((m) => m.userId === id && !sharedKeys.has(m.itemKey)).length + sharedDone;
    const peopleDone = [...who].filter((id) => doneOf(id) >= total).length;
    const done = who.size ? [...who].reduce((a, id) => a + doneOf(id), 0) : sharedDone;
    checklists.push({ id: l.id, title: l.title, mode: 'individual', people: who.size, peopleDone, done, total: total * Math.max(who.size, 1) });
  }

  // 2026-10-17: who has Grafik locked for unread documents, and whose period ends soon
  const watched = [...ppl.values()].filter((p) => p.status === 'active' && inScope(p.id));
  const dl = await deadlinesFor(db, locId, watched.map((p) => ({ id: p.id, positions: p.positions, firstLoginAt: p.firstLoginAt })), now);
  const documents = watched
    .map((p) => ({ p, d: dl.get(p.id)! }))
    .filter(({ d }) => d.lockedSince !== null || d.nextDue !== null)
    .map(({ p, d }) => ({
      userId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      lockedSince: d.lockedSince,
      nextDue: d.nextDue,
      overdue: d.items.filter((i) => i.overdue).length,
      pending: d.items.length,
    }))
    .sort((a, b) => (a.lockedSince ?? Infinity) - (b.lockedSince ?? Infinity) || (a.nextDue ?? Infinity) - (b.nextDue ?? Infinity));
  return c.json({
    documents,
    date,
    now,
    divisions: scope ? [...scope] : null,
    summary: {
      planned: rows.length,
      onShift: rows.filter((r) => r.status === 'on_shift').length + unplanned.filter((u) => u.onShift).length,
      late: rows.filter((r) => r.status === 'late' || r.lateMin > 0).length,
      absent: rows.filter((r) => r.status === 'absent').length,
      missingExits: missingExits.length,
    },
    rows,
    unplanned,
    missingExits,
    checklists,
  });
});
