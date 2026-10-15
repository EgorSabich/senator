#!/usr/bin/env python3
"""
Builds the material import bundle (JSON) for Senator Academy from edited Markdown files.

  python3 -I scripts/content/build_content_bundle.py --manifest manifest.json --out content-bundle.json

manifest.json:
  {"items": [{"file": "regulaminy/podawanie.md", "importKey": "regulation:podawanie", "kind": "regulation",
              "title": "Regulamin podawania dań i napojów", "section": null, "positions": ["waiter"],
              "requiresAck": true, "sortOrder": 10}],
   "notes": ["…remarks for the owner shown before import…"]}
File paths are relative to the manifest. The bundle holds restaurant material: never commit it.

Markdown subset (what the editor supports):
  ## Heading / ### Subheading (#### is treated as ###; a leading "# Title" line is skipped)
  paragraphs with **bold**, *italic*, [link](https://…)
  - bullet lists, 1. numbered lists (steps); two-space indent = nested list
  | table | rows | with a | --- | separator line (first row = header)
  > [!WAŻNE] / > [!UWAGA] / > [!INFO] followed by "> text" lines = callout blocks
  --- = horizontal rule
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CALLOUTS = {'WAŻNE': 'important', 'WAZNE': 'important', 'UWAGA': 'warning', 'INFO': 'info', 'INFORMACJA': 'info'}
INLINE = re.compile(r'(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\((https?://[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\))')


def inline(text: str, marks: list | None = None) -> list:
    """Markdown inline → TipTap text nodes."""
    out: list = []
    pos = 0
    marks = marks or []
    for m in INLINE.finditer(text):
        if m.start() > pos:
            out.append(txt(text[pos:m.start()], marks))
        if m.group(2) is not None:
            out.extend(inline(m.group(2), marks + [{'type': 'bold'}]))
        elif m.group(3) is not None:
            out.extend(inline(m.group(3), marks + [{'type': 'italic'}]))
        elif m.group(4) is not None:
            out.extend(inline(m.group(4), marks + [{'type': 'italic'}]))
        else:
            out.extend(inline(m.group(5), marks + [{'type': 'link', 'attrs': {'href': m.group(6)}}]))
        pos = m.end()
    if pos < len(text):
        out.append(txt(text[pos:], marks))
    return [n for n in out if n['text']]


def txt(t: str, marks: list) -> dict:
    n = {'type': 'text', 'text': t}
    if marks:
        n['marks'] = marks
    return n


def para(text: str) -> dict:
    content = inline(text.strip())
    return {'type': 'paragraph', 'content': content} if content else {'type': 'paragraph'}


def parse_table(lines: list[str]) -> dict:
    rows = []
    for i, line in enumerate(lines):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if i == 1 and all(re.fullmatch(r':?-{2,}:?', c) for c in cells):
            continue
        rows.append(cells)
    width = max(len(r) for r in rows)
    out = []
    for i, r in enumerate(rows):
        r = r + [''] * (width - len(r))
        kind = 'tableHeader' if i == 0 else 'tableCell'
        out.append({'type': 'tableRow', 'content': [{'type': kind, 'attrs': {'colspan': 1, 'rowspan': 1}, 'content': [para(c)]} for c in r]})
    return {'type': 'table', 'content': out}


LIST_RE = re.compile(r'^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$')


def parse_list(lines: list[str], start: int, indent: int) -> tuple[dict, int]:
    m = LIST_RE.match(lines[start])
    ordered = m.group(3) is not None
    node = {'type': 'orderedList', 'attrs': {'start': 1}, 'content': []} if ordered else {'type': 'bulletList', 'content': []}
    i = start
    while i < len(lines):
        m = LIST_RE.match(lines[i])
        if not m:
            # continuation line of the previous item (indented text)
            if lines[i].strip() and len(lines[i]) - len(lines[i].lstrip()) > indent and node['content']:
                node['content'][-1]['content'].append(para(lines[i]))
                i += 1
                continue
            break
        ind = len(m.group(1).replace('\t', '  '))
        if ind < indent:
            break
        if ind > indent:
            sub, i = parse_list(lines, i, ind)
            if node['content']:
                node['content'][-1]['content'].append(sub)
            continue
        if (m.group(3) is not None) != ordered:
            break
        node['content'].append({'type': 'listItem', 'content': [para(m.group(4))]})
        i += 1
    return node, i


def md_to_doc(md: str) -> dict:
    lines = md.replace('\r\n', '\n').split('\n')
    content: list = []
    i = 0
    buf: list[str] = []

    def flush():
        if buf:
            text = ' '.join(s.strip() for s in buf)
            content.append(para(text))
            buf.clear()

    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            flush()
            i += 1
            continue
        if s.startswith('# ') and not content and not buf:
            i += 1  # document title — kept as the item title
            continue
        h = re.match(r'^(#{2,4})\s+(.*)$', s)
        if h:
            flush()
            level = 2 if len(h.group(1)) == 2 else 3
            content.append({'type': 'heading', 'attrs': {'level': level}, 'content': inline(h.group(2).strip())})
            i += 1
            continue
        if re.fullmatch(r'-{3,}|\*{3,}', s):
            flush()
            content.append({'type': 'horizontalRule'})
            i += 1
            continue
        c = re.match(r'^>\s*\[!([A-ZĄĆĘŁŃÓŚŹŻ]+)\]\s*(.*)$', s)
        if c:
            flush()
            variant = CALLOUTS.get(c.group(1).upper(), 'info')
            inner = [c.group(2)] if c.group(2) else []
            i += 1
            while i < len(lines) and lines[i].strip().startswith('>'):
                inner.append(lines[i].strip()[1:].lstrip())
                i += 1
            sub = md_to_doc('\n'.join(inner))['content'] or [{'type': 'paragraph'}]
            content.append({'type': 'callout', 'attrs': {'variant': variant}, 'content': sub})
            continue
        if s.startswith('>'):
            # plain quote (no [!TYPE]) → neutral info callout; the schema has no blockquote
            flush()
            inner = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                inner.append(lines[i].strip()[1:].lstrip())
                i += 1
            sub = md_to_doc('\n'.join(inner))['content'] or [{'type': 'paragraph'}]
            content.append({'type': 'callout', 'attrs': {'variant': 'info'}, 'content': sub})
            continue
        if s.startswith('|'):
            flush()
            tl = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                tl.append(lines[i])
                i += 1
            content.append(parse_table(tl))
            continue
        if LIST_RE.match(line):
            flush()
            node, i = parse_list(lines, i, len(LIST_RE.match(line).group(1)))
            content.append(node)
            continue
        buf.append(line)
        i += 1
    flush()
    return {'type': 'doc', 'content': content or [{'type': 'paragraph'}]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    manifest_path = Path(a.manifest)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    items = []
    keys = set()
    for it in manifest['items']:
        md = (manifest_path.parent / it['file']).read_text(encoding='utf-8')
        if it['importKey'] in keys:
            raise SystemExit(f"Duplicate importKey {it['importKey']}")
        keys.add(it['importKey'])
        item = {k: v for k, v in it.items() if k != 'file'}
        item['body'] = md_to_doc(md)
        items.append(item)
    bundle = {
        'format': 'senator-content-bundle',
        'version': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'items': items,
        'notes': manifest.get('notes', []),
    }
    Path(a.out).write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf-8')
    print(f'{len(items)} materiałów → {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
