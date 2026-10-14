/**
 * Menu catalog (spec D5, D9, D10; decisions D1, D10, D11).
 *
 * Admin (/api/admin): categories, items with versions, allergens & diets (kitchen only),
 * photo, archive, import of the bundle built by scripts/menu/build_menu_bundle.py.
 * Staff view (/api/locations/:locId/menu): active items only.
 *
 * Allergen rule (D26, replaces the confirmation step of D24): waiters see allergens with status
 * "contains" (sheet "X") and diets "yes" (sheet "tak") as imported. "?" / "tak*" stay "unconfirmed"
 * and are not shown. Bar items have no allergens (owner's decision).
 */
import { Hono } from 'hono';
import { CHANGE_LEVELS, EU_ALLERGENS, type AllergenStatus, type ChangeLevel } from '../../shared/constants';
import {
  ALLERGEN_CODES,
  BUNDLE_FORMAT,
  DIETS,
  IMPORT_CHUNK,
  MENU_SECTIONS,
  MENU_TEXT_FIELDS,
  MENU_TEXT_FIELD_NAMES,
  cleanIngredients,
  cleanMenuText,
  isAllergenStatus,
  isDietStatus,
  menuSearchBody,
  type DietStatus,
  type MenuSection,
  type MenuTexts,
} from '../../shared/menu';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { ApiError, badRequest, newId, notFound, readJson, str } from '../lib/http';
import { indexStatements, unindexStatement } from '../lib/search';
import { loadAccess, requireLocation, requirePermission, type Access } from '../auth/access';
import { storeBytes, storeUpload } from './media';

/* ───────── Shared helpers ───────── */

interface ItemRow extends MenuTexts {
  id: string;
  locationId: string;
  categoryId: string;
  section: MenuSection;
  categoryName: string;
  ingredientsJson: string | null;
  photoKey: string | null;
  isActive: number;
  versionNo: number;
  sortOrder: number;
  importKey: string | null;
  updatedAt: number;
}

const TEXT_SELECT = MENU_TEXT_FIELD_NAMES.map((f) => `mi.${MENU_TEXT_FIELDS[f].column} AS ${f}`).join(', ');
const ITEM_SELECT = `mi.id, mi.location_id AS locationId, mi.category_id AS categoryId, mc.section, mc.name AS categoryName,
  ${TEXT_SELECT}, mi.ingredients_json AS ingredientsJson, mi.photo_key AS photoKey, mi.is_active AS isActive,
  mi.version_no AS versionNo, mi.sort_order AS sortOrder, mi.import_key AS importKey, mi.updated_at AS updatedAt
  FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id`;

interface AllergenRow {
  allergenId: string;
  status: AllergenStatus;
  sourceNote: string | null;
  confirmedAt: number | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
}
interface DietRow {
  diet: string;
  status: DietStatus;
  sourceNote: string | null;
  confirmedAt: number | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
}

