/**
 * Staff side of the Academy (spec D1–D4, D10): home, program, reading lessons and documents,
 * acknowledgements, library "Regulaminy i SOP", Service Book, search.
 * Every route: signed in + access to the location; content filtered by position.
 */
import { Hono } from 'hono';
import { foldPolish } from '../../shared/text';
import { snippet } from '../../shared/progress';
import type { AppEnv } from '../env';
import { ApiError, badRequest, notFound, readJson } from '../lib/http';
import { ftsQuery } from '../lib/search';
import { locationView } from './admin';
import { locationRules } from '../lib/location';
import { businessDate } from '../../shared/time';
import { loadAccess, requireLocation } from '../auth/access';
import { DOCUMENT_KINDS, MANDATORY_KINDS, isVisibleFor, programFor, progressFor, userPositions, visibleContent, type VisibleItem } from '../lib/learning';

export const learnRoutes = new Hono<AppEnv>();
// Session is enforced in index.ts.

async function locationGuard(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string) {
  const access = await loadAccess(c.env.DB, c.var.user);
  requireLocation(access, locId);
  return access;
}

function docSummary(r: VisibleItem) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    section: r.section,
    requiresAck: Boolean(r.requiresAck) && !r.externalUrl,
    external: Boolean(r.externalUrl),
    hasAttachment: Boolean(r.attachmentKey),
    updatedAt: r.updatedAt,
  };
}

/* ───────── Home ───────── */

learnRoutes.get('/locations/:locId/home', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const user = c.var.user;
  const positions = await userPositions(db, user, locId);
  const [program, docs] = await Promise.all([programFor(db, user, locId), visibleContent(db, locId, positions, [...DOCUMENT_KINDS, 'service_book'])]);
  const docProgress = await progressFor(db, user.id, docs.map((d) => d.id));

  const mandatoryDocs = docs.filter((d) => d.requiresAck && !d.externalUrl && (MANDATORY_KINDS as readonly string[]).includes(d.kind));
  const toConfirm = mandatoryDocs.filter((d) => docProgress.get(d.id)!.status !== 'done').map((d) => ({ ...docSummary(d), status: docProgress.get(d.id)!.status }));

  // Lessons to repeat (program) + documents to re-confirm are both "Do powtórki".
  const programItems = program.modules.flatMap((m) => m.items.map((i) => ({ ...i, moduleId: m.id, locked: m.locked })));
  const review = programItems.filter((i) => i.status === 'review').map((i) => ({ id: i.contentItemId, kind: i.kind, title: i.title }));
  const next = programItems.find((i) => !i.locked && i.status !== 'done' && i.isMandatory) ?? programItems.find((i) => !i.locked && i.status !== 'done') ?? null;
  const updated = [...programItems.filter((i) => i.updated).map((i) => ({ id: i.contentItemId, kind: i.kind, title: i.title })), ...docs.filter((d) => docProgress.get(d.id)!.updated).map((d) => ({ id: d.id, kind: d.kind, title: d.title }))];

  const loc = await db.prepare(`SELECT name FROM locations WHERE id = ?`).bind(locId).first<{ name: string }>();
  return c.json({
    user: { firstName: user.firstName, lastName: user.lastName, role: user.role, positions: positions ?? [] },
    location: { id: locId, name: loc?.name ?? '' },
    program: program.program ? { id: program.program.id, name: program.program.name, percent: program.percent, modules: program.modules.length, modulesComplete: program.modules.filter((m) => m.complete).length } : null,
    next: next ? { id: next.contentItemId, kind: next.kind, title: next.title, status: next.status } : null,
    toConfirm,
    review,
    updated,
  });
});

/** Location details for staff: address, phone, opening hours, note from the owner (D38). */
learnRoutes.get('/locations/:locId/info', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const l = await c.env.DB.prepare(
    `SELECT id, name, slug, address, phone, email, opening_hours_json AS openingHoursJson, staff_note AS staffNote, day_start_hour AS dayStartHour, stale_hours AS staleHours, punch_photo AS punchPhoto, unavail_deadline_dow AS unavailDeadlineDow, unavail_deadline_hour AS unavailDeadlineHour FROM locations WHERE id = ?`,
  )
    .bind(locId)
    .first<Parameters<typeof locationView>[0]>();
  if (!l) throw notFound();
  return c.json({ location: locationView(l) });
});

/* ───────── Program ───────── */

learnRoutes.get('/locations/:locId/program', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  return c.json(await programFor(c.env.DB, c.var.user, locId));
});

/* ───────── Read one item ───────── */

