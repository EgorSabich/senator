/**
 * Content admin: lessons, Service Book, regulations, SOP, job descriptions, checklists (spec D9, D10, E).
 * Editing happens in a draft; publishing creates an immutable version with a change level.
 * Shared content (location_id NULL) is edited only by the owner.
 */
import { Hono } from 'hono';
import { CHANGE_LEVELS, CONTENT_KINDS, POSITIONS, type ChangeLevel } from '../../shared/constants';
import { docToText, emptyDoc, sanitizeDoc } from '../../shared/richtext';
import { foldPolish } from '../../shared/text';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { indexStatements, unindexStatement } from '../lib/search';
import { loadAccess, requireOwner, requirePermission, type Access } from '../auth/access';
import { storeUpload } from './media';

export const contentAdminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

interface ItemRow {
  id: string;
  locationId: string | null;
  kind: string;
  title: string;
  slug: string;
  section: string | null;
  status: 'draft' | 'published' | 'archived';
  currentVersionId: string | null;
  requiresAck: number;
  externalUrl: string | null;
  attachmentKey: string | null;
  attachmentName: string | null;
  draftTitle: string | null;
  draftBodyJson: string | null;
  draftUpdatedAt: number | null;
  sortOrder: number;
  updatedAt: number;
}

const ITEM_COLUMNS = `id, location_id AS locationId, kind, title, slug, section, status, current_version_id AS currentVersionId,
  requires_ack AS requiresAck, external_url AS externalUrl, attachment_key AS attachmentKey, attachment_name AS attachmentName,
  draft_title AS draftTitle, draft_body_json AS draftBodyJson, draft_updated_at AS draftUpdatedAt, sort_order AS sortOrder,
  updated_at AS updatedAt`;

function requireEdit(access: Access, locationId: string | null): void {
  if (locationId === null) requireOwner(access);
  else requirePermission(access, locationId, 'content.edit');
}

async function loadItem(db: D1Database, access: Access, id: string): Promise<ItemRow> {
  const item = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM content_items WHERE id = ?`).bind(id).first<ItemRow>();
  if (!item) throw notFound();
  if (item.locationId !== null && !access.locations.has(item.locationId)) throw notFound();
  requireEdit(access, item.locationId);
  return item;
}

async function uniqueSlug(db: D1Database, locationId: string | null, title: string): Promise<string> {
  const base = foldPolish(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'material';
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const hit = await db
      .prepare(`SELECT 1 FROM content_items WHERE slug = ? AND ${locationId === null ? 'location_id IS NULL' : 'location_id = ?'}`)
      .bind(...(locationId === null ? [slug] : [slug, locationId]))
      .first();
    if (!hit) return slug;
  }
  throw new ApiError(409, 'slug_taken');
}

function parsePositions(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((p) => typeof p === 'string' && (POSITIONS as readonly string[]).includes(p))) {
    throw badRequest('positions_invalid');
  }
  return [...new Set(v as string[])];
}

function parseExternalUrl(v: unknown): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 2000 || !/^https:\/\//i.test(v.trim())) throw badRequest('external_url_invalid');
  return v.trim();
}

/* ───────── List & create ───────── */

contentAdminRoutes.get('/locations/:locId/content', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const kind = c.req.query('kind');
  if (kind && !(CONTENT_KINDS as readonly string[]).includes(kind)) throw badRequest('kind_invalid');

  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.location_id AS locationId, ci.kind, ci.title, ci.section, ci.status, ci.requires_ack AS requiresAck,
              ci.draft_title AS draftTitle, ci.draft_updated_at AS draftUpdatedAt, ci.updated_at AS updatedAt,
              ci.external_url AS externalUrl, ci.attachment_name AS attachmentName,
              (SELECT version_no FROM content_versions v WHERE v.id = ci.current_version_id) AS versionNo,
              (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions
       FROM content_items ci
       WHERE (ci.location_id = ? OR ci.location_id IS NULL) ${kind ? 'AND ci.kind = ?' : ''}
       ORDER BY ci.kind, ci.section, ci.sort_order, ci.title`,
    )
    .bind(...(kind ? [locId, kind] : [locId]))
    .all<Record<string, unknown>>();

  return c.json({
    items: results.map((r) => ({
      ...r,
      requiresAck: Boolean(r.requiresAck),
      shared: r.locationId === null,
      editable: r.locationId !== null || access.role === 'owner',
      hasDraft: r.draftUpdatedAt !== null,
      positions: r.positions ? String(r.positions).split(',') : [],
    })),
  });
});

