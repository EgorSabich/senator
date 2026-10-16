import { POSITIONS } from './constants';
import { foldPolish } from './text';

/**
 * Material import bundle (scripts/content/build_content_bundle.py → panel "Import materiałów").
 * Items arrive as drafts; the owner reviews them in the panel before publishing (spec E, decision D9).
 */
export const CONTENT_BUNDLE_FORMAT = 'senator-content-bundle';
export const CONTENT_IMPORT_CHUNK = 4;

export interface ContentBundleItem {
  importKey: string;
  kind: string;
  title: string;
  section?: string | null;
  positions?: string[];
  requiresAck?: boolean;
  sortOrder?: number;
  /** checklists only (D42) */
  checklistMode?: 'individual' | 'shared';
  body: unknown;
}

export interface ContentBundle {
  format: typeof CONTENT_BUNDLE_FORMAT;
  version: 1;
  createdAt?: string;
  items: ContentBundleItem[];
  notes?: string[];
}

export function checkContentBundle(v: unknown): ContentBundle | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as ContentBundle;
  if (b.format !== CONTENT_BUNDLE_FORMAT || b.version !== 1 || !Array.isArray(b.items)) return null;
  return b;
}

/**
 * Checklist import (D42): a simple JSON a manager can write by hand or with an AI assistant.
 * {"format": "senator-checklists", "checklists": [{"title": "...", "positions": ["waiter"], "mode": "individual",
 *   "sections": [{"title": "Sala", "items": ["Wytrzyj stoły", "..."]}]}]}
 * Converted on the phone/computer into the usual material bundle: checklists arrive as drafts to review and publish.
 */
export const CHECKLISTS_FORMAT = 'senator-checklists';

export function checklistsToBundle(v: unknown): { bundle: ContentBundle; errors: string[] } | null {
  if (!v || typeof v !== 'object' || (v as { format?: unknown }).format !== CHECKLISTS_FORMAT) return null;
  const lists = (v as { checklists?: unknown }).checklists;
  const errors: string[] = [];
  const items: ContentBundleItem[] = [];
  if (!Array.isArray(lists) || !lists.length) return { bundle: { format: CONTENT_BUNDLE_FORMAT, version: 1, items }, errors: ['Brak list w pliku („checklists”).'] };
  const text = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
  lists.forEach((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const title = text(l.title).slice(0, 160);
    if (!title) return errors.push(`Lista ${n}: brak tytułu („title”).`);
    const positions = Array.isArray(l.positions) ? l.positions.filter((p): p is string => typeof p === 'string') : [];
    const unknownPos = positions.filter((p) => !(POSITIONS as readonly string[]).includes(p));
    if (unknownPos.length) return errors.push(`„${title}”: nieznane stanowisko ${unknownPos.join(', ')}. Dozwolone: ${POSITIONS.join(', ')}.`);
    const mode = l.mode === undefined ? 'individual' : l.mode;
    if (mode !== 'individual' && mode !== 'shared') return errors.push(`„${title}”: „mode” to "individual" albo "shared".`);
    const sections: { title: string; items: string[] }[] = [];
    if (Array.isArray(l.sections)) {
      for (const sRaw of l.sections) {
        const sec = (sRaw ?? {}) as Record<string, unknown>;
        sections.push({ title: text(sec.title).slice(0, 120), items: Array.isArray(sec.items) ? sec.items.map(text).filter(Boolean) : [] });
      }
    }
    if (Array.isArray(l.items)) sections.unshift({ title: '', items: l.items.map(text).filter(Boolean) });
    const count = sections.reduce((a, s) => a + s.items.length, 0);
    if (!count) return errors.push(`„${title}”: brak zadań („items”).`);
    if (count > 300) return errors.push(`„${title}”: za dużo zadań (${count}, maks. 300).`);
    const content: unknown[] = [];
    for (const sec of sections) {
      if (!sec.items.length) continue;
      if (sec.title) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: sec.title }] });
      content.push({
        type: 'bulletList',
        content: sec.items.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.slice(0, 500) }] }] })),
      });
    }
    items.push({
      importKey: `checklist:${foldPolish(title).replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'checklist',
      title,
      section: text(l.section) || null,
      positions,
      requiresAck: typeof l.requiresAck === 'boolean' ? l.requiresAck : false,
      checklistMode: mode,
      body: { type: 'doc', content },
    });
  });
  return { bundle: { format: CONTENT_BUNDLE_FORMAT, version: 1, items }, errors };
}
