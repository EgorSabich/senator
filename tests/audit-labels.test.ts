// Every action written to the audit log has a Polish label in Dziennik zmian (2026-10-18: raw codes were showing).
import { describe, expect, it } from 'vitest';
import { pl } from '../src/client/i18n/pl';

const sources = import.meta.glob('../src/worker/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('audit labels', () => {
  it('has a label for every action', () => {
    const actions = new Set<string>();
    for (const text of Object.values(sources))
      for (const line of text.split('\n'))
        if (line.includes('action:')) for (const m of line.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) actions.add(m[1]!);
    const missing = [...actions].filter((a) => !pl.admin.audit.actions[a]);
    expect(missing).toEqual([]);
    expect(actions.size).toBeGreaterThan(50);
  });
});