async function loadVisible(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, id: string) {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await db
    .prepare(
      `SELECT ci.id, ci.location_id AS locationId, ci.kind, ci.title, ci.section, ci.requires_ack AS requiresAck, ci.external_url AS externalUrl,
              ci.attachment_key AS attachmentKey, ci.attachment_name AS attachmentName, ci.current_version_id AS currentVersionId,
              ci.sort_order AS sortOrder, ci.updated_at AS updatedAt, ci.status,
              (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions
       FROM content_items ci WHERE ci.id = ?`,
    )
    .bind(id)
    .first<VisibleItem & { status: string }>();
  if (!item || item.status !== 'published' || !item.currentVersionId) throw notFound();
  // Location of the request: the item's own, or for shared content any location the person belongs to.
  const locId = item.locationId ?? [...access.locations.keys()][0];
  if (!locId || !access.locations.has(locId)) throw notFound();
  const positions = await userPositions(db, c.var.user, locId);
  if (!isVisibleFor(item.positions, positions)) throw notFound();
  return { item, locId };
}

learnRoutes.get('/content/:id', async (c) => {
  const db = c.env.DB;
  const { item, locId } = await loadVisible(c, c.req.param('id'));
  const program = await programFor(db, c.var.user, locId);

  // Lessons inside locked modules (and in no open module) cannot be opened yet.
  const places = program.modules.filter((m) => m.items.some((i) => i.contentItemId === item.id));
  if (item.kind === 'lesson' && places.length && places.every((m) => m.locked)) throw new ApiError(403, 'lesson_locked');

  const version = await db
    .prepare(`SELECT id, version_no AS versionNo, title, body_json AS bodyJson, change_level AS changeLevel, change_note AS changeNote, created_at AS createdAt FROM content_versions WHERE id = ?`)
    .bind(item.currentVersionId)
    .first<{ id: string; versionNo: number; title: string; bodyJson: string; changeLevel: string; changeNote: string | null; createdAt: number }>();
  if (!version) throw notFound();
  const progress = (await progressFor(db, c.var.user.id, [item.id])).get(item.id)!;
  const ack = await db
    .prepare(`SELECT acknowledged_at AS at FROM content_acknowledgements WHERE user_id = ? AND version_id = ?`)
    .bind(c.var.user.id, item.currentVersionId)
    .first<{ at: number }>();

  // Next item in the program (same order the program screen shows), for "Dalej".
  const flat = program.modules.filter((m) => !m.locked).flatMap((m) => m.items.map((i) => ({ id: i.contentItemId, title: i.title, kind: i.kind })));
  const idx = flat.findIndex((i) => i.id === item.id);
  const module = places.find((m) => !m.locked) ?? places[0] ?? null;

  return c.json({
    item: {
      id: item.id,
      kind: item.kind,
      title: version.title,
      section: item.section,
      requiresAck: Boolean(item.requiresAck) && !item.externalUrl,
      externalUrl: item.externalUrl,
      attachment: item.attachmentKey ? { src: `/media/${item.attachmentKey}`, name: item.attachmentName } : null,
      version: { id: version.id, versionNo: version.versionNo, changeLevel: version.changeLevel, changeNote: version.changeNote, createdAt: version.createdAt, body: JSON.parse(version.bodyJson) },
      progress,
      acknowledgedAt: ack?.at ?? null,
      module: module ? { id: module.id, title: module.title } : null,
      next: idx >= 0 && flat[idx + 1] ? flat[idx + 1] : null,
    },
  });
});

/**
 * Acknowledge the current version. Lessons: "Przeczytane" at the end of the text.
 * Documents with requiresAck: checkbox after scrolling to the end + "Potwierdzam".
 * Repeating it is harmless (one row per person per version).
 */
