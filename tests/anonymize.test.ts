import { describe, expect, it } from 'vitest';
import { anonymizationCutoff } from '../src/worker/jobs/anonymize';
import { backupDay } from '../src/worker/jobs/backup';

describe('anonymizationCutoff', () => {
  it('is exactly 2 calendar years back', () => {
    const now = new Date('2028-10-14T01:30:00Z');
    expect(new Date(anonymizationCutoff(now)).toISOString()).toBe('2026-10-14T01:30:00.000Z');
  });
});

describe('backupDay', () => {
  it('names the folder by UTC date', () => {
    expect(backupDay(new Date('2026-10-15T01:30:00Z'))).toBe('2026-10-15');
  });
});