contentAdminRoutes.post('/locations/:locId/content', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const body = await readJson<{ kind?: unknown; title?: unknown; section?: unknown; shared?: unknown }>(c.req.raw);
  const shared = body.shared === true;
  if (shared) requireOwner(access);
  else requirePermission(access, locId, 'content.edit');
  const kind = typeof body.kind === 'string' && (CONTENT_KINDS as readonly string[]).includes(body.kind) ? body.kind : null;
  const title = str(body.title, 160);
  if (!kind) throw badRequest('kind_invalid');
  if (!title) throw badRequest('title_required');
  const section = str(body.section, 120);
  const locationId = shared ? null : locId;
  const id = newId('ci');
  const now = Date.now();
  const isDocument = kind !== 'lesson' && kind !== 'service_book';
  await db.batch([
    db
      .prepare(
        `INSERT INTO content_items (id, location_id, kind, title, slug, section, status, requires_ack, draft_title, draft_body_json,
           draft_updated_at, draft_updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, locationId, kind, title, await uniqueSlug(db, locationId, title), section, isDocument ? 1 : 0, title, JSON.stringify(emptyDoc()), now, c.var.user.id, now, now),
    auditStatement(db, { actorId: c.var.user.id, locationId, action: 'content.create', entityType: 'content', entityId: id, after: { kind, title, shared } }),
  ]);
  return c.json({ id }, 201);
});

/* ───────── Read one ───────── */

contentAdminRoutes.get('/content/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const { results: versions } = await db
    .prepare(
      `SELECT v.id, v.version_no AS versionNo, v.title, v.change_level AS changeLevel, v.change_note AS changeNote, v.created_at AS createdAt,
              u.first_name AS authorFirstName, u.last_name AS authorLastName
       FROM content_versions v LEFT JOIN users u ON u.id = v.author_id
       WHERE v.content_item_id = ? ORDER BY v.version_no DESC`,
    )
    .bind(item.id)
    .all();
  const current = item.currentVersionId
    ? await db
        .prepare(`SELECT id, version_no AS versionNo, title, body_json AS bodyJson FROM content_versions WHERE id = ?`)
        .bind(item.currentVersionId)
        .first<{ id: string; versionNo: number; title: string; bodyJson: string }>()
    : null;
  const { results: positions } = await db
    .prepare(`SELECT position FROM content_item_positions WHERE content_item_id = ?`)
    .bind(item.id)
    .all<{ position: string }>();
  const ackCount = await db
    .prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM content_acknowledgements WHERE version_id = ?`)
    .bind(item.currentVersionId ?? '')
    .first<{ n: number }>();

  return c.json({
    item: {
      id: item.id,
      locationId: item.locationId,
      shared: item.locationId === null,
      kind: item.kind,
      title: item.title,
      section: item.section,
      status: item.status,
      requiresAck: Boolean(item.requiresAck),
      externalUrl: item.externalUrl,
      attachment: item.attachmentKey ? { src: `/media/${item.attachmentKey}`, name: item.attachmentName } : null,
      positions: positions.map((p) => p.position),
      sortOrder: item.sortOrder,
      currentAcknowledgements: ackCount?.n ?? 0,
    },
    draft: item.draftBodyJson
      ? { title: item.draftTitle ?? item.title, body: JSON.parse(item.draftBodyJson), updatedAt: item.draftUpdatedAt }
      : null,
    current: current ? { id: current.id, versionNo: current.versionNo, title: current.title, body: JSON.parse(current.bodyJson) } : null,
    versions,
  });
});

contentAdminRoutes.get('/content/:id/versions/:versionId', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const v = await db
    .prepare(
      `SELECT id, version_no AS versionNo, title, body_json AS bodyJson, body_text AS bodyText, change_level AS changeLevel,
              change_note AS changeNote, created_at AS createdAt
       FROM content_versions WHERE id = ? AND content_item_id = ?`,
    )
    .bind(c.req.param('versionId'), item.id)
    .first<Record<string, unknown> & { bodyJson: string }>();
  if (!v) throw notFound();
  const { bodyJson, ...rest } = v;
  return c.json({ version: { ...rest, body: JSON.parse(bodyJson) } });
});

