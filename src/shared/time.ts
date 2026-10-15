/**
 * Time tracking rules shared by server and app (D35).
 * A business day runs 06:00–06:00 Warsaw time, so a shift that ends at 02:00 belongs to the day it started,
 * and a closing checklist done after midnight belongs to the evening before.
 */
export const TIME_ZONE = 'Europe/Warsaw';
export const DAY_START_HOUR = 6;
/** An open shift older than this is "missing exit": the next PIN starts a new shift and the old one waits for a manager. */
export const OPEN_SHIFT_STALE_HOURS = 16;
/** Offline punches older than this are not accepted (the phone clock may be wrong or the queue stale). */
export const OFFLINE_MAX_AGE_HOURS = 72;
/** A second PIN within this time after clock-in is ignored as a double tap. */
export const DOUBLE_TAP_SECONDS = 60;

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('pl-PL', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });

/** Calendar date (YYYY-MM-DD) in Warsaw. */
export function warsawDate(ms: number): string {
  return fmt.format(new Date(ms));
}

/** Business date of a moment: Warsaw date of (moment − 6 h). */
export function businessDate(ms: number): string {
  return warsawDate(ms - DAY_START_HOUR * 3600_000);
}

export function formatClock(ms: number): string {
  return fmtTime.format(new Date(ms));
}

/** "7:45" from minutes. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Offset of Warsaw from UTC at a moment, in minutes (60 or 120). */
function warsawOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** Unix ms of a Warsaw wall-clock time ("2026-10-15", "22:30"). */
export function warsawToMs(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const first = guess - warsawOffsetMinutes(guess) * 60000;
  return guess - warsawOffsetMinutes(first) * 60000;
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
}

/** Dates from `from` to `to` inclusive (max 62). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(from + 'T12:00:00Z');
  const end = Date.parse(to + 'T12:00:00Z');
  while (t <= end && out.length < 62) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 864e5;
  }
  return out;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10);
}
