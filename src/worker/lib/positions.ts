/**
 * Several positions per person (owner, 2026-10-17). A shift is paid by the rate of the position it was worked on:
 * the manager's choice on the entry, else the planned (published) shift's division, else the person's main position.
 */
import { divisionOf } from '../../shared/constants';

export interface PersonPositions {
  positions: string[];
  primary: string | null;
}

/** Positions of everyone at the location (or of the given people). */
export async function positionsAt(db: D1Database, locId: string): Promise<Map<string, PersonPositions>> {
  const { results } = await db
    .prepare(`SELECT user_id AS userId, position, is_primary AS isPrimary FROM user_locations WHERE location_id = ? ORDER BY is_primary DESC, created_at`)
    .bind(locId)
    .all<{ userId: string; position: string; isPrimary: number }>();
  const out = new Map<string, PersonPositions>();
  for (const r of results) {
    const p = out.get(r.userId) ?? { positions: [], primary: null };
    p.positions.push(r.position);
    if (!p.primary) p.primary = r.position; // rows come main-first
    out.set(r.userId, p);
  }
  return out;
}

/** The person's position inside a division (waiter division + runner position → runner). */
export function positionInDivision(person: PersonPositions | undefined, division: string): string | null {
  if (!person) return null;
  if (person.positions.includes(division)) return division;
  return person.positions.find((p) => divisionOf(p) === division) ?? null;
}

const warsawMinutes = (ms: number) => {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
};

export interface EntryLike {
  id: string;
  userId: string;
  businessDate: string;
  clockInAt: number;
  position?: string | null;
}

/** Position each entry was worked on (see the top of the file). */
export async function entryPositions(db: D1Database, locId: string, entries: EntryLike[], people?: Map<string, PersonPositions>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!entries.length) return out;
  const who = people ?? (await positionsAt(db, locId));
  const dates = entries.map((e) => e.businessDate).sort();
  const { results: plan } = await db
    .prepare(
      `SELECT user_id AS userId, date, division, pub_start_min AS startMin FROM schedule_shifts
       WHERE location_id = ? AND published = 1 AND is_deleted = 0 AND date BETWEEN ? AND ?`,
    )
    .bind(locId, dates[0], dates[dates.length - 1])
    .all<{ userId: string; date: string; division: string; startMin: number }>();
  for (const e of entries) {
    const person = who.get(e.userId);
    if (e.position && person?.positions.includes(e.position)) {
      out.set(e.id, e.position);
      continue;
    }
    const shifts = plan.filter((s) => s.userId === e.userId && s.date === e.businessDate);
    let pos: string | null = null;
    if (shifts.length) {
      // minutes from the business day's midnight (a shift that starts after midnight belongs to the evening before)
      const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(e.clockInAt));
      const at = warsawMinutes(e.clockInAt) + (localDate > e.businessDate ? 1440 : 0);
      const best = shifts.reduce((a, b) => (Math.abs(b.startMin - at) < Math.abs(a.startMin - at) ? b : a));
      pos = positionInDivision(person, best.division);
    }
    out.set(e.id, pos ?? person?.primary ?? null);
  }
  return out;
}

export interface RateRow {
  userId?: string;
  position: string;
  validFrom: string;
  rateGrosze: number;
}

/** Rate on a date for a position: that position's rates, else rates for every position (''); before the first one: the first one. */
export function rateFor(rates: RateRow[], position: string | null, date: string): number | null {
  const own = position ? rates.filter((r) => r.position === position) : [];
  const list = own.length ? own : rates.filter((r) => r.position === '');
  if (!list.length) return null;
  let r = list[0]!.rateGrosze;
  for (const x of list) if (x.validFrom <= date) r = x.rateGrosze;
  return r;
}