/* ───────── Edit draft & settings ───────── */

contentAdminRoutes.put('/content/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const body = await readJson<{
    title?: unknown;
    body?: unknown;
    section?: unknown;
    requiresAck?: unknown;
    positions?: unknown;
    externalUrl?: unknown;
    sortOrder?: unknown;
  }>(c.req.raw);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const settingsChange: Record<string, unknown> = {};

  if (body.title !== undefined || body.body !== undefined) {
    const title = body.title === undefined ? item.draftTitle ?? item.title : str(body.title, 160);
    if (!title) throw badRequest('title_required');
    let bodyJson = item.draftBodyJson;
    if (body.body !== undefined) {
      const doc = sanitizeDoc(body.body);
      if (!doc) throw badRequest('body_invalid');
      bodyJson = JSON.stringify(doc);
      if (bodyJson.length > 600_000) throw badRequest('body_too_large');
    }
    if (bodyJson === null) {
      const cur = await db.prepare(`SELECT body_json AS b FROM content_versions WHERE id = ?`).bind(item.currentVersionId ?? '').first<{ b: string }>();
      bodyJson = cur?.b ?? JSON.stringify(emptyDoc());
    }
    statements.push(
      db
        .prepare(`UPDATE content_items SET draft_title = ?, draft_body_json = ?, draft_updated_at = ?, draft_updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(title, bodyJson, now, c.var.user.id, now, item.id),
    );
  }
  if (body.section !== undefined) {
    const section = body.section === null || body.section === '' ? null : str(body.section, 120);
    statements.push(db.prepare(`UPDATE content_items SET section = ?, updated_at = ? WHERE id = ?`).bind(section, now, item.id));
    settingsChange.section = section;
  }
  if (body.requiresAck !== undefined) {
    if (typeof body.requiresAck !== 'boolean') throw badRequest('requires_ack_invalid');
    statements.push(db.prepare(`UPDATE content_items SET requires_ack = ?, updated_at = ? WHERE id = ?`).bind(body.requiresAck ? 1 : 0, now, item.id));
    settingsChange.requiresAck = body.requiresAck;
  }
  if (body.externalUrl !== undefined) {
    const url = parseExternalUrl(body.externalUrl);
    statements.push(db.prepare(`UPDATE content_items SET external_url = ?, updated_at = ? WHERE id = ?`).bind(url, now, item.id));
    settingsChange.externalUrl = url;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) throw badRequest('sort_order_invalid');
    statements.push(db.prepare(`UPDATE content_items SET sort_order = ? WHERE id = ?`).bind(body.sortOrder, item.id));
  }
  if (body.positions !== undefined) {
    const positions = parsePositions(body.positions);
    statements.push(db.prepare(`DELETE FROM content_item_positions WHERE content_item_id = ?`).bind(item.id));
    for (const p of positions) {
      statements.push(db.prepare(`INSERT INTO content_item_positions (content_item_id, position) VALUES (?, ?)`).bind(item.id, p));
    }
    settingsChange.positions = positions;
  }
  if (!statements.length) throw badRequest('nothing_to_update');
  if (Object.keys(settingsChange).length) {
    statements.push(
      auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.settings', entityType: 'content', entityId: item.id, after: settingsChange }),
    );
  }
  await db.batch(statements);
  return c.json({ ok: true, savedAt: now });
});

contentAdminRoutes.post('/content/:id/discard-draft', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  if (!item.currentVersionId) throw new ApiError(409, 'never_published');
  await db
    .prepare(`UPDATE content_items SET draft_title = NULL, draft_body_json = NULL, draft_updated_at = NULL, draft_updated_by = NULL WHERE id = ?`)
    .bind(item.id)
    .run();
  return c.json({ ok: true });
});

/* ───────── Publish ───────── */

contentAdminRoutes.post('/content/:id/publish', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const body = await readJson<{ changeLevel?: unknown; changeNote?: unknown }>(c.req.raw);
  if (!item.draftBodyJson) throw new ApiError(409, 'no_draft');

  const first = !item.currentVersionId;
  let level: ChangeLevel;
  if (first) level = 'significant';
  else if (typeof body.changeLevel === 'string' && (CHANGE_LEVELS as readonly string[]).includes(body.changeLevel)) level = body.changeLevel as ChangeLevel;
  else throw badRequest('change_level_required');
  const note = body.changeNote === undefined || body.changeNote === null || body.changeNote === '' ? null : str(body.changeNote, 500);

  const title = item.draftTitle ?? item.title;
  if (!first) {
    const cur = await db
      .prepare(`SELECT title, body_json AS b FROM content_versions WHERE id = ?`)
      .bind(item.currentVersionId)
      .first<{ title: string; b: string }>();
    if (cur && cur.b === item.draftBodyJson && cur.title === title) throw new ApiError(409, 'no_changes');
  }
  const doc = JSON.parse(item.draftBodyJson);
  const text = docToText(doc);
  const last = await db
    .prepare(`SELECT COALESCE(MAX(version_no), 0) AS n FROM content_versions WHERE content_item_id = ?`)
    .bind(item.id)
    .first<{ n: number }>();
  const versionNo = (last?.n ?? 0) + 1;
  const versionId = newId('cv');
  const now = Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO content_versions (id, content_item_id, version_no, title, body_json, body_text, change_level, change_note, author_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(versionId, item.id, versionNo, title, item.draftBodyJson, text, level, note, c.var.user.id, now),
    db
      .prepare(
        `UPDATE content_items SET current_version_id = ?, title = ?, status = 'published', draft_title = NULL, draft_body_json = NULL,
           draft_updated_at = NULL, draft_updated_by = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(versionId, title, now, item.id),
    ...indexStatements(db, { type: 'content', id: item.id, locationId: item.locationId, title, body: text }),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: item.locationId,
      action: 'content.publish',
      entityType: 'content',
      entityId: item.id,
      after: { versionNo, changeLevel: level, changeNote: note, title },
    }),
  ]);
  return c.json({ versionId, versionNo, changeLevel: level });
});

