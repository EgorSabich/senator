/**
 * Learning progress rules (spec D2, D3, E). Pure functions — used by the server and unit-tested.
 *
 * A person "knows" a content item when they acknowledged one of its versions
 * (lesson: read to the end; document: "Zapoznałem(-am) się" + "Potwierdzam").
 * After a newer version:
 *   cosmetic      → nothing changes;
 *   clarification → still done, marked "Zaktualizowano";
 *   significant   → "Do powtórki" until the current version is acknowledged.
 */
export type ItemStatus = 'new' | 'done' | 'review';

export interface VersionRef {
  id: string;
  versionNo: number;
  changeLevel: 'cosmetic' | 'clarification' | 'significant';
}

export interface ItemProgress {
  status: ItemStatus;
  updated: boolean;
  /** versionNo the person last acknowledged, if any. */
  ackedVersionNo: number | null;
}

export function itemProgress(versions: VersionRef[], ackedVersionIds: ReadonlySet<string>): ItemProgress {
  const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  let acked: VersionRef | null = null;
  for (const v of sorted) if (ackedVersionIds.has(v.id)) acked = v;
  if (!acked) return { status: 'new', updated: false, ackedVersionNo: null };
  const later = sorted.filter((v) => v.versionNo > acked!.versionNo);
  if (later.some((v) => v.changeLevel === 'significant')) return { status: 'review', updated: false, ackedVersionNo: acked.versionNo };
  return { status: 'done', updated: later.some((v) => v.changeLevel === 'clarification'), ackedVersionNo: acked.versionNo };
}

export interface ModuleInput {
  id: string;
  isMandatory: boolean;
  unlockRule: 'open' | 'after_module' | 'after_all_mandatory';
  unlockAfterModuleId: string | null;
  items: { isMandatory: boolean; status: ItemStatus }[];
}

export interface ModuleState {
  id: string;
  done: number;
  total: number;
  complete: boolean;
  locked: boolean;
}

/** Items that decide completion: the mandatory ones, or all when none is mandatory. */
function required(m: ModuleInput) {
  const mand = m.items.filter((i) => i.isMandatory);
  return mand.length ? mand : m.items;
}

export function moduleStates(modules: ModuleInput[]): ModuleState[] {
  const complete = new Map(modules.map((m) => [m.id, required(m).every((i) => i.status === 'done')]));
  return modules.map((m) => {
    const req = required(m);
    let locked = false;
    if (m.unlockRule === 'after_module' && m.unlockAfterModuleId && complete.has(m.unlockAfterModuleId)) {
      locked = !complete.get(m.unlockAfterModuleId);
    } else if (m.unlockRule === 'after_all_mandatory') {
      locked = modules.some((o) => o.id !== m.id && o.isMandatory && !complete.get(o.id));
    }
    return { id: m.id, done: req.filter((i) => i.status === 'done').length, total: req.length, complete: complete.get(m.id)!, locked };
  });
}

/** Share of mandatory work done in mandatory modules, 0–100 (100 when there is nothing mandatory). */
export function programPercent(modules: ModuleInput[]): number {
  let total = 0;
  let done = 0;
  for (const m of modules.filter((x) => x.isMandatory)) {
    for (const i of required(m)) {
      total += 1;
      if (i.status === 'done') done += 1;
    }
  }
  return total === 0 ? 100 : Math.floor((done / total) * 100);
}

/**
 * Search snippet built on the original text (with Polish letters), matching folded terms.
 * Returns the excerpt and [start, end) ranges to highlight inside it.
 */
export function snippet(text: string, terms: string[], fold: (s: string) => string, radius = 70): { text: string; marks: [number, number][] } {
  // Fold char by char so indexes in the folded string match the original.
  const folded = Array.from(text, (ch) => {
    const f = fold(ch);
    return f.length === 1 ? f : ch.toLowerCase().slice(0, 1) || ' ';
  }).join('');
  const chars = Array.from(text);
  const words = terms.map((t) => fold(t)).filter(Boolean);
  let first = -1;
  for (const w of words) {
    const i = folded.indexOf(w);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = first < 0 ? 0 : Math.max(0, first - radius);
  const end = Math.min(chars.length, (first < 0 ? 0 : first) + radius * 2);
  let s = start;
  if (s > 0) {
    const sp = chars.slice(s, s + 20).indexOf(' ');
    if (sp >= 0) s += sp + 1;
  }
  const excerptFolded = Array.from(folded).slice(s, end).join('');
  const prefix = s > 0 ? '… ' : '';
  const suffix = end < chars.length ? ' …' : '';
  const marks: [number, number][] = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const i = excerptFolded.indexOf(w, from);
      if (i < 0) break;
      marks.push([prefix.length + i, prefix.length + i + w.length]);
      from = i + w.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([...m]);
  }
  return { text: prefix + chars.slice(s, end).join('') + suffix, marks: merged };
}
