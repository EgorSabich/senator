/**
 * Training programs in the admin panel (spec D2, D9): program per position, modules with unlock rules,
 * module items = published content (lessons, Service Book chapters, documents). Tests join in stage 6.
 * Permission: content.edit in the program's location.
 */
import { Hono } from 'hono';
import { POSITIONS } from '../../shared/constants';
import type { AppEnv } from '../env';
import { auditStatement } from '../lib/audit';
import { badRequest, newId, notFound, readJson, str } from '../lib/http';
import { loadAccess, requirePermission, type Access } from '../auth/access';

export const programAdminRoutes = new Hono<AppEnv>();
// Session is enforced by the /api/admin router (index.ts).

const UNLOCK = ['open', 'after_module', 'after_all_mandatory'] as const;

async function loadProgram(db: D1Database, access: Access, id: string) {
  const p = await db
    .prepare(`SELECT id, location_id AS locationId, name, position, is_default AS isDefault FROM programs WHERE id = ?`)
    .bind(id)
    .first<{ id: string; locationId: string; name: string; position: string; isDefault: number }>();
  if (!p || !access.locations.has(p.locationId)) throw notFound();
  requirePermission(access, p.locationId, 'content.edit');
  return p;
}

async function loadModule(db: D1Database, access: Access, id: string) {
  const m = await db
    .prepare(`SELECT m.id, m.program_id AS programId, p.location_id AS locationId FROM modules m JOIN programs p ON p.id = m.program_id WHERE m.id = ?`)
    .bind(id)
    .first<{ id: string; programId: string; locationId: string }>();
  if (!m || !access.locations.has(m.locationId)) throw notFound();
  requirePermission(access, m.locationId, 'content.edit');
  return m;
}

async function programDetail(db: D1Database, programId: string) {
  const [p, mods, items] = await db.batch([
    db.prepare(`SELECT id, location_id AS locationId, name, position, is_default AS isDefault FROM programs WHERE id = ?`).bind(programId),
    db
      .prepare(
        `SELECT id, title, description, sort_order AS sortOrder, is_mandatory AS isMandatory, unlock_rule AS unlockRule, unlock_after_module_id AS unlockAfterModuleId
         FROM modules WHERE program_id = ? ORDER BY sort_order, rowid`,
      )
      .bind(programId),
    db
      .prepare(
        `SELECT mi.id, mi.module_id AS moduleId, mi.content_item_id AS contentItemId, mi.is_mandatory AS isMandatory, mi.sort_order AS sortOrder,
                ci.kind, ci.title, ci.status
         FROM module_items mi JOIN modules m ON m.id = mi.module_id JOIN content_items ci ON ci.id = mi.content_item_id
         WHERE m.program_id = ? AND mi.item_type = 'content' ORDER BY mi.sort_order, mi.rowid`,
      )
      .bind(programId),
  ]);
  const prog = p!.results[0] as Record<string, unknown>;
  const itemRows = items!.results as Record<string, unknown>[];
  return {
    program: { ...prog, isDefault: Boolean(prog.isDefault) },
    modules: (mods!.results as Record<string, unknown>[]).map((m) => ({
      ...m,
      isMandatory: Boolean(m.isMandatory),
      items: itemRows.filter((i) => i.moduleId === m.id).map((i) => ({ ...i, isMandatory: Boolean(i.isMandatory) })),
    })),
  };
}