/* ───────── Archive ───────── */

contentAdminRoutes.post('/content/:id/archive', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  await db.batch([
    db.prepare(`UPDATE content_items SET status = 'archived', updated_at = ? WHERE id = ?`).bind(Date.now(), item.id),
    unindexStatement(db, 'content', item.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.archive', entityType: 'content', entityId: item.id, before: { status: item.status } }),
  ]);
  return c.json({ ok: true });
});

contentAdminRoutes.post('/content/:id/restore', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  if (item.status !== 'archived') throw new ApiError(409, 'not_archived');
  const status = item.currentVersionId ? 'published' : 'draft';
  const statements = [
    db.prepare(`UPDATE content_items SET status = ?, updated_at = ? WHERE id = ?`).bind(status, Date.now(), item.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.restore', entityType: 'content', entityId: item.id, after: { status } }),
  ];
  if (item.currentVersionId) {
    const v = await db.prepare(`SELECT title, body_text AS t FROM content_versions WHERE id = ?`).bind(item.currentVersionId).first<{ title: string; t: string }>();
    if (v) statements.push(...indexStatements(db, { type: 'content', id: item.id, locationId: item.locationId, title: v.title, body: v.t }));
  }
  await db.batch(statements);
  return c.json({ ok: true, status });
});

/* ───────── Attachment (original PDF / DOCX) ───────── */

contentAdminRoutes.post('/content/:id/attachment', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const form = await c.req.parseBody();
  if (!(form.file instanceof File)) throw badRequest('file_required');
  const stored = await storeUpload(c.env, form.file, { kind: 'files', locationId: item.locationId, userId: c.var.user.id });
  await db.batch([
    db.prepare(`UPDATE content_items SET attachment_key = ?, attachment_name = ?, updated_at = ? WHERE id = ?`).bind(stored.key, stored.name, Date.now(), item.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.attachment', entityType: 'content', entityId: item.id, after: { name: stored.name, size: stored.size } }),
  ]);
  return c.json({ attachment: { src: stored.src, name: stored.name } }, 201);
});

contentAdminRoutes.delete('/content/:id/attachment', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  await db.batch([
    db.prepare(`UPDATE content_items SET attachment_key = NULL, attachment_name = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), item.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.attachment_remove', entityType: 'content', entityId: item.id, before: { name: item.attachmentName } }),
  ]);
  return c.json({ ok: true });
});
