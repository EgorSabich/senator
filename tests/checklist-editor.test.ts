import { describe, expect, it } from 'vitest';
import { docToModel, modelToDoc } from '../src/client/admin/checklistModel';
import { checklistItems } from '../src/shared/checklist';

const li = (t: string, nested?: unknown) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }, ...(nested ? [nested] : [])] });
const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Wstęp' }] },
    { type: 'bulletList', content: [li('Bez sekcji')] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sala' }] },
    { type: 'orderedList', content: [li('Stoły', { type: 'bulletList', content: [li('Świece')] }), li('Krzesła')] },
  ],
};

describe('checklist editor model', () => {
  it('keeps keys and photo flags through a round trip', () => {
    const keys = checklistItems(doc as never).map((k) => k.key);
    const m = docToModel(doc as never, [keys[2]!]);
    expect(m.sections.map((s) => [s.name, s.items.map((i) => i.text)])).toEqual([
      ['', ['Bez sekcji']],
      ['Sala', ['Stoły', 'Świece', 'Krzesła']],
    ]);
    expect(m.sections[1]!.items.map((i) => i.photo)).toEqual([false, true, false]);
    expect(m.extra).toHaveLength(1);
    const back = modelToDoc(m);
    expect(checklistItems(back as never).map((k) => k.key)).toEqual(keys);
  });
});
