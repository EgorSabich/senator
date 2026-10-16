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
        `SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, group_concat(ul.position) AS positions
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
    (people!.results as { id: string; firstName: string; lastName: string; positions: string }[]).map((p) => [p.id, { ...p, positions: p.positions.split(',') }]),
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
      .prepare(`SELECT v.body_json AS body, ci.checklist_mode AS mode FROM content_items ci JOIN content_versions v ON v.id = ci.current_version_id WHERE ci.id = ?`)
      .bind(l.id)
      .first<{ body: string; mode: string }>();
    let body: RtNode | null = null;
    try {
      body = row ? (JSON.parse(row.body) as RtNode) : null;
    } catch {
      body = null;
    }
    const total = checklistItems(body).length;
    if (!total) continue;
    const marks = await db
      .prepare(`SELECT user_id AS userId, COUNT(*) AS n FROM checklist_marks WHERE content_item_id = ? AND business_date = ? GROUP BY user_id`)
      .bind(l.id, date)
      .all<{ userId: string; n: number }>();
    const closed = await db.prepare(`SELECT 1 FROM checklist_days WHERE content_item_id = ? AND business_date = ?`).bind(l.id, date).first();
    if (row?.mode === 'individual') {
      // people working today who should do it
      const who = new Set([...real.map((e) => e.userId)].filter((id) => isVisibleFor(l.positions, ppl.get(id)?.positions ?? [])));
      for (const m of marks.results) who.add(m.userId);
      const done = [...who].filter((id) => (marks.results.find((m) => m.userId === id)?.n ?? 0) >= total).length;
      checklists.push({ id: l.id, title: l.title, mode: 'individual', people: who.size, peopleDone: done, done: marks.results.reduce((a, m) => a + m.n, 0), total: total * Math.max(who.size, 1) });
    } else {
      checklists.push({ id: l.id, title: l.title, mode: 'shared', done: marks.results.reduce((a, m) => a + m.n, 0), total, closed: Boolean(closed) });
    }
  }

  return c.json({
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
