import { DAY_START_HOUR, OPEN_SHIFT_STALE_HOURS } from '../../shared/time';

export interface LocationRules {
  dayStartHour: number;
  staleHours: number;
  punchPhoto: boolean;
}

/** Time rules of a location (D38); defaults when the location is unknown. */
export async function locationRules(db: D1Database, locationId: string): Promise<LocationRules> {
  const r = await db
    .prepare(`SELECT day_start_hour AS dayStartHour, stale_hours AS staleHours, punch_photo AS punchPhoto FROM locations WHERE id = ?`)
    .bind(locationId)
    .first<{ dayStartHour: number; staleHours: number; punchPhoto: number }>();
  return { dayStartHour: r?.dayStartHour ?? DAY_START_HOUR, staleHours: r?.staleHours ?? OPEN_SHIFT_STALE_HOURS, punchPhoto: Boolean(r?.punchPhoto) };
}