function ingredientsOf(row: { ingredientsJson: string | null }): string[] {
  if (!row.ingredientsJson) return [];
  try {
    const v = JSON.parse(row.ingredientsJson);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function textsOf(row: Partial<MenuTexts>): MenuTexts {
  const out = {} as MenuTexts;
  for (const f of MENU_TEXT_FIELD_NAMES) out[f] = row[f] ?? null;
  return out;
}

function requireMenuView(access: Access, locationId: string): void {
  const perms = access.locations.get(locationId);
  if (!perms) throw notFound();
  if (!perms.has('menu.edit')) throw new ApiError(403, 'forbidden');
}

async function loadItem(db: D1Database, access: Access, id: string): Promise<ItemRow> {
  const row = await db.prepare(`SELECT ${ITEM_SELECT} WHERE mi.id = ?`).bind(id).first<ItemRow>();
  if (!row || !access.locations.has(row.locationId)) throw notFound();
  return row;
}

async function loadAllergens(db: D1Database, itemId: string): Promise<{ allergens: AllergenRow[]; diets: DietRow[] }> {
  const [a, d] = await db.batch([
    db
      .prepare(
        `SELECT a.allergen_id AS allergenId, a.status, a.source_note AS sourceNote, a.confirmed_at AS confirmedAt,
                a.confirmed_by AS confirmedBy, CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END AS confirmedByName
         FROM menu_item_allergens a LEFT JOIN users u ON u.id = a.confirmed_by WHERE a.menu_item_id = ?`,
      )
      .bind(itemId),
    db
      .prepare(
        `SELECT d.diet, d.status, d.source_note AS sourceNote, d.confirmed_at AS confirmedAt,
                d.confirmed_by AS confirmedBy, CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name || ' ' || u.last_name END AS confirmedByName
         FROM menu_item_diets d LEFT JOIN users u ON u.id = d.confirmed_by WHERE d.menu_item_id = ?`,
      )
      .bind(itemId),
  ]);
  return { allergens: (a!.results ?? []) as unknown as AllergenRow[], diets: (d!.results ?? []) as unknown as DietRow[] };
}

/** All 14 allergens and 4 diets, missing rows filled as "unconfirmed". */
function fullStatuses(rows: { allergens: AllergenRow[]; diets: DietRow[] }) {
  const a = new Map(rows.allergens.map((r) => [r.allergenId, r]));
  const d = new Map(rows.diets.map((r) => [r.diet, r]));
  return {
    allergens: EU_ALLERGENS.map(
      (x) => a.get(x.code) ?? { allergenId: x.code, status: 'unconfirmed' as const, sourceNote: null, confirmedAt: null, confirmedBy: null, confirmedByName: null },
    ),
    diets: DIETS.map(
      (x) => d.get(x) ?? { diet: x, status: 'unconfirmed' as const, sourceNote: null, confirmedAt: null, confirmedBy: null, confirmedByName: null },
    ),
  };
}

function snapshot(row: Pick<ItemRow, 'categoryId'> & MenuTexts, ingredients: string[], st: { allergens: { allergenId: string; status: string }[]; diets: { diet: string; status: string }[] }) {
  return {
    categoryId: row.categoryId,
    texts: textsOf(row),
    ingredients,
    allergens: Object.fromEntries(st.allergens.map((a) => [a.allergenId, a.status])),
    diets: Object.fromEntries(st.diets.map((d) => [d.diet, d.status])),
  };
}

function searchStatements(db: D1Database, id: string, locationId: string, texts: MenuTexts, ingredients: string[]) {
  return indexStatements(db, {
    type: 'menu_item',
    id,
    locationId,
    title: texts.nameGuest ?? '',
    body: menuSearchBody(texts, ingredients),
  });
}

function parseTexts(input: Record<string, unknown>, base: MenuTexts): MenuTexts {
  const out = { ...base };
  for (const f of MENU_TEXT_FIELD_NAMES) {
    if (!(f in input)) continue;
    const v = cleanMenuText(f, input[f]);
    if (v === 'too_long') throw badRequest('field_too_long', { field: f });
    if (v === 'invalid') throw badRequest('invalid_input', { field: f });
    out[f] = v;
  }
  if (!out.nameGuest) throw badRequest('item_name_required');
  return out;
}

function parseIngredients(v: unknown): string[] {
  const r = cleanIngredients(v);
  if (r === 'invalid') throw badRequest('ingredients_invalid');
  return r;
}

function parseLevel(v: unknown): ChangeLevel | null {
  return typeof v === 'string' && (CHANGE_LEVELS as readonly string[]).includes(v) ? (v as ChangeLevel) : null;
}

function allergenInsert(db: D1Database, itemId: string, rows: { code: string; status: string; source: string | null; confirmedBy: string | null; confirmedAt: number | null }[]) {
  if (!rows.length) return [];
  return [
    db
      .prepare(
        `INSERT INTO menu_item_allergens (menu_item_id, allergen_id, status, source_note, confirmed_by, confirmed_at) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT (menu_item_id, allergen_id) DO UPDATE SET status = excluded.status, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at`,
      )
      .bind(...rows.flatMap((r) => [itemId, r.code, r.status, r.source, r.confirmedBy, r.confirmedAt])),
  ];
}

function dietInsert(db: D1Database, itemId: string, rows: { diet: string; status: string; source: string | null; confirmedBy: string | null; confirmedAt: number | null }[]) {
  if (!rows.length) return [];
  return [
    db
      .prepare(
        `INSERT INTO menu_item_diets (menu_item_id, diet, status, source_note, confirmed_by, confirmed_at) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT (menu_item_id, diet) DO UPDATE SET status = excluded.status, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at`,
      )
      .bind(...rows.flatMap((r) => [itemId, r.diet, r.status, r.source, r.confirmedBy, r.confirmedAt])),
  ];
}

function insertItemStatement(db: D1Database, id: string, locationId: string, categoryId: string, texts: MenuTexts, ingredients: string[], sortOrder: number, importKey: string | null, photoKey: string | null, now: number) {
  const cols = MENU_TEXT_FIELD_NAMES.map((f) => MENU_TEXT_FIELDS[f].column);
  return db
    .prepare(
      `INSERT INTO menu_items (id, location_id, category_id, ${cols.join(', ')}, ingredients_json, photo_key, is_active, version_no, sort_order, import_key, created_at, updated_at)
       VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, 1, 1, ?, ?, ?, ?)`,
    )
    .bind(id, locationId, categoryId, ...MENU_TEXT_FIELD_NAMES.map((f) => texts[f]), ingredients.length ? JSON.stringify(ingredients) : null, photoKey, sortOrder, importKey, now, now);
}

function versionStatement(db: D1Database, itemId: string, versionNo: number, snap: unknown, level: ChangeLevel, note: string | null, authorId: string, now: number) {
  return db
    .prepare(
      `INSERT INTO menu_item_versions (id, menu_item_id, version_no, snapshot_json, change_level, change_note, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId('miv'), itemId, versionNo, JSON.stringify(snap), level, note, authorId, now);
}

async function categoryOf(db: D1Database, locationId: string, categoryId: unknown) {
  if (typeof categoryId !== 'string') throw badRequest('category_required');
  const cat = await db
    .prepare(`SELECT id, section FROM menu_categories WHERE id = ? AND location_id = ?`)
    .bind(categoryId, locationId)
    .first<{ id: string; section: MenuSection }>();
  if (!cat) throw badRequest('category_required');
  return cat;
}

/* ───────── Admin routes ───────── */

export const menuAdminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

menuAdminRoutes.get('/locations/:locId/menu', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireMenuView(access, locId);
  const [sections, categories, items] = await db.batch([
    db.prepare(`SELECT section, note FROM menu_sections WHERE location_id = ?`).bind(locId),
    db
      .prepare(
        `SELECT mc.id, mc.section, mc.name, mc.sort_order AS sortOrder,
                (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = mc.id AND mi.is_active = 1) AS activeCount
         FROM menu_categories mc WHERE mc.location_id = ? ORDER BY mc.section, mc.sort_order, mc.name`,
      )
      .bind(locId),
    db
      .prepare(
        `SELECT mi.id, mi.category_id AS categoryId, mc.section, mi.name_guest AS nameGuest, mi.name_pos AS namePos,
                mi.is_active AS isActive, mi.photo_key AS photoKey, mi.sort_order AS sortOrder, mi.version_no AS versionNo, mi.updated_at AS updatedAt
         FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.location_id = ? ORDER BY mc.section, mc.sort_order, mi.sort_order, mi.name_guest`,
      )
      .bind(locId),
  ]);
  const notes = Object.fromEntries((sections!.results as { section: string; note: string | null }[]).map((s) => [s.section, s.note]));
  return c.json({
    sections: Object.fromEntries(MENU_SECTIONS.map((s) => [s, { note: notes[s] ?? null }])),
    categories: categories!.results,
    items: (items!.results as Record<string, unknown>[]).map((r) => {
      return {
        id: r.id,
        categoryId: r.categoryId,
        section: r.section,
        nameGuest: r.nameGuest,
        namePos: r.namePos,
        isActive: Boolean(r.isActive),
        photoSrc: r.photoKey ? `/media/${r.photoKey}` : null,
        sortOrder: r.sortOrder,
        versionNo: r.versionNo,
        updatedAt: r.updatedAt,
      };
    }),
    canEdit: access.locations.get(locId)!.has('menu.edit'),
  });
});

menuAdminRoutes.post('/locations/:locId/menu/categories', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'menu.edit');
  const body = await readJson<{ section?: unknown; name?: unknown }>(c.req.raw);
  const section = MENU_SECTIONS.find((s) => s === body.section);
  const name = str(body.name, 80);
  if (!section) throw badRequest('section_invalid');
  if (!name) throw badRequest('category_name_required');
  const dup = await db.prepare(`SELECT 1 FROM menu_categories WHERE location_id = ? AND section = ? AND name = ?`).bind(locId, section, name).first();
  if (dup) throw new ApiError(409, 'category_exists');
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM menu_categories WHERE location_id = ? AND section = ?`).bind(locId, section).first<{ m: number }>();
  const id = newId('mc');
  await db.batch([
    db.prepare(`INSERT INTO menu_categories (id, location_id, section, name, sort_order) VALUES (?, ?, ?, ?, ?)`).bind(id, locId, section, name, (max?.m ?? -1) + 1),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'menu.category_create', entityType: 'menu_category', entityId: id, after: { section, name } }),
  ]);
  return c.json({ id }, 201);
});

