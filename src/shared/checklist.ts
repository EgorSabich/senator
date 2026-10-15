/**
 * Daily checklists (D36): every list item (bullet or numbered) of a published checklist is one task.
 * The key depends on the section heading and the text only, so editing other items keeps marks in place.
 */
import type { RtNode } from './richtext';

export interface ChecklistItem {
  key: string;
  section: string | null;
  text: string;
}

function fnv1a(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function itemKey(section: string | null, text: string, occurrence = 0): string {
  const base = `${section ?? ''}\u0001${text.replace(/\s+/g, ' ').trim().toLowerCase()}\u0001${occurrence}`;
  return fnv1a(base, 0x811c9dc5) + fnv1a(base, 0x01000193);
}

function inlineText(node: RtNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  // nested lists are items of their own
  if (node.type === 'bulletList' || node.type === 'orderedList') return '';
  return (node.content ?? []).map(inlineText).join(node.type === 'listItem' ? ' ' : '');
}

export function checklistItems(doc: RtNode | null | undefined): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const seen = new Map<string, number>();
  let section: string | null = null;

  const visit = (node: RtNode) => {
    if (node.type === 'heading') {
      const t = inlineText(node).replace(/\s+/g, ' ').trim();
      section = t || null;
      return;
    }
    if (node.type === 'listItem') {
      const text = (node.content ?? [])
        .filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList')
        .map(inlineText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        const id = `${section ?? ''}\u0001${text.toLowerCase()}`;
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        out.push({ key: itemKey(section, text, n), section, text });
      }
      for (const c of node.content ?? []) if (c.type === 'bulletList' || c.type === 'orderedList') visit(c);
      return;
    }
    if (node.type === 'callout' || node.type === 'table') return; // notes and tables are not tasks
    for (const c of node.content ?? []) visit(c);
  };
  if (doc) visit(doc);
  return out;
}
