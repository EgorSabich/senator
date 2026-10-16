/**
 * Shared queries for the staff side: which content a person may see and how far they are with it.
 */
import { itemProgress, moduleStates, programPercent, type ItemProgress, type ModuleInput, type VersionRef } from '../../shared/progress';
import type { SessionUser } from '../env';
import { divisionOf } from '../../shared/constants';

export const DOCUMENT_KINDS = ['regulation', 'sop', 'checklist'] as const;
/** Kinds whose items can be mandatory to read and confirm; the Service Book too (D38). */
export const MANDATORY_KINDS = [...DOCUMENT_KINDS, 'service_book'] as const;

export interface VisibleItem {
  id: string;
  locationId: string | null;
  kind: string;
  title: string;
  section: string | null;
  requiresAck: number;
  externalUrl: string | null;
  attachmentKey: string | null;
  attachmentName: string | null;
  currentVersionId: string;
  sortOrder: number;
  updatedAt: number;
  positions: string | null;
  /** service_book pages: their Wiedza tab and who that tab is for */
  tabId: string | null;
  tabPositions: string | null;
}

export const DEFAULT_TAB = 'kt_service_book';

export async function userPositions(db: D1Database, user: SessionUser, locationId: string): Promise<string[] | null> {
  if (user.role !== 'employee') return null; // managers and owner see everything
  const { results } = await db
    .prepare(`SELECT position FROM user_locations WHERE user_id = ? AND location_id = ? AND is_active = 1`)
    .bind(user.id, locationId)
    .all<{ position: string }>();
  // an assistant also sees what is meant for the division (waiter_assistant → waiter materials and program)
  return [...new Set(results.flatMap((r) => [r.position, divisionOf(r.position)]))];
}

