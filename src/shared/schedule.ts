/**
 * Staff schedule (D43): weeks start on Monday, times are minutes from 00:00 of the shift's start date
 * (an end after midnight is > 1440). Colours depend only on the start hour, so 10:00 looks the same every week.
 */
import { addDays, warsawToMs } from './time';

export const WEEK_DAYS = 7;
export const MAX_SHIFT_MINUTES = 16 * 60;

/** Monday of the week of a date (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(monday, i));
}

/** "10:00" → 600; null when not a valid HH:MM (or 4 digits "1000"). */
export function parseHm(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 600 → "10:00", 1560 → "02:00". */
export function formatHm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Start and end as typed → minutes with the end after the start (next day when needed). */
export function shiftMinutes(start: unknown, end: unknown): { startMin: number; endMin: number } | null {
  const s = parseHm(start);
  const e = parseHm(end);
  if (s === null || e === null) return null;
  const endMin = e <= s ? e + 1440 : e;
  if (endMin - s > MAX_SHIFT_MINUTES) return null;
  return { startMin: s, endMin };
}

/** Unix ms of the shift start / end (Warsaw time). */
export function shiftStartMs(date: string, startMin: number): number {
  return warsawToMs(date, formatHm(startMin));
}
export function shiftEndMs(date: string, endMin: number): number {
  return warsawToMs(endMin >= 1440 ? addDays(date, 1) : date, formatHm(endMin));
}

/** One colour per start hour, the same every week (the app's dark theme). */
const PALETTE = ['#6aa6d8', '#5fb3a8', '#7fbf6a', '#b9c45a', '#d8b24e', '#e0973f', '#e07b32', '#d9655b', '#c8679a', '#a77bd6', '#7f8ce0', '#5aa0c8'];
export function shiftColor(startMin: number): string {
  const h = Math.floor((((startMin % 1440) + 1440) % 1440) / 60);
  // 06:00 → first colour; the palette repeats every 12 hours (night shifts are rare)
  return PALETTE[(h + 6) % 12]!;
}

/**
 * Deadline for reporting days off in the week starting `monday`: the configured weekday of the week before, at HH:59 (Warsaw).
 * dow: 0 = Sunday, 1 = Monday … 6 = Saturday.
 */
export function unavailabilityDeadline(monday: string, dow: number, hour: number): number {
  const offset = dow === 0 ? -1 : dow - 8; // Sunday right before the week; Monday a week earlier, …
  const day = addDays(monday, offset);
  return warsawToMs(day, `${String(hour).padStart(2, '0')}:59`) + 59_999;
}