programAdminRoutes.get('/locations/:locId/programs', async (c) => {
  const locId = c.req.param('locId');
  const access = await loadAccess(c.env.DB, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.position, p.is_default AS isDefault, (SELECT COUNT(*) FROM modules m WHERE m.program_id = p.id) AS moduleCount
     FROM programs p WHERE p.location_id = ? ORDER BY p.position, p.created_at`,
  )
    .bind(locId)
    .all<Record<string, unknown>>();
  return c.json({ programs: results.map((r) => ({ ...r, isDefault: Boolean(r.isDefault) })) });
});

programAdminRoutes.post('/locations/:locId/programs', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'content.edit');
  const body = await readJson<{ name?: unknown; position?: unknown }>(c.req.raw);
  const name = str(body.name, 120);
  const position = POSITIONS.find((p) => p === body.position);
  if (!name) throw badRequest('program_name_required');
  if (!position) throw badRequest('position_invalid');
  const hasDefault = await db.prepare(`SELECT 1 FROM programs WHERE location_id = ? AND position = ? AND is_default = 1`).bind(locId, position).first();
  const id = newId('prg');
  await db.batch([
    db.prepare(`INSERT INTO programs (id, location_id, name, position, is_default) VALUES (?, ?, ?, ?, ?)`).bind(id, locId, name, position, hasDefault ? 0 : 1),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'program.create', entityType: 'program', entityId: id, after: { name, position } }),
  ]);
  return c.json({ id }, 201);
});

programAdminRoutes.get('/programs/:id', async (c) => {
  const access = await loadAccess(c.env.DB, c.var.user);
  const p = await loadProgram(c.env.DB, access, c.req.param('id'));
  return c.json(await programDetail(c.env.DB, p.id));
});

programAdminRoutes.put('/programs/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const p = await loadProgram(db, access, c.req.param('id'));
  const body = await readJson<{ name?: unknown; isDefault?: unknown }>(c.req.raw);
  const name = body.name === undefined ? p.name : str(body.name, 120);
  if (!name) throw badRequest('program_name_required');
  const stmts = [db.prepare(`UPDATE programs SET name = ? WHERE id = ?`).bind(name, p.id)];
  if (body.isDefault === true && !p.isDefault) {
    stmts.push(
      db.prepare(`UPDATE programs SET is_default = 0 WHERE location_id = ? AND position = ?`).bind(p.locationId, p.position),
      db.prepare(`UPDATE programs SET is_default = 1 WHERE id = ?`).bind(p.id),
    );
  }
  stmts.push(auditStatement(db, { actorId: c.var.user.id, locationId: p.locationId, action: 'program.update', entityType: 'program', entityId: p.id, before: { name: p.name }, after: { name, isDefault: body.isDefault === true || Boolean(p.isDefault) } }));
  await db.batch(stmts);
  return c.json({ ok: true });
});

programAdminRoutes.post('/programs/:id/modules', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const p = await loadProgram(db, access, c.req.param('id'));
  const body = await readJson<{ title?: unknown }>(c.req.raw);
  const title = str(body.title, 120);
  if (!title) throw badRequest('title_required');
  const max = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM modules WHERE program_id = ?`).bind(p.id).first<{ m: number }>();
  const id = newId('mod');
  await db.batch([
    db.prepare(`INSERT INTO modules (id, program_id, title, sort_order, is_mandatory, unlock_rule) VALUES (?, ?, ?, ?, 1, 'open')`).bind(id, p.id, title, (max?.m ?? -1) + 1),
    auditStatement(db, { actorId: c.var.user.id, locationId: p.locationId, action: 'module.create', entityType: 'module', entityId: id, after: { title, programId: p.id } }),
  ]);
  return c.json({ id }, 201);
});

programAdminRoutes.post('/programs/:id/modules/order', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const p = await loadProgram(db, access, c.req.param('id'));
  const body = await readJson<{ ids?: unknown }>(c.req.raw);
  const { results } = await db.prepare(`SELECT id FROM modules WHERE program_id = ?`).bind(p.id).all<{ id: string }>();
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]) : [];
  if (ids.length !== results.length || !results.every((r) => ids.includes(r.id))) throw badRequest('invalid_input');
  await db.batch(ids.map((id, i) => db.prepare(`UPDATE modules SET sort_order = ? WHERE id = ? AND program_id = ?`).bind(i, id, p.id)));
  return c.json({ ok: true });
});

