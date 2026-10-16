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
import { allowedDivisions, loadAccess, requireOwner, requirePermission, requirePositionsInScope, type Access } from '../auth/access';
import { storeUpload } from './media';
import { deleteKeys } from '../jobs/punchPhotos';
import { DEFAULT_TAB } from '../lib/learning';
import { confirmMatches, purgeContentStatements } from '../lib/purge';
import { CONTENT_BUNDLE_FORMAT, CONTENT_IMPORT_CHUNK } from '../../shared/contentBundle';

export const contentAdminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

interface ItemRow {
  checklistMode: string;
  checklistPhotoKeys: string | null;
  tabId: string | null;
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
  updated_at AS updatedAt, checklist_mode AS checklistMode, checklist_photo_keys AS checklistPhotoKeys, tab_id AS tabId`;

function requireEdit(access: Access, locationId: string | null): void {
  if (locationId === null) requireOwner(access);
  else requirePermission(access, locationId, 'content.edit');
}

/**
 * D44: with divisions, a material can be read when it is for everyone or for one of them,
 * and changed only when all its positions are inside them (a chef edits kitchen materials, not shared ones).
 */
function scopeVerdict(access: Access, locationId: string | null, positions: string[]): 'edit' | 'read' | 'none' {
  if (locationId === null) return access.role === 'owner' ? 'edit' : 'read';
  const scope = allowedDivisions(access, locationId);
  if (!scope) return 'edit';
  if (positions.length && positions.every((p) => scope.has(p))) return 'edit';
  if (!positions.length || positions.some((p) => scope.has(p))) return 'read';
  return 'none';
}

async function loadItem(db: D1Database, access: Access, id: string, mode: 'edit' | 'read' = 'edit'): Promise<ItemRow & { editable: boolean }> {
  const item = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM content_items WHERE id = ?`).bind(id).first<ItemRow>();
  if (!item) throw notFound();
  if (item.locationId !== null && !access.locations.has(item.locationId)) throw notFound();
  if (mode === 'edit') requireEdit(access, item.locationId);
  else if (item.locationId !== null) requirePermission(access, item.locationId, 'content.edit');
  const { results } = await db.prepare(`SELECT position FROM content_item_positions WHERE content_item_id = ?`).bind(item.id).all<{ position: string }>();
  const verdict = scopeVerdict(access, item.locationId, results.map((r) => r.position));
  if (verdict === 'none') throw notFound();
  if (mode === 'edit' && verdict !== 'edit') throw new ApiError(403, 'outside_divisions');
  return { ...item, editable: verdict === 'edit' };
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

/* ───────── Wiedza tabs (2026-10-17) ───────── */

interface TabRow {
  id: string;
  locationId: string | null;
  title: string;
  positions: string | null;
  sortOrder: number;
}

/** A tab a page can be put in: shared tabs for any page, a location's tabs only for that location's pages. */
async function tabForItem(db: D1Database, access: Access, tabId: unknown, itemLocationId: string | null): Promise<TabRow> {
  if (typeof tabId !== 'string') throw badRequest('invalid_input');
  const tab = await db
    .prepare(`SELECT id, location_id AS locationId, title, positions, sort_order AS sortOrder FROM knowledge_tabs WHERE id = ?`)
    .bind(tabId)
    .first<TabRow>();
  if (!tab || (tab.locationId !== null && tab.locationId !== itemLocationId)) throw badRequest('tab_invalid');
  if (tab.locationId !== null && !access.locations.has(tab.locationId)) throw badRequest('tab_invalid');
  return tab;
}

/** A leader edits a tab when every position it is for is inside their divisions (owner: also shared tabs). */
function canEditTab(access: Access, tab: TabRow): boolean {
  if (tab.locationId === null) return access.role === 'owner';
  if (!access.locations.get(tab.locationId)?.has('content.edit') && access.role !== 'owner') return false;
  return scopeVerdict(access, tab.locationId, tab.positions ? tab.positions.split(',') : []) === 'edit';
}

function parseTabInput(body: { title?: unknown; positions?: unknown }) {
  const title = str(body.title, 60);
  if (!title) throw badRequest('title_required');
  const positions = parsePositions(body.positions ?? []);
  return { title, positions };
}

