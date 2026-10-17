/** Checklist editor model: a list document ⇄ sections and items (pure, no DOM — tested in tests/checklist-editor.test.ts). */
import { checklistItems } from '../../shared/checklist';
import type { RtNode } from '../../shared/richtext';

export interface Item {
  uid: string;
  text: string;
  photo: boolean;
  origKey: string | null;
}
export interface Section {
  uid: string;
  name: string;
  items: Item[];
}
export interface Model {
  title: string;
  mode: 'individual' | 'shared';
  positions: string[];
  sections: Section[];
  /** paragraphs, notes, tables of the list: kept above the sections */
  extra: RtNode[];
}
let seq = 0;
export const uid = () => `u${++seq}`;

function nodeText(n: RtNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return ' ';
  if (n.type === 'bulletList' || n.type === 'orderedList') return '';
  return (n.content ?? []).map(nodeText).join(n.type === 'listItem' ? ' ' : '');
}

/** Same walk as checklistItems(): headings start sections, every list item (nested too) is one task. */
export function docToModel(doc: RtNode | null, photoKeys: string[]): Pick<Model, 'sections' | 'extra'> {
  const sections: Section[] = [];
  const extra: RtNode[] = [];
  const items: Item[] = [];
  let cur: Section | null = null;
  const section = () => {
    if (!cur) {
      cur = { uid: uid(), name: '', items: [] };
      sections.push(cur);
    }
    return cur;
  };
  const visitList = (list: RtNode) => {
    for (const li of list.content ?? []) {
      if (li.type !== 'listItem') continue;
      const text = (li.content ?? [])
        .filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList')
        .map(nodeText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        const it: Item = { uid: uid(), text, photo: false, origKey: null };
        section().items.push(it);
        items.push(it);
      }
      for (const c of li.content ?? []) if (c.type === 'bulletList' || c.type === 'orderedList') visitList(c);
    }
  };
  for (const n of doc?.content ?? []) {
    if (n.type === 'heading') {
      cur = { uid: uid(), name: nodeText(n).replace(/\s+/g, ' ').trim(), items: [] };
      sections.push(cur);
    } else if (n.type === 'bulletList' || n.type === 'orderedList') visitList(n);
    else if (!(n.type === 'paragraph' && !nodeText(n).trim())) extra.push(n); // empty lines are not kept
  }
  // keys exactly as the server counts them (section + text + repeats)
  const keys = checklistItems(doc);
  if (keys.length === items.length) items.forEach((it, i) => ((it.origKey = keys[i]!.key), (it.photo = photoKeys.includes(keys[i]!.key))));
  return { sections: sections.length ? sections : [{ uid: uid(), name: '', items: [] }], extra };
}

const para = (text: string): RtNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

export function modelToDoc(m: Pick<Model, 'sections' | 'extra'>): RtNode {
  const content: RtNode[] = [...m.extra];
  for (const s of m.sections) {
    const items = s.items.filter((i) => i.text.trim());
    if (s.name.trim()) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: s.name.trim() }] });
    if (items.length) content.push({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [para(i.text.trim())] })) });
  }
  if (!content.length) content.push(para(''));
  return { type: 'doc', content };
}

