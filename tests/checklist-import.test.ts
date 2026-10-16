import { describe, expect, it } from 'vitest';
import { checklistItems } from '../src/shared/checklist';
import { checklistsToBundle } from '../src/shared/contentBundle';
import type { RtNode } from '../src/shared/richtext';

describe('checklist JSON import (D42)', () => {
  it('ignores other formats', () => {
    expect(checklistsToBundle({ format: 'senator-content-bundle', items: [] })).toBeNull();
    expect(checklistsToBundle(null)).toBeNull();
  });

  it('builds a draft checklist with sections, positions and mode', () => {
    const r = checklistsToBundle({
      format: 'senator-checklists',
      checklists: [
        {
          title: '  Zamknięcie   zmiany — kelnerzy ',
          positions: ['waiter'],
          items: ['Sprawdź rewir'],
          sections: [
            { title: 'Sala', items: ['Wytrzyj stoły', ' ', 'Ustaw krzesła'] },
            { title: 'Pusta', items: [] },
          ],
        },
      ],
    })!;
    expect(r.errors).toEqual([]);
    const it0 = r.bundle.items[0]!;
    expect(it0).toMatchObject({ kind: 'checklist', title: 'Zamknięcie zmiany — kelnerzy', positions: ['waiter'], checklistMode: 'individual', requiresAck: false });
    expect(it0.importKey).toBe('checklist:zamkniecie-zmiany-kelnerzy');
    expect(checklistItems(it0.body as RtNode).map((i) => [i.section, i.text])).toEqual([
      [null, 'Sprawdź rewir'],
      ['Sala', 'Wytrzyj stoły'],
      ['Sala', 'Ustaw krzesła'],
    ]);
  });

  it('explains mistakes in Polish', () => {
    const r = checklistsToBundle({
      format: 'senator-checklists',
      checklists: [{ title: '' }, { title: 'A', positions: ['kelner'], items: ['x'] }, { title: 'B', mode: 'grupowa', items: ['x'] }, { title: 'C', sections: [] }],
    })!;
    expect(r.errors).toHaveLength(4);
    expect(r.errors[1]).toContain('nieznane stanowisko kelner');
    expect(r.bundle.items).toHaveLength(0);
  });
});