menuAdminRoutes.put('/menu/categories/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const cat = await db
    .prepare(`SELECT id, location_id AS locationId, section, name, sort_order AS sortOrder FROM menu_categories WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; locationId: string; section: string; name: string; sortOrder: number }>();
  if (!cat || !access.locations.has(cat.locationId)) throw notFound();
  requirePermission(access, cat.locationId, 'menu.edit');
  const body = await readJson<{ name?: unknown; sortOrder?: unknown }>(c.req.raw);
  const name = body.name === undefined ? cat.name : str(body.name, 80);
  if (!name) throw badRequest('category_name_required');
  const sortOrder = body.sortOrder === undefined ? cat.sortOrder : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) throw badRequest('invalid_input');
  if (name !== cat.name) {
    const dup = await db.prepare(`SELECT 1 FROM menu_categories WHERE location_id = ? AND section = ? AND name = ? AND id <> ?`).bind(cat.locationId, cat.section, name, cat.id).first();
    if (dup) throw new ApiError(409, 'category_exists');
  }
  await db.batch([
    db.prepare(`UPDATE menu_categories SET name = ?, sort_order = ? WHERE id = ?`).bind(name, sortOrder, cat.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: cat.locationId, action: 'menu.category_update', entityType: 'menu_category', entityId: cat.id, before: { name: cat.name, sortOrder: cat.sortOrder }, after: { name, sortOrder } }),
  ]);
  return c.json({ ok: true });
});

menuAdminRoutes.put('/locations/:locId/menu/sections/:section', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'menu.edit');
  const section = MENU_SECTIONS.find((s) => s === c.req.param('section'));
  if (!section) throw notFound();
  const body = await readJson<{ note?: unknown }>(c.req.raw);
  if (body.note !== null && typeof body.note !== 'string') throw badRequest('invalid_input');
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.replace(/\r\n?/g, '\n').trim() : null;
  if (note && note.length > 2000) throw badRequest('field_too_long');
  await db.batch([
    db
      .prepare(`INSERT INTO menu_sections (location_id, section, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (location_id, section) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`)
      .bind(locId, section, note, Date.now()),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'menu.section_note', entityType: 'menu_section', entityId: section, after: { note } }),
  ]);
  return c.json({ ok: true });
});

menuAdminRoutes.post('/locations/:locId/menu/items', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'menu.edit');
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const cat = await categoryOf(db, locId, body.categoryId);
  const texts = parseTexts(body, textsOf({}));
  const ingredients = parseIngredients(body.ingredients);
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_items WHERE category_id = ?`).bind(cat.id).first<{ m: number }>();
  const id = newId('mi');
  const now = Date.now();
  const snap = snapshot({ ...texts, categoryId: cat.id }, ingredients, fullStatuses({ allergens: [], diets: [] }));
  await db.batch([
    insertItemStatement(db, id, locId, cat.id, texts, ingredients, (max?.m ?? 0) + 1, null, null, now),
    versionStatement(db, id, 1, snap, 'significant', null, c.var.user.id, now),
    ...searchStatements(db, id, locId, texts, ingredients),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'menu.item_create', entityType: 'menu_item', entityId: id, after: { nameGuest: texts.nameGuest, section: cat.section } }),
  ]);
  return c.json({ id }, 201);
});

