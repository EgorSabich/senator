/**
 * Grafik export (2026-10-17): the schedule drawn on a canvas — one PNG for messengers, or a PDF of A4 landscape pages
 * for the notice board. Black, white and greys only (house style for printed documents); no libraries.
 */

export interface ExportRow {
  name: string;
  /** one entry per day: lines to print in the cell; `muted` lines (days off) are grey */
  cells: { lines: string[]; muted?: boolean }[];
  hours: string;
}
export interface ExportGroup {
  name: string;
  rows: ExportRow[];
}
export interface ExportInput {
  title: string;
  subtitle: string;
  /** small line under the title, e.g. "wersja robocza" */
  note?: string;
  footer: string;
  days: { label: string; sub?: string; weekend: boolean }[];
  hoursLabel: string;
  personLabel: string;
  groups: ExportGroup[];
  compact: boolean; // month view: narrow columns
}

const INK = '#111111';
const SOFT = '#555555';
const MUTED = '#8a8a8a';
const LINE = '#cfcfcf';
const LINE_STRONG = '#222222';
const WEEKEND = '#f1f1f1';
const GROUP_BG = '#e6e6e6';

interface Layout {
  font: string;
  nameW: number;
  dayW: number;
  hoursW: number;
  headH: number;
  lineH: number;
  pad: number;
  groupH: number;
}

function layoutFor(input: ExportInput): Layout {
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  return input.compact
    ? { font, nameW: 190, dayW: 46, hoursW: 74, headH: 44, lineH: 15, pad: 7, groupH: 30 }
    : { font, nameW: 210, dayW: 138, hoursW: 84, headH: 48, lineH: 19, pad: 9, groupH: 32 };
}

type Line = { kind: 'group'; group: ExportGroup } | { kind: 'row'; row: ExportRow; h: number };

function lines(input: ExportInput, l: Layout): Line[] {
  const out: Line[] = [];
  for (const g of input.groups) {
    if (!g.rows.length) continue;
    out.push({ kind: 'group', group: g });
    for (const r of g.rows) {
      const most = Math.max(1, ...r.cells.map((c) => c.lines.length));
      out.push({ kind: 'row', row: r, h: most * l.lineH + l.pad * 2 });
    }
  }
  return out;
}

const tableWidth = (input: ExportInput, l: Layout) => l.nameW + l.dayW * input.days.length + l.hoursW;
const lineHeight = (x: Line, l: Layout) => (x.kind === 'group' ? l.groupH : x.h);
const TITLE_H = 92;
const FOOT_H = 34;
const MARGIN = 36;

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Draws title, column heads and the given lines starting at the top of the canvas (in layout units). */
function drawPage(ctx: CanvasRenderingContext2D, input: ExportInput, l: Layout, part: Line[], page: { no: number; of: number }, width: number, height: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const x0 = MARGIN;
  const tw = tableWidth(input, l);
  // title
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 26px ${l.font}`;
  ctx.fillText(input.title, x0, MARGIN + 26);
  ctx.font = `500 16px ${l.font}`;
  ctx.fillStyle = SOFT;
  ctx.fillText(input.subtitle, x0, MARGIN + 52);
  if (input.note) {
    ctx.font = `600 13px ${l.font}`;
    ctx.fillStyle = INK;
    const w = ctx.measureText(input.note).width + 20;
    ctx.strokeStyle = LINE_STRONG;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + tw - w + 0.5, MARGIN + 6.5, w, 26);
    ctx.fillText(input.note, x0 + tw - w + 10, MARGIN + 24);
  }
  let y = MARGIN + TITLE_H - 20;

  // column heads
  ctx.fillStyle = '#ffffff';
  input.days.forEach((d, i) => {
    if (!d.weekend) return;
    ctx.fillStyle = WEEKEND;
    ctx.fillRect(x0 + l.nameW + i * l.dayW, y, l.dayW, l.headH);
  });
  ctx.fillStyle = INK;
  ctx.font = `700 13px ${l.font}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(input.personLabel, x0 + 8, y + l.headH / 2);
  input.days.forEach((d, i) => {
    const cx = x0 + l.nameW + i * l.dayW + l.dayW / 2;
    ctx.textAlign = 'center';
    ctx.font = `700 ${input.compact ? 12 : 14}px ${l.font}`;
    ctx.fillStyle = INK;
    ctx.fillText(d.label, cx, y + (d.sub ? l.headH / 2 - 8 : l.headH / 2));
    if (d.sub) {
      ctx.font = `500 ${input.compact ? 11 : 12}px ${l.font}`;
      ctx.fillStyle = SOFT;
      ctx.fillText(d.sub, cx, y + l.headH / 2 + 9);
    }
  });
  ctx.textAlign = 'center';
  ctx.font = `700 13px ${l.font}`;
  ctx.fillStyle = INK;
  ctx.fillText(input.hoursLabel, x0 + tw - l.hoursW / 2, y + l.headH / 2);
  ctx.textAlign = 'left';
  ctx.strokeStyle = LINE_STRONG;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y + l.headH);
  ctx.lineTo(x0 + tw, y + l.headH);
  ctx.stroke();
  y += l.headH;

  // rows
  for (const line of part) {
    const h = lineHeight(line, l);
    if (line.kind === 'group') {
      ctx.fillStyle = GROUP_BG;
      ctx.fillRect(x0, y, tw, h);
      ctx.fillStyle = INK;
      ctx.font = `700 13px ${l.font}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${line.group.name.toUpperCase()}  ·  ${line.group.rows.length}`, x0 + 8, y + h / 2);
    } else {
      input.days.forEach((d, i) => {
        if (!d.weekend) return;
        ctx.fillStyle = WEEKEND;
        ctx.fillRect(x0 + l.nameW + i * l.dayW, y + 1, l.dayW, h - 1); // keep the line above visible
      });
      ctx.textBaseline = 'top';
      ctx.fillStyle = INK;
      ctx.font = `600 14px ${l.font}`;
      ctx.fillText(fit(ctx, line.row.name, l.nameW - 14), x0 + 8, y + l.pad + 1);
      line.row.cells.forEach((c, i) => {
        const cx = x0 + l.nameW + i * l.dayW + l.dayW / 2;
        ctx.textAlign = 'center';
        c.lines.forEach((text, k) => {
          ctx.font = c.muted ? `italic 500 ${input.compact ? 11 : 13}px ${l.font}` : `600 ${input.compact ? 12 : 14}px ${l.font}`;
          ctx.fillStyle = c.muted ? MUTED : INK;
          ctx.fillText(fit(ctx, text, l.dayW - 6), cx, y + l.pad + 1 + k * l.lineH);
        });
        ctx.textAlign = 'left';
      });
      ctx.textAlign = 'center';
      ctx.font = `700 14px ${l.font}`;
      ctx.fillStyle = INK;
      ctx.fillText(line.row.hours, x0 + tw - l.hoursW / 2, y + l.pad + 1);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + h + 0.5);
    ctx.lineTo(x0 + tw, y + h + 0.5);
    ctx.stroke();
    y += h;
  }
  // column lines
  const top = MARGIN + TITLE_H - 20;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  for (let i = 0; i <= input.days.length; i++) {
    const x = Math.round(x0 + l.nameW + i * l.dayW) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.strokeStyle = LINE_STRONG;
  ctx.strokeRect(x0 + 0.5, top + 0.5, tw, y - top);

  // footer
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 12px ${l.font}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(input.footer, x0, height - MARGIN / 2 - 4);
  if (page.of > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(`${page.no} / ${page.of}`, x0 + tw, height - MARGIN / 2 - 4);
    ctx.textAlign = 'left';
  }
}

