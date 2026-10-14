import { describe, expect, it } from 'vitest';
import { comparePl, foldPolish, normalizeLogin, proposeLogin } from '../src/shared/text';

describe('foldPolish', () => {
  it('folds every Polish letter, including ł', () => {
    expect(foldPolish('Zażółć gęślą jaźń ŁOSOŚ')).toBe('zazolc gesla jazn losos');
  });
  it('lets "zurek" match "żurek"', () => {
    expect(foldPolish('Żurek')).toBe(foldPolish('zurek'));
  });
});

describe('logins', () => {
  it('ignores case and Polish letters', () => {
    expect(normalizeLogin('Łukasz.Żółć')).toBe('lukasz.zolc');
    expect(normalizeLogin('  ANNA.Kowalska ')).toBe('anna.kowalska');
  });
  it('proposes imie.nazwisko', () => {
    expect(proposeLogin('Anna', 'Kowalska')).toBe('anna.kowalska');
    expect(proposeLogin('Łukasz', 'Wiśniewski-Nowak')).toBe('lukasz.wisniewski-nowak');
  });
});

describe('comparePl', () => {
  it('sorts by the Polish alphabet', () => {
    const words = ['łosoś', 'lody', 'śledź', 'sałatka', 'ćwikła', 'cezar', 'zupa', 'żurek'];
    expect([...words].sort(comparePl)).toEqual(['cezar', 'ćwikła', 'lody', 'łosoś', 'sałatka', 'śledź', 'zupa', 'żurek']);
  });
});