menuAdminRoutes.get('/menu/items/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requireMenuView(access, row.locationId);
  const st = fullStatuses(await loadAllergens(db, row.id));
  const { results: versions } = await db
    .prepare(
      `SELECT v.id, v.version_no AS versionNo, v.change_level AS changeLevel, v.change_note AS changeNote, v.created_at AS createdAt,
              u.first_name AS authorFirstName, u.last_name AS authorLastName
       FROM menu_item_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.menu_item_id = ? ORDER BY v.version_no DESC`,
    )
    .bind(row.id)
    .all();
  const perms = access.locations.get(row.locationId)!;
  return c.json({
    item: {
      id: row.id,
      locationId: row.locationId,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      section: row.section,
      texts: textsOf(row),
      ingredients: ingredientsOf(row),
      photoSrc: row.photoKey ? `/media/${row.photoKey}` : null,
      isActive: Boolean(row.isActive),
      versionNo: row.versionNo,
      sortOrder: row.sortOrder,
      imported: row.importKey !== null,
      updatedAt: row.updatedAt,
    },
    allergens: st.allergens,
    diets: st.diets,
    versions,
    canEdit: perms.has('menu.edit'),
  });
});

menuAdminRoutes.get('/menu/items/:id/versions/:versionId', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requireMenuView(access, row.locationId);
  const v = await db
    .prepare(`SELECT id, version_no AS versionNo, snapshot_json AS snapshotJson, change_level AS changeLevel, change_note AS changeNote, created_at AS createdAt FROM menu_item_versions WHERE id = ? AND menu_item_id = ?`)
    .bind(c.req.param('versionId'), row.id)
    .first<{ id: string; versionNo: number; snapshotJson: string; changeLevel: string; changeNote: string | null; createdAt: number }>();
  if (!v) throw notFound();
  return c.json({ version: { id: v.id, versionNo: v.versionNo, changeLevel: v.changeLevel, changeNote: v.changeNote, createdAt: v.createdAt, snapshot: JSON.parse(v.snapshotJson) } });
});