programAdminRoutes.put('/modules/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const m = await loadModule(db, access, c.req.param('id'));
  const body = await readJson<{ title?: unknown; description?: unknown; isMandatory?: unknown; unlockRule?: unknown; unlockAfterModuleId?: unknown }>(c.req.raw);
  const title = str(body.title, 120);
  if (!title) throw badRequest('title_required');
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 1000) : null;
  const rule = UNLOCK.find((u) => u === body.unlockRule) ?? 'open';
  let after: string | null = null;
  if (rule === 'after_module') {
    if (typeof body.unlockAfterModuleId !== 'string' || body.unlockAfterModuleId === m.id) throw badRequest('unlock_module_invalid');
    const other = await db.prepare(`SELECT 1 FROM modules WHERE id = ? AND program_id = ?`).bind(body.unlockAfterModuleId, m.programId).first();
    if (!other) throw badRequest('unlock_module_invalid');
    after = body.unlockAfterModuleId;
  }
  await db.batch([
    db
      .prepare(`UPDATE modules SET title = ?, description = ?, is_mandatory = ?, unlock_rule = ?, unlock_after_module_id = ? WHERE id = ?`)
      .bind(title, description, body.isMandatory === false ? 0 : 1, rule, after, m.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: m.locationId, action: 'module.update', entityType: 'module', entityId: m.id, after: { title, isMandatory: body.isMandatory !== false, unlockRule: rule } }),
  ]);
  return c.json({ ok: true });
});

/** Removes a module from the program. Progress lives on content, so nobody loses history. */
programAdminRoutes.delete('/modules/:id', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const m = await loadModule(db, access, c.req.param('id'));
  await db.batch([
    db.prepare(`UPDATE modules SET unlock_rule = 'open', unlock_after_module_id = NULL WHERE unlock_after_module_id = ?`).bind(m.id),
    db.prepare(`DELETE FROM module_items WHERE module_id = ?`).bind(m.id),
    db.prepare(`DELETE FROM modules WHERE id = ?`).bind(m.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: m.locationId, action: 'module.delete', entityType: 'module', entityId: m.id }),
  ]);
  return c.json({ ok: true });
});

/** Replaces the module's item list (order = array order). Only content of this location or shared, not archived. */
programAdminRoutes.put('/modules/:id/items', async (c) => {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  const m = await loadModule(db, access, c.req.param('id'));
  const body = await readJson<{ items?: unknown }>(c.req.raw);
  if (!Array.isArray(body.items) || body.items.length > 100) throw badRequest('invalid_input');
  const items = body.items as { contentItemId?: unknown; isMandatory?: unknown }[];
  const ids = items.map((i) => i.contentItemId);
  if (!ids.every((x): x is string => typeof x === 'string') || new Set(ids).size !== ids.length) throw badRequest('invalid_input');
  if (ids.length) {
    const { results } = await db
      .prepare(`SELECT id FROM content_items WHERE id IN (${ids.map(() => '?').join(', ')}) AND (location_id = ? OR location_id IS NULL) AND status <> 'archived'`)
      .bind(...ids, m.locationId)
      .all<{ id: string }>();
    if (results.length !== ids.length) throw badRequest('content_invalid');
  }
  await db.batch([
    db.prepare(`DELETE FROM module_items WHERE module_id = ?`).bind(m.id),
    ...items.map((it, i) =>
      db
        .prepare(`INSERT INTO module_items (id, module_id, item_type, content_item_id, sort_order, is_mandatory) VALUES (?, ?, 'content', ?, ?, ?)`)
        .bind(newId('mit'), m.id, it.contentItemId as string, i, it.isMandatory === false ? 0 : 1),
    ),
    auditStatement(db, { actorId: c.var.user.id, locationId: m.locationId, action: 'module.items', entityType: 'module', entityId: m.id, after: { count: items.length } }),
  ]);
  return c.json({ ok: true });
});

