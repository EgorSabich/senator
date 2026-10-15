import { describe, expect, it } from 'vitest';
import { businessDate, dateRange, formatDuration, warsawDate, warsawToMs } from '../src/shared/time';
import { checklistItems } from '../src/shared/checklist';

describe('business day (06:00–06:00 Warsaw)', () => {
  it('a shift ending at 02:00 belongs to the evening before', () => {
    expect(businessDate(warsawToMs('2026-10-16', '02:00'))).toBe('2026-10-15');
    expect(businessDate(warsawToMs('2026-10-16', '06:00'))).toBe('2026-10-16');
    expect(businessDate(warsawToMs('2026-10-15', '08:00'))).toBe('2026-10-15');
  });
  it('converts Warsaw wall time in summer and winter', () => {
    expect(new Date(warsawToMs('2026-07-01', '12:00')).toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(new Date(warsawToMs('2026-12-01', '12:00')).toISOString()).toBe('2026-12-01T11:00:00.000Z');
    expect(warsawDate(warsawToMs('2026-10-25', '23:30'))).toBe('2026-10-25');
  });
  it('formats durations and ranges', () => {
    expect(formatDuration(495)).toBe('8:15');
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('checklist items', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const li = (text: string) => ({ type: 'listItem', content: [p(text)] });
  const doc = {
    type: 'doc',
    content: [
      { type: 'callout', content: [{ type: 'bulletList', content: [li('note, not a task')] }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sala' }] },
      { type: 'bulletList', content: [li('Wytrzyj stoły.'), li('Ustaw krzesła.')] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Taras' }] },
      { type: 'orderedList', content: [li('Wytrzyj stoły.')] },
    ],
  };
  it('takes list items with their section and skips callouts', () => {
    const items = checklistItems(doc);
    expect(items.map((i) => `${i.section}: ${i.text}`)).toEqual(['Sala: Wytrzyj stoły.', 'Sala: Ustaw krzesła.', 'Taras: Wytrzyj stoły.']);
    expect(new Set(items.map((i) => i.key)).size).toBe(3);
  });
  it('keeps keys when other items change', () => {
    const before = checklistItems(doc)[1]!.key;
    const edited = structuredClone(doc);
    (edited.content[2] as { content: unknown[] }).content.unshift(li('Nowy punkt.'));
    expect(checklistItems(edited).find((i) => i.text === 'Ustaw krzesła.')!.key).toBe(before);
  });
});