function canvasOf(w: number, h: number, scale: number) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  return { c, ctx };
}

/** The whole schedule as one image (sharp on phones: 2× pixels). */
export function schedulePng(input: ExportInput): Promise<Blob> {
  const l = layoutFor(input);
  const all = lines(input, l);
  const w = tableWidth(input, l) + MARGIN * 2;
  const h = TITLE_H - 20 + l.headH + all.reduce((a, x) => a + lineHeight(x, l), 0) + MARGIN + FOOT_H + 20;
  const { c, ctx } = canvasOf(w, h, 2);
  drawPage(ctx, input, l, all, { no: 1, of: 1 }, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
}

/** A4 landscape pages: the table is scaled to the page width, rows never split across pages, heads repeat. */
export function schedulePdf(input: ExportInput): Blob {
  const l = layoutFor(input);
  const all = lines(input, l);
  const w = tableWidth(input, l) + MARGIN * 2;
  const pageH = Math.round((w * 210) / 297);
  const room = pageH - (TITLE_H - 20 + l.headH + MARGIN + FOOT_H);
  const pages: Line[][] = [[]];
  let used = 0;
  for (let i = 0; i < all.length; i++) {
    const x = all[i]!;
    const hNeed = lineHeight(x, l) + (x.kind === 'group' && all[i + 1] ? lineHeight(all[i + 1]!, l) : 0); // keep a division name with its first person
    if (used + hNeed > room && pages[pages.length - 1]!.length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1]!.push(x);
    used += lineHeight(x, l);
  }
  const scale = 2339 / w; // ~200 dpi across 297 mm
  const images = pages.map((part, i) => {
    const { c, ctx } = canvasOf(w, pageH, scale);
    drawPage(ctx, input, l, part, { no: i + 1, of: pages.length }, w, pageH);
    const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1]!;
    return { bytes: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), w: c.width, h: c.height };
  });
  return pdfOfJpegs(images);
}

/** Minimal PDF: one JPEG per A4 landscape page (841.89 × 595.28 pt). */
function pdfOfJpegs(images: { bytes: Uint8Array; w: number; h: number }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(b);
    size += b.length;
  };
  const W = 841.89;
  const H = 595.28;
  const n = images.length;
  // objects: 1 catalog, 2 pages, then per page: page, content, image
  const pageId = (i: number) => 3 + i * 3;
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const obj = (id: number, body: () => void) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${images.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  images.forEach((img, i) => {
    const p = pageId(i);
    obj(p, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${p + 1} 0 R /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> >>`),
    );
    const s = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(p + 1, () => push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`));
    obj(p + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      push(img.bytes);
      push('\nendstream');
    });
  });
  const xref = size;
  const count = 3 + n * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/** Phone: the share sheet (WhatsApp, Messenger…); computer: a normal download. */
export async function deliver(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