contentAdminRoutes.get('/locations/:locId/knowledge-tabs', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const { results } = await db
    .prepare(
      `SELECT kt.id, kt.location_id AS locationId, kt.title, kt.positions, kt.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM content_items ci WHERE ci.kind = 'service_book' AND ci.status != 'archived' AND COALESCE(ci.tab_id, '${DEFAULT_TAB}') = kt.id
                 AND (ci.location_id = ?1 OR ci.location_id IS NULL)) AS pages
       FROM knowledge_tabs kt WHERE kt.location_id = ?1 OR kt.location_id IS NULL ORDER BY kt.sort_order, kt.title`,
    )
    .bind(locId)
    .all<TabRow & { pages: number }>();
  return c.json({
    tabs: results
      .filter((t) => scopeVerdict(access, t.locationId ?? locId, t.positions ? t.positions.split(',') : []) !== 'none')
      .map((t) => ({ ...t, positions: t.positions ? t.positions.split(',') : [], shared: t.locationId === null, builtIn: t.id === DEFAULT_TAB, editable: canEditTab(access, t) })),
  });
});

contentAdminRoutes.post('/locations/:locId/knowledge-tabs', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const { title, positions } = parseTabInput(await readJson(c.req.raw));
  requirePositionsInScope(access, locId, positions);
  const id = newId('kt');
  const now = Date.now();
  const max = await db.prepare(`SELECT MAX(sort_order) AS m FROM knowledge_tabs WHERE location_id = ? OR location_id IS NULL`).bind(locId).first<{ m: number | null }>();
  await db.batch([
    db
      .prepare(`INSERT INTO knowledge_tabs (id, location_id, title, positions, sort_order, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, locId, title, positions.length ? positions.join(',') : null, (max?.m ?? 0) + 1, c.var.user.id, now, now),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'knowledge_tab.create', entityType: 'knowledge_tab', entityId: id, after: { title, positions } }),
  ]);
  return c.json({ id }, 201);
});

async function loadTab(db: D1Database, access: Access, id: string): Promise<TabRow> {
  const tab = await db
    .prepare(`SELECT id, location_id AS locationId, title, positions, sort_order AS sortOrder FROM knowledge_tabs WHERE id = ?`)
    .bind(id)
    .first<TabRow>();
  if (!tab || (tab.locationId !== null && !access.locations.has(tab.locationId))) throw notFound();
  if (!canEditTab(access, tab)) throw new ApiError(403, tab.locationId === null ? 'forbidden' : 'outside_divisions');
  return tab;
}

contentAdminRoutes.put('/knowledge-tabs/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const tab = await loadTab(db, access, c.req.param('id'));
  const body = await readJson<{ title?: unknown; positions?: unknown; sortOrder?: unknown }>(c.req.raw);
  const { title, positions } = parseTabInput({ title: body.title ?? tab.title, positions: body.positions ?? (tab.positions ? tab.positions.split(',') : []) });
  requirePositionsInScope(access, tab.locationId, positions);
  const sortOrder = Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : tab.sortOrder;
  await db.batch([
    db
      .prepare(`UPDATE knowledge_tabs SET title = ?, positions = ?, sort_order = ?, updated_at = ? WHERE id = ?`)
      .bind(title, positions.length ? positions.join(',') : null, sortOrder, Date.now(), tab.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: tab.locationId, action: 'knowledge_tab.update', entityType: 'knowledge_tab', entityId: tab.id, before: { title: tab.title, positions: tab.positions }, after: { title, positions } }),
  ]);
  return c.json({ ok: true });
});

/** Only an empty tab goes (pages first move elsewhere or are deleted); the built-in Service Book stays. */
contentAdminRoutes.delete('/knowledge-tabs/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const tab = await loadTab(db, access, c.req.param('id'));
  if (tab.id === DEFAULT_TAB) throw new ApiError(409, 'tab_builtin');
  const used = await db.prepare(`SELECT COUNT(*) AS n FROM content_items WHERE tab_id = ?`).bind(tab.id).first<{ n: number }>();
  if (used && used.n > 0) throw new ApiError(409, 'tab_not_empty', { pages: used.n });
  await db.batch([
    db.prepare(`DELETE FROM knowledge_tabs WHERE id = ?`).bind(tab.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: tab.locationId, action: 'knowledge_tab.delete', entityType: 'knowledge_tab', entityId: tab.id, before: { title: tab.title } }),
  ]);
  return c.json({ ok: true });
});

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
              ci.external_url AS externalUrl, ci.attachment_name AS attachmentName, ci.import_key IS NOT NULL AS imported,
              (SELECT version_no FROM content_versions v WHERE v.id = ci.current_version_id) AS versionNo,
              (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions,
              CASE WHEN ci.kind = 'service_book' THEN COALESCE(ci.tab_id, '${DEFAULT_TAB}') END AS tabId
       FROM content_items ci
       WHERE (ci.location_id = ? OR ci.location_id IS NULL) ${kind ? 'AND ci.kind = ?' : ''}
       ORDER BY ci.kind, ci.section, ci.sort_order, ci.title`,
    )
    .bind(...(kind ? [locId, kind] : [locId]))
    .all<Record<string, unknown>>();

  const items = results
    .map((r) => {
      const positions = r.positions ? String(r.positions).split(',') : [];
      const verdict = scopeVerdict(access, (r.locationId as string | null) ?? null, positions);
      return {
        ...r,
        requiresAck: Boolean(r.requiresAck),
        imported: Boolean(r.imported),
        shared: r.locationId === null,
        editable: verdict === 'edit',
        hasDraft: r.draftUpdatedAt !== null,
        positions,
        verdict,
      };
    })
    .filter((r) => r.verdict !== 'none')
    .map(({ verdict: _v, ...r }) => r);
  const scope = allowedDivisions(access, locId);
  return c.json({ items, divisions: scope ? [...scope] : null });
});

contentAdminRoutes.post('/locations/:locId/content', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const body = await readJson<{ kind?: unknown; title?: unknown; section?: unknown; shared?: unknown; tabId?: unknown }>(c.req.raw);
  const shared = body.shared === true;
  if (shared) requireOwner(access);
  else requirePermission(access, locId, 'content.edit');
  const kind = typeof body.kind === 'string' && (CONTENT_KINDS as readonly string[]).includes(body.kind) ? body.kind : null;
  const title = str(body.title, 160);
  if (!kind) throw badRequest('kind_invalid');
  if (!title) throw badRequest('title_required');
  const section = str(body.section, 120);
  const locationId = shared ? null : locId;
  const tab = kind === 'service_book' && body.tabId !== undefined && body.tabId !== null ? await tabForItem(db, access, body.tabId, locationId) : null;
  const id = newId('ci');
  const now = Date.now();
  const isDocument = kind !== 'lesson'; // Service Book is mandatory to read too (D38)
  await db.batch([
    db
      .prepare(
        `INSERT INTO content_items (id, location_id, kind, title, slug, section, status, requires_ack, draft_title, draft_body_json,
           draft_updated_at, draft_updated_by, created_at, updated_at, tab_id)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, locationId, kind, title, await uniqueSlug(db, locationId, title), section, isDocument ? 1 : 0, title, JSON.stringify(emptyDoc()), now, c.var.user.id, now, now, tab && tab.id !== DEFAULT_TAB ? tab.id : null),
    auditStatement(db, { actorId: c.var.user.id, locationId, action: 'content.create', entityType: 'content', entityId: id, after: { kind, title, shared } }),
    // D44: a chef's new material is for the kitchen from the start
    ...[...(locationId ? (allowedDivisions(access, locationId) ?? []) : [])].map((p) =>
      db.prepare(`INSERT INTO content_item_positions (content_item_id, position) VALUES (?, ?)`).bind(id, p),
    ),
  ]);
  return c.json({ id }, 201);
});

/* ───────── Read one ───────── */

contentAdminRoutes.get('/content/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'), 'read');
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
      editable: item.editable,
      checklistMode: item.kind === 'checklist' ? item.checklistMode : null,
      checklistPhotoKeys: item.kind === 'checklist' && item.checklistPhotoKeys ? (JSON.parse(item.checklistPhotoKeys) as string[]) : [],
      tabId: item.kind === 'service_book' ? (item.tabId ?? DEFAULT_TAB) : null,
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
  const item = await loadItem(db, access, c.req.param('id'), 'read');
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
    checklistMode?: unknown;
    checklistPhotoKeys?: unknown;
    tabId?: unknown;
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
  if (body.checklistMode !== undefined) {
    if (item.kind !== 'checklist' || (body.checklistMode !== 'individual' && body.checklistMode !== 'shared')) throw badRequest('checklist_mode_invalid');
    statements.push(db.prepare(`UPDATE content_items SET checklist_mode = ?, updated_at = ? WHERE id = ?`).bind(body.checklistMode, now, item.id));
    settingsChange.checklistMode = body.checklistMode;
  }
  if (body.tabId !== undefined) {
    if (item.kind !== 'service_book') throw badRequest('invalid_input');
    const tab = await tabForItem(db, access, body.tabId, item.locationId);
    statements.push(db.prepare(`UPDATE content_items SET tab_id = ?, updated_at = ? WHERE id = ?`).bind(tab.id === DEFAULT_TAB ? null : tab.id, now, item.id));
    settingsChange.tab = tab.title;
  }
  if (body.checklistPhotoKeys !== undefined) {
    const keys = body.checklistPhotoKeys;
    if (item.kind !== 'checklist' || !Array.isArray(keys) || keys.length > 300 || !keys.every((k) => typeof k === 'string' && /^[0-9a-f]{16}$/.test(k)))
      throw badRequest('invalid_input');
    const unique = [...new Set(keys as string[])];
    statements.push(db.prepare(`UPDATE content_items SET checklist_photo_keys = ?, updated_at = ? WHERE id = ?`).bind(unique.length ? JSON.stringify(unique) : null, now, item.id));
    settingsChange.checklistPhotoKeys = unique.length;
  }
  if (body.positions !== undefined) {
    const positions = parsePositions(body.positions);
    requirePositionsInScope(access, item.locationId, positions);
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

/** Several materials at once get the same positions (D41); an empty list = everyone sees them. */
contentAdminRoutes.post('/content/positions', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const body = await readJson<{ ids?: unknown; positions?: unknown }>(c.req.raw);
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200 || !body.ids.every((i) => typeof i === 'string')) throw badRequest('invalid_input');
  const positions = parsePositions(body.positions);
  const ids = [...new Set(body.ids as string[])];
  for (const loc of access.locations.keys()) requirePositionsInScope(access, loc, positions);
  const statements: D1PreparedStatement[] = [];
  for (const id of ids) {
    const item = await loadItem(db, access, id); // checks the right to edit it
    statements.push(db.prepare(`DELETE FROM content_item_positions WHERE content_item_id = ?`).bind(item.id));
    for (const p of positions) statements.push(db.prepare(`INSERT INTO content_item_positions (content_item_id, position) VALUES (?, ?)`).bind(item.id, p));
    statements.push(auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.settings', entityType: 'content', entityId: item.id, after: { positions } }));
  }
  await db.batch(statements);
  return c.json({ ok: true, updated: ids.length });
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

  const res = await publishDraft(db, item, c.var.user.id, level, note);
  return c.json({ ...res, changeLevel: level });
});

/** Publishes the draft of an item as a new version (shared by "Opublikuj" and the bulk publish after import). */
async function publishDraft(db: D1Database, item: ItemRow, userId: string, level: ChangeLevel, note: string | null) {
  const first = !item.currentVersionId;
  const title = item.draftTitle ?? item.title;
  if (!first) {
    const cur = await db
      .prepare(`SELECT title, body_json AS b FROM content_versions WHERE id = ?`)
      .bind(item.currentVersionId)
      .first<{ title: string; b: string }>();
    if (cur && cur.b === item.draftBodyJson && cur.title === title) throw new ApiError(409, 'no_changes');
  }
  const doc = JSON.parse(item.draftBodyJson!);
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
      .bind(versionId, item.id, versionNo, title, item.draftBodyJson, text, level, note, userId, now),
    db
      .prepare(
        `UPDATE content_items SET current_version_id = ?, title = ?, status = 'published', draft_title = NULL, draft_body_json = NULL,
           draft_updated_at = NULL, draft_updated_by = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(versionId, title, now, item.id),
    ...indexStatements(db, { type: 'content', id: item.id, locationId: item.locationId, title, body: text }),
    auditStatement(db, {
      actorId: userId,
      locationId: item.locationId,
      action: 'content.publish',
      entityType: 'content',
      entityId: item.id,
      after: { versionNo, changeLevel: level, changeNote: note, title },
    }),
  ]);
  return { versionId, versionNo };
}

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

/* ───────── Permanent deletion (D30) ───────── */

/** What a permanent deletion removes — shown in the confirmation dialog. */
contentAdminRoutes.get('/content/:id/deletion', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM content_acknowledgements WHERE content_item_id = ?1) AS acknowledgements,
              (SELECT COUNT(DISTINCT m.program_id) FROM module_items mi JOIN modules m ON m.id = mi.module_id WHERE mi.content_item_id = ?1) AS programs,
              (SELECT COUNT(*) FROM content_versions WHERE content_item_id = ?1) AS versions`,
    )
    .bind(item.id)
    .first<{ acknowledgements: number; programs: number; versions: number }>();
  return c.json({ confirmText: item.title, acknowledgements: row?.acknowledgements ?? 0, programs: row?.programs ?? 0, versions: row?.versions ?? 0 });
});

/** Only an archived material; its title must be typed. Removed from programs, acknowledgements deleted. */
contentAdminRoutes.delete('/content/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const item = await loadItem(db, access, c.req.param('id'));
  if (item.status !== 'archived') throw new ApiError(409, 'delete_needs_archive');
  const body = await readJson<{ confirm?: unknown }>(c.req.raw);
  if (!confirmMatches(body.confirm, item.title)) throw badRequest('delete_confirm_mismatch');
  const photos = await db.prepare(`SELECT photo_key AS k FROM checklist_marks WHERE content_item_id = ? AND photo_key IS NOT NULL`).bind(item.id).all<{ k: string }>();
  await db.batch([
    ...purgeContentStatements(db, item.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: item.locationId, action: 'content.delete', entityType: 'content', entityId: item.id, before: { title: item.title, kind: item.kind } }),
  ]);
  await deleteKeys(
    c.env.PHOTOS,
    photos.results.map((r) => r.k),
  ).catch(() => undefined);
  return c.json({ ok: true });
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

/* ───────── Import of prepared materials (drafts) ───────── */

contentAdminRoutes.post('/locations/:locId/content/import', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const body = await readJson<{ format?: unknown; items?: unknown }>(c.req.raw);
  if (body.format !== CONTENT_BUNDLE_FORMAT || !Array.isArray(body.items) || body.items.length > CONTENT_IMPORT_CHUNK) throw badRequest('bundle_invalid');
  const created: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const raw of body.items as Record<string, unknown>[]) {
    const importKey = str(raw?.importKey, 200);
    const kind = typeof raw?.kind === 'string' && (CONTENT_KINDS as readonly string[]).includes(raw.kind) ? raw.kind : null;
    const title = str(raw?.title, 160);
    if (!importKey || !kind || !title) throw badRequest('bundle_invalid');
    const doc = sanitizeDoc(raw.body);
    if (!doc) throw badRequest('body_invalid');
    const json = JSON.stringify(doc);
    if (json.length > 600_000) throw badRequest('body_too_large');
    const exists = await db.prepare(`SELECT 1 FROM content_items WHERE location_id = ? AND import_key = ?`).bind(locId, importKey).first();
    if (exists) {
      skipped.push(title);
      continue;
    }
    const scope = allowedDivisions(access, locId);
    let positions = raw.positions === undefined ? [] : parsePositions(raw.positions);
    if (scope && !positions.length) positions = [...scope];
    requirePositionsInScope(access, locId, positions);
    const section = str(raw.section, 120);
    const sortOrder = Number.isInteger(raw.sortOrder) ? Number(raw.sortOrder) : 0;
    const isDocument = kind !== 'lesson'; // Service Book is mandatory to read too (D38)
    const requiresAck = raw.requiresAck === undefined ? isDocument : raw.requiresAck === true;
    if (raw.checklistMode !== undefined && raw.checklistMode !== 'individual' && raw.checklistMode !== 'shared') throw badRequest('checklist_mode_invalid');
    const checklistMode = raw.checklistMode === 'shared' ? 'shared' : 'individual';
    const id = newId('ci');
    await db.batch([
      db
        .prepare(
          `INSERT INTO content_items (id, location_id, kind, title, slug, section, status, requires_ack, draft_title, draft_body_json,
             draft_updated_at, draft_updated_by, import_key, sort_order, checklist_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, locId, kind, title, await uniqueSlug(db, locId, title), section, requiresAck ? 1 : 0, title, json, now, c.var.user.id, importKey, sortOrder, checklistMode, now, now),
      ...positions.map((p) => db.prepare(`INSERT INTO content_item_positions (content_item_id, position) VALUES (?, ?)`).bind(id, p)),
    ]);
    created.push(title);
  }
  if (created.length) {
    await auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'content.import', entityType: 'content', after: { created: created.length, skipped: skipped.length } }).run();
  }
  return c.json({ created, skipped });
});

/** Publishes imported items that were never published (first version = significant). */
contentAdminRoutes.post('/locations/:locId/content/import/publish', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const body = await readJson<{ ids?: unknown }>(c.req.raw);
  if (!Array.isArray(body.ids) || body.ids.length > 20 || !body.ids.every((x) => typeof x === 'string')) throw badRequest('invalid_input');
  let published = 0;
  for (const id of body.ids as string[]) {
    const item = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM content_items WHERE id = ? AND location_id = ?`).bind(id, locId).first<ItemRow>();
    if (!item || item.currentVersionId || !item.draftBodyJson || item.status === 'archived') continue;
    await publishDraft(db, item, c.var.user.id, 'significant', 'Import');
    published += 1;
  }
  return c.json({ published });
});
