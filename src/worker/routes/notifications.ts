/**
 * Panel → Powiadomienia (owner, 2026-10-17; mockups 10–11).
 * Division leaders set their own divisions; the owner and zarządzający (no division limit) set all.
 * Permission `notifications.manage`. Employees cannot switch kinds off (no settings on their side).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { divisionOf } from '../../shared/constants';
import { allowedDivisions, loadAccess, requirePermission, type Access } from '../auth/access';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { notify } from '../lib/notify';
import { DIVISIONS, RULE_KINDS, listsOf, loadRules, locationChecklists, type RuleKind } from '../lib/notifyRules';

export const notificationAdminRoutes = new Hono<AppEnv>();

const TRIGGERS = ['once', 'weekly', 'shift_start', 'after_clock_in', 'shift_end'] as const;
const AUDIENCES = ['on_shift', 'division'] as const;

function divisionsFor(access: Access, locId: string): string[] {
  const scope = allowedDivisions(access, locId);
  return DIVISIONS.filter((d) => !scope || scope.has(d));
}

async function guard(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string) {
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'notifications.manage');
  return { access, mine: divisionsFor(access, locId) };
}

interface CustomRow {
  id: string;
  title: string;
  body: string;
  divisions: string;
  audience: string;
  trigger: string;
  atMs: number | null;
  days: number;
  timeMin: number | null;
  minutes: number | null;
  url: string | null;
  enabled: number;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: number;
}
const CUSTOM_SELECT = `SELECT n.id, n.title, n.body, n.divisions, n.audience, n.trigger, n.at_ms AS atMs, n.days, n.time_min AS timeMin, n.minutes, n.url, n.enabled,
  n.created_by AS createdBy, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS createdByName, n.updated_at AS updatedAt
  FROM custom_notifications n LEFT JOIN users u ON u.id = n.created_by`;
const customView = (r: CustomRow, mine: string[]) => {
  const divisions = r.divisions.split(',').filter(Boolean);
  return { ...r, divisions, enabled: Boolean(r.enabled), editable: divisions.every((d) => mine.includes(d)) };
};

notificationAdminRoutes.get('/locations/:locId/notifications', async (c) => {
  const locId = c.req.param('locId');
  const { mine } = await guard(c, locId);
  const rules = await loadRules(c.env.DB, locId);
  const lists = await locationChecklists(c.env.DB, locId);
  const { results } = await c.env.DB.prepare(`${CUSTOM_SELECT} WHERE n.location_id = ? ORDER BY n.created_at DESC`).bind(locId).all<CustomRow>();
  return c.json({
    divisions: mine,
    rules: Object.fromEntries(
      mine.map((d) => [
        d,
        Object.fromEntries(
          RULE_KINDS.map((k) => {
            const r = rules.get(d)!.get(k)!;
            const chosen = k === 'checklist_open' || k === 'checklist_close' ? listsOf(r, d, lists).map((l) => l.id) : null;
            return [k, { enabled: r.enabled, timeMin: r.timeMin, minutes: r.minutes, listIds: chosen, auto: r.listIds === null }];
          }),
        ),
      ]),
    ),
    checklists: Object.fromEntries(mine.map((d) => [d, lists.filter((l) => !l.positions.length || l.positions.some((p) => divisionOf(p) === d)).map((l) => ({ id: l.id, title: l.title }))])),
    custom: results.filter((r) => r.divisions.split(',').some((d) => mine.includes(d))).map((r) => customView(r, mine)),
  });
});

const intIn = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

notificationAdminRoutes.put('/locations/:locId/notifications/rules', async (c) => {
  const locId = c.req.param('locId');
  const { mine } = await guard(c, locId);
  const body = await readJson<{ division?: unknown; kind?: unknown; enabled?: unknown; timeMin?: unknown; minutes?: unknown; listIds?: unknown }>(c.req.raw);
  const division = typeof body.division === 'string' ? body.division : '';
  const kind = typeof body.kind === 'string' ? (body.kind as RuleKind) : null;
  if (!kind || !(RULE_KINDS as readonly string[]).includes(kind)) throw badRequest();
  if (!DIVISIONS.includes(division)) throw badRequest();
  if (!mine.includes(division)) throw new ApiError(403, 'forbidden');
  const db = c.env.DB;
  const cur = (await loadRules(db, locId)).get(division)!.get(kind)!;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : cur.enabled;
  let timeMin = cur.timeMin;
  let minutes = cur.minutes;
  let listIds = cur.listIds;
  if (body.timeMin !== undefined) {
    const isList = kind === 'checklist_open' || kind === 'checklist_close';
    if (kind !== 'tomorrow_shift' && kind !== 'unavailability' && !isList) throw badRequest();
    if (body.timeMin === null && isList) timeMin = null; // back to „minutes after clock-in / before the end”
    else {
      const v = intIn(body.timeMin, 0, 1435);
      if (v === null || v % 5) throw badRequest('invalid_time');
      timeMin = v;
    }
  }
  if (body.minutes !== undefined) {
    if (kind !== 'checklist_open' && kind !== 'checklist_close') throw badRequest();
    const v = intIn(body.minutes, 5, 240);
    if (v === null) throw badRequest('invalid_minutes');
    minutes = v;
  }
  if (body.listIds !== undefined) {
    if (kind !== 'checklist_open' && kind !== 'checklist_close') throw badRequest();
    if (body.listIds === null) listIds = null;
    else {
      if (!Array.isArray(body.listIds) || body.listIds.length > 30 || body.listIds.some((x) => typeof x !== 'string')) throw badRequest();
      const known = new Set((await locationChecklists(db, locId)).map((l) => l.id));
      listIds = [...new Set(body.listIds as string[])].filter((id) => known.has(id));
    }
  }
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO notification_rules (location_id, division, kind, enabled, time_min, minutes, list_ids, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (location_id, division, kind) DO UPDATE SET enabled = excluded.enabled, time_min = excluded.time_min, minutes = excluded.minutes,
           list_ids = excluded.list_ids, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .bind(locId, division, kind, enabled ? 1 : 0, timeMin, minutes, listIds === null ? null : JSON.stringify(listIds), c.var.user.id, now),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: locId,
      action: 'notifications.rule',
      entityType: 'notification_rule',
      entityId: `${division}:${kind}`,
      before: cur,
      after: { enabled, timeMin, minutes, listIds },
    }),
  ]);
  return c.json({ ok: true });
});

interface CustomInput {
  title: string;
  body: string;
  divisions: string[];
  audience: (typeof AUDIENCES)[number];
  trigger: (typeof TRIGGERS)[number];
  atMs: number | null;
  days: number;
  timeMin: number | null;
  minutes: number | null;
  url: string | null;
  enabled: boolean;
}

function parseCustom(b: Record<string, unknown>, mine: string[]): CustomInput {
  const title = str(b.title, 60);
  const body = str(b.body, 300);
  if (!title) throw badRequest('title_required');
  if (!body) throw badRequest('body_required');
  const divisions = Array.isArray(b.divisions) ? [...new Set(b.divisions.filter((d): d is string => typeof d === 'string'))] : [];
  if (!divisions.length || divisions.some((d) => !DIVISIONS.includes(d))) throw badRequest('divisions_required');
  if (divisions.some((d) => !mine.includes(d))) throw new ApiError(403, 'forbidden');
  const trigger = TRIGGERS.find((t) => t === b.trigger);
  if (!trigger) throw badRequest();
  const audience = trigger === 'once' || trigger === 'weekly' ? (AUDIENCES.find((a) => a === b.audience) ?? 'on_shift') : 'on_shift';
  let atMs: number | null = null;
  let timeMin: number | null = null;
  let minutes: number | null = null;
  const days = trigger === 'once' ? 0 : (intIn(b.days, 0, 127) ?? 0);
  if (trigger === 'once') {
    atMs = typeof b.atMs === 'number' && Number.isFinite(b.atMs) ? Math.round(b.atMs) : null;
    if (atMs === null) throw badRequest('time_required');
  } else if (trigger === 'weekly') {
    timeMin = intIn(b.timeMin, 0, 1435);
    if (timeMin === null || timeMin % 5) throw badRequest('time_required');
  } else {
    minutes = intIn(b.minutes, 0, 240);
    if (minutes === null) throw badRequest('invalid_minutes');
  }
  const urlRaw = str(b.url, 120);
  const url = urlRaw && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(urlRaw) ? urlRaw : null;
  return { title, body, divisions, audience, trigger, atMs, days, timeMin, minutes, url, enabled: b.enabled !== false };
}

notificationAdminRoutes.post('/locations/:locId/notifications/custom', async (c) => {
  const locId = c.req.param('locId');
  const { mine } = await guard(c, locId);
  const n = parseCustom(await readJson<Record<string, unknown>>(c.req.raw), mine);
  if (n.trigger === 'once' && n.atMs! < Date.now() - 60_000) throw badRequest('time_past');
  const db = c.env.DB;
  const id = newId('ntf');
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO custom_notifications (id, location_id, title, body, divisions, audience, trigger, at_ms, days, time_min, minutes, url, enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, locId, n.title, n.body, n.divisions.join(','), n.audience, n.trigger, n.atMs, n.days, n.timeMin, n.minutes, n.url, n.enabled ? 1 : 0, c.var.user.id, now, now),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'notifications.custom.create', entityType: 'custom_notification', entityId: id, after: n }),
  ]);
  return c.json({ id }, 201);
});

async function loadCustom(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const row = await c.env.DB.prepare(`SELECT location_id AS locationId, divisions FROM custom_notifications WHERE id = ?`).bind(id).first<{ locationId: string; divisions: string }>();
  if (!row) throw notFound();
  const { mine } = await guard(c, row.locationId);
  const divs = row.divisions.split(',').filter(Boolean);
  if (!divs.some((d) => mine.includes(d))) throw notFound();
  if (!divs.every((d) => mine.includes(d))) throw new ApiError(403, 'forbidden');
  return { ...row, mine };
}

notificationAdminRoutes.put('/notifications/custom/:id', async (c) => {
  const id = c.req.param('id');
  const row = await loadCustom(c, id);
  const n = parseCustom(await readJson<Record<string, unknown>>(c.req.raw), row.mine);
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        `UPDATE custom_notifications SET title = ?, body = ?, divisions = ?, audience = ?, trigger = ?, at_ms = ?, days = ?, time_min = ?, minutes = ?, url = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(n.title, n.body, n.divisions.join(','), n.audience, n.trigger, n.atMs, n.days, n.timeMin, n.minutes, n.url, n.enabled ? 1 : 0, Date.now(), id),
    auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: 'notifications.custom.update', entityType: 'custom_notification', entityId: id, after: n }),
  ]);
  return c.json({ ok: true });
});

notificationAdminRoutes.delete('/notifications/custom/:id', async (c) => {
  const id = c.req.param('id');
  const row = await loadCustom(c, id);
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM custom_notifications WHERE id = ?`).bind(id),
    auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: 'notifications.custom.delete', entityType: 'custom_notification', entityId: id }),
  ]);
  return c.json({ ok: true });
});

/** „Wyślij próbne do mnie”: the text as it will look, to the signed-in person's own devices. */
notificationAdminRoutes.post('/locations/:locId/notifications/test', async (c) => {
  const locId = c.req.param('locId');
  await guard(c, locId);
  const b = await readJson<{ title?: unknown; body?: unknown }>(c.req.raw);
  const title = str(b.title, 60) ?? 'Senator Academy';
  const body = str(b.body, 300) ?? 'Powiadomienie próbne.';
  const r = await notify(c.env, [c.var.user.id], () => ({ title, body, url: '/', tag: `test-${Date.now()}` }));
  return c.json(r);
});
