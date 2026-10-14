import { foldPolish } from '../../shared/text';

export type SearchEntity = 'content' | 'menu_item';

/** Replace one entity in the FTS index (text folded so "losos" finds "łosoś"). */
export function indexStatements(
  db: D1Database,
  entity: { type: SearchEntity; id: string; locationId: string | null; title: string; body: string },
): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?`).bind(entity.type, entity.id),
    db
      .prepare(`INSERT INTO search_index (entity_type, entity_id, location_id, title, body) VALUES (?, ?, ?, ?, ?)`)
      .bind(entity.type, entity.id, entity.locationId ?? '', foldPolish(entity.title), foldPolish(entity.body)),
  ];
}

export function unindexStatement(db: D1Database, type: SearchEntity, id: string): D1PreparedStatement {
  return db.prepare(`DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?`).bind(type, id);
}

/** FTS5 query from user input: folded words, each as a prefix term. */
export function ftsQuery(input: string): string | null {
  const words = foldPolish(input)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' ');
}