/** Published, visible content of a location (own + shared), filtered by the person's positions. */
export async function visibleContent(db: D1Database, locationId: string, positions: string[] | null, kinds?: readonly string[]): Promise<VisibleItem[]> {
  const kindSql = kinds?.length ? `AND ci.kind IN (${kinds.map(() => '?').join(', ')})` : '';
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.location_id AS locationId, ci.kind, ci.title, ci.section, ci.requires_ack AS requiresAck,
              ci.external_url AS externalUrl, ci.attachment_key AS attachmentKey, ci.attachment_name AS attachmentName,
              ci.current_version_id AS currentVersionId, ci.sort_order AS sortOrder, ci.updated_at AS updatedAt,
              (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions,
              kt.id AS tabId, kt.positions AS tabPositions
       FROM content_items ci
       LEFT JOIN knowledge_tabs kt ON ci.kind = 'service_book' AND kt.id = COALESCE(ci.tab_id, '${DEFAULT_TAB}')
       WHERE (ci.location_id = ? OR ci.location_id IS NULL) AND ci.status = 'published' AND ci.current_version_id IS NOT NULL ${kindSql}
       ORDER BY ci.kind, ci.section, ci.sort_order, ci.title`,
    )
    .bind(locationId, ...(kinds ?? []))
    .all<VisibleItem>();
  // a page of a tab is seen only by people the tab is for (Service Book → waiters)
  return results.filter((r) => isVisibleFor(r.positions, positions) && isVisibleFor(r.tabPositions, positions));
}

export function isVisibleFor(itemPositions: string | null, positions: string[] | null): boolean {
  if (positions === null || !itemPositions) return true;
  const set = itemPositions.split(',');
  return positions.some((p) => set.includes(p));
}

/** Progress of one person for many items (versions + acknowledgements in two queries). */
export async function progressFor(db: D1Database, userId: string, itemIds: string[]): Promise<Map<string, ItemProgress>> {
  const out = new Map<string, ItemProgress>();
  if (!itemIds.length) return out;
  const versions = new Map<string, VersionRef[]>();
  const acked = new Set<string>();
  for (let i = 0; i < itemIds.length; i += 80) {
    const chunk = itemIds.slice(i, i + 80);
    const marks = chunk.map(() => '?').join(', ');
    const [v, a] = await db.batch([
      db
        .prepare(
          `SELECT id, content_item_id AS itemId, version_no AS versionNo, change_level AS changeLevel FROM content_versions WHERE content_item_id IN (${marks})`,
        )
        .bind(...chunk),
      db.prepare(`SELECT version_id AS versionId FROM content_acknowledgements WHERE user_id = ? AND content_item_id IN (${marks})`).bind(userId, ...chunk),
    ]);
    for (const r of v!.results as (VersionRef & { itemId: string })[]) (versions.get(r.itemId) ?? versions.set(r.itemId, []).get(r.itemId)!).push(r);
    for (const r of a!.results as { versionId: string }[]) acked.add(r.versionId);
  }
  for (const id of itemIds) out.set(id, itemProgress(versions.get(id) ?? [], acked));
  return out;
}

export interface ProgramView {
  program: { id: string; name: string; position: string } | null;
  percent: number;
  modules: {
    id: string;
    title: string;
    description: string | null;
    isMandatory: boolean;
    unlockRule: string;
    unlockAfterModuleId: string | null;
    done: number;
    total: number;
    complete: boolean;
    locked: boolean;
    items: { contentItemId: string; kind: string; title: string; isMandatory: boolean; status: ItemProgress['status']; updated: boolean }[];
  }[];
}

/** The person's program in a location: default program of (one of) their positions. */
export async function programFor(db: D1Database, user: SessionUser, locationId: string, programId?: string): Promise<ProgramView> {
  const positions = await userPositions(db, user, locationId);
  let program: { id: string; name: string; position: string } | null = null;
  if (programId) {
    program = await db.prepare(`SELECT id, name, position FROM programs WHERE id = ? AND location_id = ?`).bind(programId, locationId).first();
  } else if (positions && positions.length) {
    program = await db
      .prepare(
        `SELECT id, name, position FROM programs WHERE location_id = ? AND is_default = 1 AND position IN (${positions.map(() => '?').join(', ')}) ORDER BY created_at LIMIT 1`,
      )
      .bind(locationId, ...positions)
      .first();
  } else if (positions === null) {
    program = await db
      .prepare(`SELECT id, name, position FROM programs WHERE location_id = ? AND is_default = 1 AND position = 'waiter' LIMIT 1`)
      .bind(locationId)
      .first();
  }
  if (!program) return { program: null, percent: 0, modules: [] };

  const [mods, items] = await db.batch([
    db
      .prepare(
        `SELECT id, title, description, is_mandatory AS isMandatory, unlock_rule AS unlockRule, unlock_after_module_id AS unlockAfterModuleId
         FROM modules WHERE program_id = ? ORDER BY sort_order, rowid`,
      )
      .bind(program.id),
    db
      .prepare(
        `SELECT mi.module_id AS moduleId, mi.content_item_id AS contentItemId, mi.is_mandatory AS isMandatory, ci.kind, ci.title, ci.location_id AS locationId,
                (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions
         FROM module_items mi JOIN modules m ON m.id = mi.module_id
         JOIN content_items ci ON ci.id = mi.content_item_id
         WHERE m.program_id = ? AND mi.item_type = 'content' AND ci.status = 'published' AND ci.current_version_id IS NOT NULL
         ORDER BY mi.sort_order, mi.rowid`,
      )
      .bind(program.id),
  ]);
  const itemRows = (
    items!.results as {
      moduleId: string;
      contentItemId: string;
      isMandatory: number;
      kind: string;
      title: string;
      locationId: string | null;
      positions: string | null;
    }[]
  ).filter((r) => (r.locationId === null || r.locationId === locationId) && isVisibleFor(r.positions, positions));
  const progress = await progressFor(db, user.id, [...new Set(itemRows.map((r) => r.contentItemId))]);
  const modRows = mods!.results as {
    id: string;
    title: string;
    description: string | null;
    isMandatory: number;
    unlockRule: ModuleInput['unlockRule'];
    unlockAfterModuleId: string | null;
  }[];
  const inputs: ModuleInput[] = modRows.map((m) => ({
    id: m.id,
    isMandatory: Boolean(m.isMandatory),
    unlockRule: m.unlockRule,
    unlockAfterModuleId: m.unlockAfterModuleId,
    items: itemRows.filter((r) => r.moduleId === m.id).map((r) => ({ isMandatory: Boolean(r.isMandatory), status: progress.get(r.contentItemId)!.status })),
  }));
  const states = moduleStates(inputs);
  // Modules with nothing to read yet (only drafts, or items for other positions) are hidden from the person;
  // a program with no such module counts as "not ready" rather than "finished".
  if (!inputs.some((m) => m.items.length)) return { program: null, percent: 0, modules: [] };
  return {
    program,
    percent: programPercent(inputs),
    modules: modRows
      .map((m, i) => ({
        ...states[i]!,
        title: m.title,
        description: m.description,
        isMandatory: Boolean(m.isMandatory),
        unlockRule: m.unlockRule,
        unlockAfterModuleId: m.unlockAfterModuleId,
        items: itemRows
          .filter((r) => r.moduleId === m.id)
          .map((r) => ({
            contentItemId: r.contentItemId,
            kind: r.kind,
            title: r.title,
            isMandatory: Boolean(r.isMandatory),
            status: progress.get(r.contentItemId)!.status,
            updated: progress.get(r.contentItemId)!.updated,
          })),
      }))
      .filter((m) => m.items.length > 0),
  };
}