menuAdminRoutes.put('/menu/items/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requirePermission(access, row.locationId, 'menu.edit');
  const body = await readJson<{ texts?: Record<string, unknown>; ingredients?: unknown; categoryId?: unknown; changeLevel?: unknown; changeNote?: unknown }>(c.req.raw);
  const before = textsOf(row);
  const texts = parseTexts(body.texts ?? {}, before);
  const oldIngredients = ingredientsOf(row);
  const ingredients = body.ingredients === undefined ? oldIngredients : parseIngredients(body.ingredients);
  const cat = body.categoryId === undefined || body.categoryId === row.categoryId ? { id: row.categoryId, section: row.section } : await categoryOf(db, row.locationId, body.categoryId);
  if (cat.section !== row.section) throw badRequest('category_section');

  const changed = MENU_TEXT_FIELD_NAMES.filter((f) => texts[f] !== before[f]);
  const ingredientsChanged = JSON.stringify(ingredients) !== JSON.stringify(oldIngredients);
  if (!changed.length && !ingredientsChanged && cat.id === row.categoryId) throw badRequest('no_changes');
  const level = parseLevel(body.changeLevel);
  if (!level) throw badRequest('change_level_required');
  const note = str(body.changeNote, 300);

  const now = Date.now();
  const versionNo = row.versionNo + 1;
  const st = fullStatuses(await loadAllergens(db, row.id));
  const sets = MENU_TEXT_FIELD_NAMES.map((f) => `${MENU_TEXT_FIELDS[f].column} = ?`).join(', ');
  await db.batch([
    db
      .prepare(`UPDATE menu_items SET ${sets}, ingredients_json = ?, category_id = ?, version_no = ?, updated_at = ? WHERE id = ?`)
      .bind(...MENU_TEXT_FIELD_NAMES.map((f) => texts[f]), ingredients.length ? JSON.stringify(ingredients) : null, cat.id, versionNo, now, row.id),
    versionStatement(db, row.id, versionNo, snapshot({ ...texts, categoryId: cat.id }, ingredients, st), level, note, c.var.user.id, now),
    ...(row.isActive ? searchStatements(db, row.id, row.locationId, texts, ingredients) : []),
    auditStatement(db, {
      actorId: c.var.user.id,
      locationId: row.locationId,
      action: 'menu.item_update',
      entityType: 'menu_item',
      entityId: row.id,
      before: Object.fromEntries(changed.map((f) => [f, before[f]])),
      after: { ...Object.fromEntries(changed.map((f) => [f, texts[f]])), ...(ingredientsChanged ? { ingredients } : {}), changeLevel: level, versionNo },
    }),
  ]);
  return c.json({ versionNo });
});

/**
 * Saves allergen and diet statuses of a kitchen item (menu.edit). Every status change is a significant
 * change (new version). confirmed_by / confirmed_at now mean "last changed by / at".
 */
menuAdminRoutes.put('/menu/items/:id/allergens', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requirePermission(access, row.locationId, 'menu.edit');
  if (row.section !== 'kitchen') throw badRequest('allergens_kitchen_only');
  const body = await readJson<{ allergens?: Record<string, unknown>; diets?: Record<string, unknown>; changeNote?: unknown }>(c.req.raw);
  if (!body.allergens || typeof body.allergens !== 'object' || !body.diets || typeof body.diets !== 'object') throw badRequest('invalid_input');
  for (const code of ALLERGEN_CODES) if (!isAllergenStatus(body.allergens[code])) throw badRequest('allergens_incomplete');
  for (const d of DIETS) if (!isDietStatus(body.diets[d])) throw badRequest('diets_incomplete');
  if (Object.keys(body.allergens).some((k) => !ALLERGEN_CODES.includes(k as never)) || Object.keys(body.diets).some((k) => !DIETS.includes(k as never))) {
    throw badRequest('invalid_input');
  }

  const current = fullStatuses(await loadAllergens(db, row.id));
  const now = Date.now();
  const me = c.var.user.id;
  const allergenChanges = current.allergens.filter((a) => a.status !== body.allergens![a.allergenId]).map((a) => ({ code: a.allergenId, from: a.status, to: body.allergens![a.allergenId] }));
  const dietChanges = current.diets.filter((d) => d.status !== body.diets![d.diet]).map((d) => ({ diet: d.diet, from: d.status, to: body.diets![d.diet] }));
  const statusChanged = allergenChanges.length + dietChanges.length > 0;
  if (!statusChanged) throw badRequest('no_changes');

  const changedCodes = new Set(allergenChanges.map((x) => x.code));
  const changedDiets = new Set(dietChanges.map((x) => x.diet));
  const nextAllergens = current.allergens.map((a) => ({ code: a.allergenId, status: body.allergens![a.allergenId] as string, source: a.sourceNote, confirmedBy: changedCodes.has(a.allergenId) ? me : a.confirmedBy, confirmedAt: changedCodes.has(a.allergenId) ? now : a.confirmedAt }));
  const nextDiets = current.diets.map((d) => ({ diet: d.diet, status: body.diets![d.diet] as string, source: d.sourceNote, confirmedBy: changedDiets.has(d.diet) ? me : d.confirmedBy, confirmedAt: changedDiets.has(d.diet) ? now : d.confirmedAt }));
  const statements = [...allergenInsert(db, row.id, nextAllergens), ...dietInsert(db, row.id, nextDiets)];
  let versionNo = row.versionNo;
  if (statusChanged) {
    versionNo += 1;
    const snap = snapshot(row, ingredientsOf(row), {
      allergens: nextAllergens.map((a) => ({ allergenId: a.code, status: a.status })),
      diets: nextDiets.map((d) => ({ diet: d.diet, status: d.status })),
    });
    statements.push(
      db.prepare(`UPDATE menu_items SET version_no = ?, updated_at = ? WHERE id = ?`).bind(versionNo, now, row.id),
      versionStatement(db, row.id, versionNo, snap, 'significant', str(body.changeNote, 300), me, now),
    );
  }
  statements.push(
    auditStatement(db, {
      actorId: me,
      locationId: row.locationId,
      action: 'menu.allergens_update',
      entityType: 'menu_item',
      entityId: row.id,
      after: { allergenChanges, dietChanges, versionNo },
    }),
  );
  await db.batch(statements);
  return c.json({ versionNo });
});

