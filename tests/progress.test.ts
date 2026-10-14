import { describe, expect, it } from 'vitest';
import { itemProgress, moduleStates, programPercent, snippet, type ModuleInput } from '../src/shared/progress';
import { foldPolish } from '../src/shared/text';

const v = (n: number, level: 'cosmetic' | 'clarification' | 'significant' = 'cosmetic') => ({ id: `v${n}`, versionNo: n, changeLevel: level });

describe('itemProgress', () => {
  it('new until acknowledged', () => {
    expect(itemProgress([v(1, 'significant')], new Set()).status).toBe('new');
  });
  it('done after acknowledging the current version', () => {
    expect(itemProgress([v(1, 'significant'), v(2)], new Set(['v2']))).toEqual({ status: 'done', updated: false, ackedVersionNo: 2 });
  });
  it('cosmetic change keeps it done, clarification marks updated', () => {
    expect(itemProgress([v(1, 'significant'), v(2, 'cosmetic')], new Set(['v1']))).toMatchObject({ status: 'done', updated: false });
    expect(itemProgress([v(1, 'significant'), v(2, 'clarification')], new Set(['v1']))).toMatchObject({ status: 'done', updated: true });
  });
  it('significant change sends it back to review until the new version is read', () => {
    const vs = [v(1, 'significant'), v(2, 'clarification'), v(3, 'significant'), v(4, 'cosmetic')];
    expect(itemProgress(vs, new Set(['v1'])).status).toBe('review');
    expect(itemProgress(vs, new Set(['v1', 'v3'])).status).toBe('done');
  });
});

const mod = (id: string, statuses: ('new' | 'done' | 'review')[], extra: Partial<ModuleInput> = {}): ModuleInput => ({
  id,
  isMandatory: true,
  unlockRule: 'open',
  unlockAfterModuleId: null,
  items: statuses.map((status) => ({ isMandatory: true, status })),
  ...extra,
});

describe('moduleStates', () => {
  it('after_module locks until the previous module is complete', () => {
    const a = mod('a', ['done', 'new']);
    const b = mod('b', ['new'], { unlockRule: 'after_module', unlockAfterModuleId: 'a' });
    expect(moduleStates([a, b])[1]!.locked).toBe(true);
    expect(moduleStates([mod('a', ['done', 'done']), b])[1]!.locked).toBe(false);
  });
  it('review is not done', () => {
    expect(moduleStates([mod('a', ['review'])])[0]!.complete).toBe(false);
  });
  it('after_all_mandatory ignores optional modules', () => {
    const a = mod('a', ['done']);
    const opt = mod('o', ['new'], { isMandatory: false });
    const fin = mod('f', ['new'], { unlockRule: 'after_all_mandatory' });
    expect(moduleStates([a, opt, fin])[2]!.locked).toBe(false);
    expect(moduleStates([mod('a', ['new']), opt, fin])[2]!.locked).toBe(true);
  });
  it('optional items do not block completion', () => {
    const m: ModuleInput = { ...mod('a', []), items: [{ isMandatory: true, status: 'done' }, { isMandatory: false, status: 'new' }] };
    expect(moduleStates([m])[0]).toMatchObject({ complete: true, done: 1, total: 1 });
  });
});

describe('programPercent', () => {
  it('counts mandatory items in mandatory modules only', () => {
    expect(programPercent([mod('a', ['done', 'new', 'new']), mod('o', ['new'], { isMandatory: false })])).toBe(33);
    expect(programPercent([])).toBe(100);
  });
});

describe('snippet', () => {
  it('finds folded terms and marks them in the original text', () => {
    const text = 'Zupa na zakwasie. Żurek podajemy w misce, z jajkiem i białą kiełbasą, zawsze gorący.';
    const s = snippet(text, ['zurek', 'kielbasa'], foldPolish, 30);
    const marked = s.marks.map(([a, b]) => s.text.slice(a, b));
    expect(marked).toEqual(['Żurek', 'kiełbasą']);
  });
  it('falls back to the beginning when nothing matches', () => {
    expect(snippet('Krótki tekst', ['xyz'], foldPolish).text).toBe('Krótki tekst');
  });
});