learnRoutes.post('/content/:id/ack', async (c) => {
  const db = c.env.DB;
  const { item, locId } = await loadVisible(c, c.req.param('id'));
  if (item.externalUrl) throw badRequest('external_no_ack');
  const body = await readJson<{ versionId?: unknown; scrolledToEnd?: unknown }>(c.req.raw);
  if (body.versionId !== item.currentVersionId) throw new ApiError(409, 'version_changed');
  if (body.scrolledToEnd !== true) throw badRequest('scroll_required');
  if (item.kind === 'lesson') {
    const program = await programFor(db, c.var.user, locId);
    const places = program.modules.filter((m) => m.items.some((i) => i.contentItemId === item.id));
    if (places.length && places.every((m) => m.locked)) throw new ApiError(403, 'lesson_locked');
  }
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO content_acknowledgements (id, user_id, content_item_id, version_id, scrolled_to_end, acknowledged_at) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (user_id, version_id) DO NOTHING`,
    )
    .bind(`ack_${crypto.randomUUID().replace(/-/g, '')}`, c.var.user.id, item.id, item.currentVersionId, now)
    .run();
  const row = await db
    .prepare(`SELECT acknowledged_at AS at FROM content_acknowledgements WHERE user_id = ? AND version_id = ?`)
    .bind(c.var.user.id, item.currentVersionId)
    .first<{ at: number }>();
  return c.json({ acknowledgedAt: row?.at ?? now });
});

/* ───────── Library & Service Book ───────── */

learnRoutes.get('/locations/:locId/library', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const positions = await userPositions(db, c.var.user, locId);
  const docs = await visibleContent(db, locId, positions, DOCUMENT_KINDS);
  const progress = await progressFor(db, c.var.user.id, docs.map((d) => d.id));
  const acks = docs.length
    ? (
        await db
          .prepare(
            `SELECT content_item_id AS itemId, MAX(acknowledged_at) AS at FROM content_acknowledgements WHERE user_id = ? AND content_item_id IN (${docs.map(() => '?').join(', ')}) GROUP BY content_item_id`,
          )
          .bind(c.var.user.id, ...docs.map((d) => d.id))
          .all<{ itemId: string; at: number }>()
      ).results
    : [];
  const ackAt = new Map(acks.map((a) => [a.itemId, a.at]));
  return c.json({
    items: docs.map((d) => ({ ...docSummary(d), status: progress.get(d.id)!.status, updated: progress.get(d.id)!.updated, acknowledgedAt: ackAt.get(d.id) ?? null })),
  });
});

/** All lessons of the person's position(s), with progress; lessons in a locked module show as locked (D39). */
learnRoutes.get('/locations/:locId/lessons', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const positions = await userPositions(db, c.var.user, locId);
  const [items, program] = await Promise.all([visibleContent(db, locId, positions, ['lesson']), programFor(db, c.var.user, locId)]);
  const progress = await progressFor(db, c.var.user.id, items.map((d) => d.id));
  const locked = new Set<string>();
  const open = new Set<string>();
  for (const m of program.modules) for (const i of m.items) (m.locked ? locked : open).add(i.contentItemId);
  return c.json({
    items: items.map((d) => ({
      id: d.id,
      title: d.title,
      section: d.section,
      status: progress.get(d.id)!.status,
      updated: progress.get(d.id)!.updated,
      locked: locked.has(d.id) && !open.has(d.id),
    })),
  });
});

learnRoutes.get('/locations/:locId/service-book', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const positions = await userPositions(db, c.var.user, locId);
  const items = await visibleContent(db, locId, positions, ['service_book']);
  const progress = await progressFor(db, c.var.user.id, items.map((d) => d.id));
  return c.json({ items: items.map((d) => ({ id: d.id, title: d.title, section: d.section, status: progress.get(d.id)!.status, updated: progress.get(d.id)!.updated })) });
});

/* ───────── Search ───────── */

learnRoutes.get('/locations/:locId/search', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const raw = (c.req.query('q') ?? '').slice(0, 100);
  const q = ftsQuery(raw);
  if (!q) return c.json({ query: raw, results: [] });
  const terms = foldPolish(raw).split(/\s+/).filter(Boolean);
  const { results: hits } = await db
    .prepare(
      `SELECT entity_type AS type, entity_id AS id, bm25(search_index, 0.0, 0.0, 0.0, 5.0, 1.0) AS rank FROM search_index
       WHERE search_index MATCH ? AND (location_id = ? OR location_id = '') ORDER BY rank LIMIT 60`,
    )
    .bind(q, locId)
    .all<{ type: 'content' | 'menu_item'; id: string; rank: number }>();

  const positions = await userPositions(db, c.var.user, locId);
  const contentIds = hits.filter((h) => h.type === 'content').map((h) => h.id);
  const menuIds = hits.filter((h) => h.type === 'menu_item').map((h) => h.id);
  const visible = contentIds.length ? (await visibleContent(db, locId, positions)).filter((v) => contentIds.includes(v.id)) : [];
  const texts = new Map<string, string>();
  if (visible.length) {
    const { results } = await db
      .prepare(`SELECT id, body_text AS text FROM content_versions WHERE id IN (${visible.map(() => '?').join(', ')})`)
      .bind(...visible.map((v) => v.currentVersionId))
      .all<{ id: string; text: string }>();
    for (const r of results) texts.set(r.id, r.text);
  }
  const menu = menuIds.length
    ? (
        await db
          .prepare(
            `SELECT mi.id, mi.name_guest AS name, mc.section, coalesce(mi.how_to_sell, mi.description, '') || ' ' || coalesce(mi.good_to_know, '') || ' ' || coalesce(mi.key_ingredient, '') || ' ' || coalesce(mi.ingredients_json, '') AS text
             FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
             WHERE mi.location_id = ? AND mi.is_active = 1 AND mi.id IN (${menuIds.map(() => '?').join(', ')})`,
          )
          .bind(locId, ...menuIds)
          .all<{ id: string; name: string; section: string; text: string }>()
      ).results
    : [];
  const byId = new Map(visible.map((v) => [v.id, v]));
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const results = hits
    .map((h) => {
      if (h.type === 'content') {
        const v = byId.get(h.id);
        if (!v) return null;
        return { type: 'content' as const, id: v.id, kind: v.kind, title: v.title, section: v.section, snippet: snippet(texts.get(v.currentVersionId) ?? '', terms, foldPolish) };
      }
      const m = menuById.get(h.id);
      if (!m) return null;
      const clean = m.text.replace(/[[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
      return { type: 'menu_item' as const, id: m.id, kind: m.section, title: m.name, section: null, snippet: snippet(clean, terms, foldPolish) };
    })
    .filter(Boolean)
    .slice(0, 40);
  return c.json({ query: raw, results });
});

/**
 * "Moje godziny" (D41): the person's own shifts and punches of a month — hours only, never money.
 * Months are business months (a shift belongs to the business date it started on).
 */
learnRoutes.get('/locations/:locId/my-time', async (c) => {
  const locId = c.req.param('locId');
  await locationGuard(c, locId);
  const db = c.env.DB;
  const user = c.var.user;
  const rules = await locationRules(db, locId);
  const now = Date.now();
  const current = businessDate(now, rules.dayStartHour).slice(0, 7);
  const q = c.req.query('month');
  const month = q && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) && q <= current ? q : current;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const prev = shift(-1);
  const next = shift(1);
  const from = `${month}-01`;
  const to = `${next}-01`;
  const minutesOf = (e: { clockInAt: number; clockOutAt: number | null }) => {
    if (e.clockOutAt) return Math.round((e.clockOutAt - e.clockInAt) / 60000);
    return now - e.clockInAt <= rules.staleHours * 3600_000 ? Math.round((now - e.clockInAt) / 60000) : 0;
  };
  const { results } = await db
    .prepare(
      `SELECT business_date AS date, clock_in_at AS clockInAt, clock_out_at AS clockOutAt, in_source AS inSource, out_source AS outSource, edited_at AS editedAt
       FROM time_entries WHERE user_id = ? AND location_id = ? AND business_date >= ? AND business_date < ? ORDER BY clock_in_at DESC`,
    )
    .bind(user.id, locId, `${prev}-01`, to)
    .all<{ date: string; clockInAt: number; clockOutAt: number | null; inSource: string; outSource: string | null; editedAt: number | null }>();
  const inMonth = results.filter((e) => e.date >= from);
  const prevMinutes = results.filter((e) => e.date < from).reduce((a, e) => a + minutesOf(e), 0);
  const punches = await db
    .prepare(
      `SELECT p.at, p.outcome, p.offline FROM time_punches p JOIN terminals t ON t.id = p.terminal_id
       WHERE p.user_id = ? AND t.location_id = ? AND p.at >= ? AND p.at < ? ORDER BY p.at DESC LIMIT 300`,
    )
    .bind(user.id, locId, Date.parse(`${from}T00:00:00Z`) - 86400_000, Date.parse(`${to}T00:00:00Z`) + 86400_000)
    .all<{ at: number; outcome: string; offline: number }>();
  return c.json({
    month,
    prevMonth: prev,
    nextMonth: next <= current ? next : null,
    totalMinutes: inMonth.reduce((a, e) => a + minutesOf(e), 0),
    shifts: inMonth.filter((e) => minutesOf(e) > 0 || e.clockOutAt).length,
    prevTotalMinutes: prevMinutes,
    entries: inMonth.map((e) => ({
      date: e.date,
      clockInAt: e.clockInAt,
      clockOutAt: e.clockOutAt,
      minutes: minutesOf(e),
      open: !e.clockOutAt && now - e.clockInAt <= rules.staleHours * 3600_000,
      missingExit: !e.clockOutAt && now - e.clockInAt > rules.staleHours * 3600_000,
      byManager: e.inSource === 'manual' || e.outSource === 'manual' || Boolean(e.editedAt),
    })),
    punches: punches.results
      .filter((p) => businessDate(p.at, rules.dayStartHour).slice(0, 7) === month)
      .map((p) => ({ at: p.at, outcome: p.outcome, offline: Boolean(p.offline) })),
  });
});
