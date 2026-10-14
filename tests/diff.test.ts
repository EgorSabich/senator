import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/client/editor/diff';

describe('diffLines', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });
  it('handles empty sides', () => {
    expect(diffLines('', 'a')).toEqual([
      { kind: 'del', text: '' },
      { kind: 'add', text: 'a' },
    ]);
  });
});