menuAdminRoutes.post('/menu/items/:id/photo', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requirePermission(access, row.locationId, 'menu.edit');
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw badRequest('file_required');
  const stored = await storeUpload(c.env, file, { kind: 'img', locationId: row.locationId, userId: c.var.user.id });
  await db.batch([
    db.prepare(`UPDATE menu_items SET photo_key = ?, updated_at = ? WHERE id = ?`).bind(stored.key, Date.now(), row.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: 'menu.photo_set', entityType: 'menu_item', entityId: row.id, before: { photo: row.photoKey }, after: { photo: stored.key } }),
  ]);
  return c.json({ photoSrc: stored.src }, 201);
});

menuAdminRoutes.delete('/menu/items/:id/photo', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  requirePermission(access, row.locationId, 'menu.edit');
  if (!row.photoKey) return c.json({ ok: true });
  // The file stays in R2 (history); only the link is removed.
  await db.batch([
    db.prepare(`UPDATE menu_items SET photo_key = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), row.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: 'menu.photo_remove', entityType: 'menu_item', entityId: row.id, before: { photo: row.photoKey } }),
  ]);
  return c.json({ ok: true });
});

for (const [path, active] of [['archive', false], ['restore', true]] as const) {
  menuAdminRoutes.post(`/menu/items/:id/${path}`, async (c) => {
    const db = c.env.DB;
    const access = await loadAccess(db, c.var.user);
    const row = await loadItem(db, access, c.req.param('id'));
    requirePermission(access, row.locationId, 'menu.edit');
    if (Boolean(row.isActive) === active) return c.json({ ok: true });
    await db.batch([
      db.prepare(`UPDATE menu_items SET is_active = ?, updated_at = ? WHERE id = ?`).bind(active ? 1 : 0, Date.now(), row.id),
      ...(active ? searchStatements(db, row.id, row.locationId, textsOf(row), ingredientsOf(row)) : [unindexStatement(db, 'menu_item', row.id)]),
      auditStatement(db, { actorId: c.var.user.id, locationId: row.locationId, action: active ? 'menu.item_restore' : 'menu.item_archive', entityType: 'menu_item', entityId: row.id }),
    ]);
    return c.json({ ok: true });
  });
}

/* ───────── Import (bundle in chunks of IMPORT_CHUNK items) ───────── */

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

menuAdminRoutes.post('/locations/:locId/menu/import', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'menu.edit');
  const body = await readJson<{
    format?: unknown;
    sections?: Record<string, { note?: unknown } | undefined>;
    categories?: unknown;
    items?: unknown;
  }>(c.req.raw);
  if (body.format !== BUNDLE_FORMAT) throw badRequest('bundle_invalid');
  if (!Array.isArray(body.items) || body.items.length > IMPORT_CHUNK) throw badRequest('bundle_invalid');
  const declared = Array.isArray(body.categories) ? (body.categories as { section?: unknown; name?: unknown; sortOrder?: unknown }[]) : [];

  const me = c.var.user.id;
  const now = Date.now();
  const result = { created: [] as string[], skipped: [] as string[], photos: 0, categoriesCreated: 0 };

  // Section notes: set only when empty, so a re-import never overwrites what a manager edited.
  for (const s of MENU_SECTIONS) {
    const note = body.sections?.[s]?.note;
    if (typeof note === 'string' && note.trim()) {
      await db
        .prepare(`INSERT INTO menu_sections (location_id, section, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (location_id, section) DO UPDATE SET note = COALESCE(menu_sections.note, excluded.note)`)
        .bind(locId, s, note.trim().slice(0, 2000), now)
        .run();
    }
  }

  const catCache = new Map<string, string>();
  async function categoryId(section: MenuSection, name: string): Promise<string> {
    const k = `${section}\u0000${name}`;
    const hit = catCache.get(k);
    if (hit) return hit;
    const row = await db.prepare(`SELECT id FROM menu_categories WHERE location_id = ? AND section = ? AND name = ?`).bind(locId, section, name).first<{ id: string }>();
    if (row) {
      catCache.set(k, row.id);
      return row.id;
    }
    const d = declared.find((x) => x.section === section && x.name === name);
    const sort = d && Number.isInteger(d.sortOrder) ? Number(d.sortOrder) : 1000;
    const id = newId('mc');
    await db.prepare(`INSERT INTO menu_categories (id, location_id, section, name, sort_order) VALUES (?, ?, ?, ?, ?)`).bind(id, locId, section, name, sort).run();
    result.categoriesCreated += 1;
    catCache.set(k, id);
    return id;
  }

  for (const raw of body.items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') throw badRequest('bundle_invalid');
    const section = MENU_SECTIONS.find((s) => s === raw.section);
    const catName = str(raw.category, 80);
    const importKey = str(raw.importKey, 300);
    if (!section || !catName || !importKey) throw badRequest('bundle_invalid');
    const texts = parseTexts(raw, textsOf({}));
    const ingredients = parseIngredients(raw.ingredients);

    const exists = await db.prepare(`SELECT id FROM menu_items WHERE location_id = ? AND import_key = ?`).bind(locId, importKey).first();
    if (exists) {
      result.skipped.push(texts.nameGuest!);
      continue;
    }
    const catId = await categoryId(section, catName);
    const id = newId('mi');

    const allergens: { code: string; status: string; source: string | null; confirmedBy: null; confirmedAt: null }[] = [];
    const srcA = (raw.allergens ?? {}) as Record<string, { status?: unknown; source?: unknown }>;
    for (const code of ALLERGEN_CODES) {
      const v = srcA[code];
      if (!v) continue;
      if (!isAllergenStatus(v.status)) throw badRequest('bundle_invalid');
      allergens.push({ code, status: v.status, source: typeof v.source === 'string' ? v.source.slice(0, 200) : null, confirmedBy: null, confirmedAt: null });
    }
    const diets: { diet: string; status: string; source: string | null; confirmedBy: null; confirmedAt: null }[] = [];
    const srcD = (raw.diets ?? {}) as Record<string, { status?: unknown; source?: unknown }>;
    for (const diet of DIETS) {
      const v = srcD[diet];
      if (!v) continue;
      if (!isDietStatus(v.status)) throw badRequest('bundle_invalid');
      diets.push({ diet, status: v.status, source: typeof v.source === 'string' ? v.source.slice(0, 200) : null, confirmedBy: null, confirmedAt: null });
    }

    let photoKey: string | null = null;
    const photo = raw.photo as { contentType?: unknown; data?: unknown } | null | undefined;
    if (photo && typeof photo.data === 'string' && typeof photo.contentType === 'string') {
      const bytes = b64ToBytes(photo.data);
      const stored = await storeBytes(c.env, bytes, photo.contentType, `${texts.nameGuest}.jpg`, { kind: 'img', locationId: locId, userId: me });
      photoKey = stored.key;
      result.photos += 1;
    }

    const sortOrder = Number.isInteger(raw.sortOrder) ? Number(raw.sortOrder) : 0;
    const snap = snapshot({ ...texts, categoryId: catId }, ingredients, {
      allergens: allergens.map((a) => ({ allergenId: a.code, status: a.status })),
      diets: diets.map((d) => ({ diet: d.diet, status: d.status })),
    });
    await db.batch([
      insertItemStatement(db, id, locId, catId, texts, ingredients, sortOrder, importKey, photoKey, now),
      versionStatement(db, id, 1, snap, 'significant', 'Import', me, now),
      ...allergenInsert(db, id, allergens),
      ...dietInsert(db, id, diets),
      ...searchStatements(db, id, locId, texts, ingredients),
    ]);
    result.created.push(texts.nameGuest!);
  }

  if (result.created.length) {
    await auditStatement(db, {
      actorId: me,
      locationId: locId,
      action: 'menu.import',
      entityType: 'menu',
      after: { created: result.created.length, skipped: result.skipped.length, photos: result.photos },
    }).run();
  }
  return c.json(result);
});

/* ───────── Staff view (any signed-in user of the location) ───────── */

export const menuRoutes = new Hono<AppEnv>();
// Session is enforced in index.ts.

/**
 * What a waiter sees (kitchen only): allergens "contains" and diets "yes".
 * `allergensComplete` is false when any of the 14 is missing or "unconfirmed" (sheet "?").
 */
function visibleStatuses(section: string, rows: { allergens: AllergenRow[]; diets: DietRow[] }) {
  if (section !== 'kitchen') return { showAllergens: false, allergens: [] as string[], diets: [] as string[], allergensComplete: false };
  return {
    showAllergens: true,
    allergens: EU_ALLERGENS.filter((x) => rows.allergens.some((a) => a.allergenId === x.code && a.status === 'contains')).map((x) => x.code),
    diets: DIETS.filter((d) => rows.diets.some((r) => r.diet === d && r.status === 'yes')),
    allergensComplete: ALLERGEN_CODES.every((code) => rows.allergens.some((a) => a.allergenId === code && a.status !== 'unconfirmed')),
  };
}

menuRoutes.get('/locations/:locId/menu', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requireLocation(access, locId);
  const [sections, categories, items, allergens, diets] = await db.batch([
    db.prepare(`SELECT section, note FROM menu_sections WHERE location_id = ?`).bind(locId),
    db.prepare(`SELECT id, section, name, sort_order AS sortOrder FROM menu_categories WHERE location_id = ? ORDER BY section, sort_order, name`).bind(locId),
    db
      .prepare(
        `SELECT mi.id, mi.category_id AS categoryId, mc.section, mi.name_guest AS nameGuest, mi.name_pos AS namePos, mi.photo_key AS photoKey, mi.sort_order AS sortOrder
         FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.location_id = ? AND mi.is_active = 1 ORDER BY mc.section, mc.sort_order, mi.sort_order, mi.name_guest`,
      )
      .bind(locId),
    db
      .prepare(
        `SELECT a.menu_item_id AS itemId, a.allergen_id AS allergenId, a.status, a.confirmed_at AS confirmedAt FROM menu_item_allergens a
         JOIN menu_items mi ON mi.id = a.menu_item_id WHERE mi.location_id = ? AND mi.is_active = 1`,
      )
      .bind(locId),
    db
      .prepare(
        `SELECT d.menu_item_id AS itemId, d.diet, d.status, d.confirmed_at AS confirmedAt FROM menu_item_diets d
         JOIN menu_items mi ON mi.id = d.menu_item_id WHERE mi.location_id = ? AND mi.is_active = 1`,
      )
      .bind(locId),
  ]);
  const aBy = new Map<string, AllergenRow[]>();
  for (const r of allergens!.results as (AllergenRow & { itemId: string })[]) (aBy.get(r.itemId) ?? aBy.set(r.itemId, []).get(r.itemId)!).push(r);
  const dBy = new Map<string, DietRow[]>();
  for (const r of diets!.results as (DietRow & { itemId: string })[]) (dBy.get(r.itemId) ?? dBy.set(r.itemId, []).get(r.itemId)!).push(r);
  const itemRows = items!.results as { id: string; categoryId: string; section: string; nameGuest: string; namePos: string | null; photoKey: string | null; sortOrder: number }[];
  const usedCats = new Set(itemRows.map((i) => i.categoryId));
  const notes = Object.fromEntries((sections!.results as { section: string; note: string | null }[]).map((s) => [s.section, s.note]));
  return c.json({
    sections: Object.fromEntries(MENU_SECTIONS.map((s) => [s, { note: notes[s] ?? null }])),
    categories: (categories!.results as { id: string }[]).filter((cat) => usedCats.has(cat.id)),
    items: itemRows.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      section: i.section,
      nameGuest: i.nameGuest,
      namePos: i.namePos,
      photoSrc: i.photoKey ? `/media/${i.photoKey}` : null,
      ...visibleStatuses(i.section, { allergens: aBy.get(i.id) ?? [], diets: dBy.get(i.id) ?? [] }),
    })),
  });
});

menuRoutes.get('/menu/items/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const row = await loadItem(db, access, c.req.param('id'));
  if (!row.isActive) throw notFound();
  const vis = visibleStatuses(row.section, await loadAllergens(db, row.id));
  return c.json({
    item: {
      id: row.id,
      section: row.section,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      texts: textsOf(row),
      ingredients: ingredientsOf(row),
      photoSrc: row.photoKey ? `/media/${row.photoKey}` : null,
      versionNo: row.versionNo,
      ...vis,
    },
  });
});
