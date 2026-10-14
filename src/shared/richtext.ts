/**
 * Rich text (TipTap JSON) allowed in lessons, Service Book and documents.
 * The server sanitizes every saved body with `sanitizeDoc`; anything outside the whitelist is dropped.
 */

export interface RtNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RtNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export const CALLOUT_VARIANTS = ['important', 'warning', 'info'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const BLOCK_CONTAINERS = new Set(['doc', 'bulletList', 'orderedList', 'listItem', 'callout']);
const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'text',
  'hardBreak',
  'horizontalRule',
  'image',
  'callout',
]);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'link']);
const MEDIA_SRC = /^\/media\/[A-Za-z0-9/_.-]{1,200}$/;
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;
const MAX_DEPTH = 24;
const MAX_TEXT = 200_000;

export function emptyDoc(): RtNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function cleanMarks(marks: RtNode['marks']): RtNode['marks'] {
  if (!Array.isArray(marks)) return undefined;
  const out: NonNullable<RtNode['marks']> = [];
  for (const m of marks) {
    if (!m || typeof m.type !== 'string' || !ALLOWED_MARKS.has(m.type)) continue;
    if (m.type === 'link') {
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href.trim() : '';
      if (!SAFE_HREF.test(href) || href.length > 2000) continue;
      out.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
    } else {
      out.push({ type: m.type });
    }
  }
  return out.length ? out : undefined;
}

function cleanNode(node: unknown, depth: number, budget: { chars: number }): RtNode | null {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return null;
  const n = node as RtNode;
  if (typeof n.type !== 'string' || !ALLOWED_NODES.has(n.type)) return null;

  if (n.type === 'text') {
    if (typeof n.text !== 'string' || n.text.length === 0) return null;
    budget.chars -= n.text.length;
    if (budget.chars < 0) return null;
    const marks = cleanMarks(n.marks);
    return marks ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text };
  }
  if (n.type === 'hardBreak' || n.type === 'horizontalRule') return { type: n.type };
  if (n.type === 'image') {
    const src = typeof n.attrs?.src === 'string' ? n.attrs.src : '';
    if (!MEDIA_SRC.test(src)) return null;
    const alt = typeof n.attrs?.alt === 'string' ? n.attrs.alt.slice(0, 300) : '';
    return { type: 'image', attrs: { src, alt } };
  }

  const out: RtNode = { type: n.type };
  if (n.type === 'heading') {
    const level = n.attrs?.level === 3 ? 3 : 2;
    out.attrs = { level };
  } else if (n.type === 'orderedList') {
    const start = typeof n.attrs?.start === 'number' && n.attrs.start > 0 && n.attrs.start < 1000 ? n.attrs.start : 1;
    out.attrs = { start };
  } else if (n.type === 'callout') {
    const variant = (CALLOUT_VARIANTS as readonly unknown[]).includes(n.attrs?.variant) ? n.attrs!.variant : 'important';
    out.attrs = { variant };
  }

  const children = Array.isArray(n.content) ? n.content : [];
  const cleaned = children.map((c) => cleanNode(c, depth + 1, budget)).filter((c): c is RtNode => c !== null);
  if (BLOCK_CONTAINERS.has(n.type)) {
    // Containers hold blocks only; stray inline text is wrapped in a paragraph.
    const blocks = cleaned.map((c) => (c.type === 'text' || c.type === 'hardBreak' ? { type: 'paragraph', content: [c] } : c));
    out.content = blocks.length ? blocks : n.type === 'listItem' || n.type === 'callout' || n.type === 'doc' ? [{ type: 'paragraph' }] : [];
    if ((n.type === 'bulletList' || n.type === 'orderedList') && !out.content.some((c) => c.type === 'listItem')) return null;
    if (n.type === 'bulletList' || n.type === 'orderedList') out.content = out.content.filter((c) => c.type === 'listItem');
  } else if (cleaned.length) {
    out.content = cleaned.filter((c) => c.type === 'text' || c.type === 'hardBreak' || c.type === 'image');
  }
  return out;
}

/** Returns a safe document, or null when the input is not a document at all. */
export function sanitizeDoc(input: unknown): RtNode | null {
  if (!input || typeof input !== 'object' || (input as RtNode).type !== 'doc') return null;
  return cleanNode(input, 0, { chars: MAX_TEXT });
}

/** Plain text for search and version comparison: blocks separated by new lines. */
export function docToText(doc: RtNode): string {
  const lines: string[] = [];
  const walk = (n: RtNode, prefix = ''): void => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const text = (n.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'hardBreak' ? '\n' : '')).join('');
      lines.push(prefix + text);
      return;
    }
    if (n.type === 'image') {
      if (n.attrs?.alt) lines.push(`[${String(n.attrs.alt)}]`);
      return;
    }
    if (n.type === 'orderedList') {
      (n.content ?? []).forEach((li, i) => (li.content ?? []).forEach((c, j) => walk(c, j === 0 ? `${i + 1}. ` : '   ')));
      return;
    }
    if (n.type === 'bulletList') {
      (n.content ?? []).forEach((li) => (li.content ?? []).forEach((c, j) => walk(c, j === 0 ? '• ' : '  ')));
      return;
    }
    (n.content ?? []).forEach((c) => walk(c, prefix));
  };
  walk(doc);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Media keys referenced by a document (used to check access to uploaded photos). */
export function docImageSrcs(doc: RtNode): string[] {
  const out: string[] = [];
  const walk = (n: RtNode) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string') out.push(n.attrs.src);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}
