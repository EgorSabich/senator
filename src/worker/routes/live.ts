/**
 * „Live” (2026-10-17, stage 1): a light fingerprint of what changed at a location, asked every ~30 s by an open app.
 * The app refreshes the screen when a fingerprint changes and shows „Jest nowa wersja” when the version differs.
 * Only counts and latest times — no personal data.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { loadAccess, requireLocation } from '../auth/access';

export const liveRoutes = new Hono<AppEnv>();

liveRoutes.get('/locations/:locId/changes', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireLocation(access, locId);
  const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  const from = day(-7);
  const [schedule, unav, time, lists, content, menu, recruitment] = await db.batch([
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(updated_at), 0) || '.' || COALESCE(MAX(published_at), 0) AS v FROM schedule_shifts WHERE location_id = ? AND date >= ?`).bind(locId, from),
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(created_at), 0) AS v FROM unavailability WHERE location_id = ? AND date >= ?`).bind(locId, from),
    db
      .prepare(
        `SELECT COUNT(*) || '.' || COALESCE(MAX(clock_in_at), 0) || '.' || COALESCE(MAX(clock_out_at), 0) || '.' || COALESCE(MAX(edited_at), 0) AS v FROM time_entries WHERE location_id = ? AND business_date >= ?`,
      )
      .bind(locId, day(-2)),
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(marked_at), 0) AS v FROM checklist_marks WHERE location_id = ? AND business_date >= ?`).bind(locId, day(-1)),
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(updated_at), 0) AS v FROM content_items WHERE location_id = ? OR location_id IS NULL`).bind(locId),
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(updated_at), 0) AS v FROM menu_items WHERE location_id = ?`).bind(locId),
    db.prepare(`SELECT COUNT(*) || '.' || COALESCE(MAX(updated_at), 0) AS v FROM candidates WHERE location_id = ?`).bind(locId),
  ]);
  const v = (r: D1Result | undefined) => String((r?.results[0] as { v?: string } | undefined)?.v ?? '');
  return c.json(
    {
      version: __APP_VERSION__,
      areas: {
        schedule: `${v(schedule)}|${v(unav)}`,
        time: v(time),
        checklists: v(lists),
        content: v(content),
        menu: v(menu),
        recruitment: v(recruitment),
      },
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
});
