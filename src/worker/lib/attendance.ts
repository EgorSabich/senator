/**
 * Statystyki → Obecność i spóźnienia (owner, 2026-10-17; mockup 12).
 * A published shift is matched with the person's clock-in closest to its start (from 4 h before the start
 * to its planned end). Rules from the owner:
 * - late = clock-in 5 minutes or more after the planned start;
 * - absence = the shift has ended and there is no clock-in for it;
 * - leaving early is not counted;
 * - „usprawiedliwione” (attendance_excuses) removes the shift's absence and lateness from the statistics.
 * Shifts that have not started yet are left out; a shift in progress without a clock-in is „pending”.
 */
import { divisionOf } from '../../shared/constants';
import { addDays } from '../../shared/time';
import { shiftEndMs, shiftStartMs, weekStart } from '../../shared/schedule';

export const LATE_MINUTES = 5;
const EARLY_WINDOW = 4 * 3600_000;

export type DayStatus = 'ok' | 'late' | 'absent' | 'pending' | 'excused';

export interface ShiftRow {
  id: string;
  userId: string;
  date: string;
  division: string;
  startMin: number;
  endMin: number;
}
interface EntryRow {
  id: string;
  userId: string;
  clockInAt: number;
  clockOutAt: number | null;
  inSource: string;
  outSource: string | null;
}
export interface DayView {
  shiftId: string;
  userId: string;
  date: string;
  division: string;
  plannedStart: number;
  plannedEnd: number;
  clockInAt: number | null;
  clockOutAt: number | null;
  lateMin: number;
  status: DayStatus;
  /** no clock-out: still missing (open and stale) or added later by a manager */
  missingExit: 'open' | 'fixed' | null;
  excuse: { reason: string; note: string | null } | null;
}

/** Days of the shifts in [from, to] for the divisions (null = all), as seen at `now`. */
export async function attendanceDays(db: D1Database, locId: string, from: string, to: string, divisions: Set<string> | null, now: number, userId?: string, staleHours = 16): Promise<DayView[]> {
  const { results: shifts } = await db
    .prepare(
      `SELECT id, user_id AS userId, date, division, pub_start_min AS startMin, pub_end_min AS endMin FROM schedule_shifts
       WHERE location_id = ? AND published = 1 AND is_deleted = 0 AND pub_start_min IS NOT NULL AND date BETWEEN ? AND ? ${userId ? 'AND user_id = ?' : ''}
       ORDER BY date, pub_start_min`,
    )
    .bind(locId, from, to, ...(userId ? [userId] : []))
    .all<ShiftRow>();
  const mine = shifts.filter((s) => (!divisions || divisions.has(s.division)) && shiftStartMs(s.date, s.startMin) <= now);
  if (!mine.length) return [];
  const lo = shiftStartMs(from, 0) - EARLY_WINDOW;
  const hi = shiftEndMs(to, 36 * 60);
  const { results: entries } = await db
    .prepare(
      `SELECT id, user_id AS userId, clock_in_at AS clockInAt, clock_out_at AS clockOutAt, in_source AS inSource, out_source AS outSource FROM time_entries
       WHERE location_id = ? AND clock_in_at BETWEEN ? AND ? ${userId ? 'AND user_id = ?' : ''} ORDER BY clock_in_at`,
    )
    .bind(locId, lo, hi, ...(userId ? [userId] : []))
    .all<EntryRow>();
  const { results: excuses } = await db
    .prepare(`SELECT shift_id AS shiftId, reason, note FROM attendance_excuses WHERE location_id = ? AND date BETWEEN ? AND ?`)
    .bind(locId, from, to)
    .all<{ shiftId: string; reason: string; note: string | null }>();
  const excuseOf = new Map(excuses.map((e) => [e.shiftId, e]));
  const byUser = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const l = byUser.get(e.userId) ?? [];
    l.push(e);
    byUser.set(e.userId, l);
  }
  const used = new Set<string>();
  const out: DayView[] = [];
  for (const s of mine) {
    const start = shiftStartMs(s.date, s.startMin);
    const end = shiftEndMs(s.date, s.endMin);
    let best: EntryRow | null = null;
    for (const e of byUser.get(s.userId) ?? []) {
      if (used.has(e.id) || e.clockInAt < start - EARLY_WINDOW || e.clockInAt > end) continue;
      if (!best || Math.abs(e.clockInAt - start) < Math.abs(best.clockInAt - start)) best = e;
    }
    if (best) used.add(best.id);
    const ex = excuseOf.get(s.id);
    const lateMin = best ? Math.max(0, Math.floor((best.clockInAt - start) / 60000)) : 0;
    let status: DayStatus;
    if (!best) status = end <= now ? 'absent' : 'pending';
    else status = lateMin >= LATE_MINUTES ? 'late' : 'ok';
    if (ex && (status === 'absent' || status === 'late')) status = 'excused';
    const missingExit = !best ? null : best.clockOutAt === null ? (now - best.clockInAt > staleHours * 3600_000 ? 'open' : null) : best.outSource === 'manual' && best.inSource !== 'manual' ? 'fixed' : null;
    out.push({
      shiftId: s.id,
      userId: s.userId,
      date: s.date,
      division: divisionOf(s.division),
      plannedStart: start,
      plannedEnd: end,
      clockInAt: best?.clockInAt ?? null,
      clockOutAt: best?.clockOutAt ?? null,
      lateMin,
      status,
      missingExit,
      excuse: ex ? { reason: ex.reason, note: ex.note } : null,
    });
  }
  return out;
}

export interface Totals {
  shifts: number;
  absences: number;
  excused: number;
  late: number;
  lateAvgMin: number;
  missingExit: number;
  fixedExit: number;
  plannedMin: number;
  workedMin: number;
}

export function totals(days: DayView[]): Totals {
  const done = days.filter((d) => d.status !== 'pending');
  const late = done.filter((d) => d.status === 'late');
  return {
    shifts: done.length,
    absences: done.filter((d) => d.status === 'absent').length,
    excused: done.filter((d) => d.status === 'excused').length,
    late: late.length,
    lateAvgMin: late.length ? Math.round(late.reduce((a, d) => a + d.lateMin, 0) / late.length) : 0,
    missingExit: done.filter((d) => d.missingExit).length,
    fixedExit: done.filter((d) => d.missingExit === 'fixed').length,
    plannedMin: done.reduce((a, d) => a + Math.round((d.plannedEnd - d.plannedStart) / 60000), 0),
    workedMin: done.reduce((a, d) => a + (d.clockInAt && d.clockOutAt ? Math.round((d.clockOutAt - d.clockInAt) / 60000) : 0), 0),
  };
}

/** Lateness and absences per week (Monday dates) in [from, to]. */
export function byWeek(days: DayView[], from: string, to: string) {
  const weeks: string[] = [];
  for (let w = weekStart(from); w <= to && weeks.length < 60; w = addDays(w, 7)) weeks.push(w);
  return weeks.map((w) => {
    const in7 = days.filter((d) => d.date >= w && d.date <= addDays(w, 6));
    return { week: w, late: in7.filter((d) => d.status === 'late').length, absences: in7.filter((d) => d.status === 'absent').length };
  });
}
