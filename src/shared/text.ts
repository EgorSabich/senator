/**
 * Polish text helpers shared by the worker and the client.
 *
 * Search: SQLite FTS5 `remove_diacritics` does not fold "ł" (it has no Unicode
 * decomposition), so we fold Polish text ourselves before indexing and before
 * querying. "łosoś", "losos" and "ŁOSOŚ" all become "losos".
 */

const EXTRA_FOLD: Record<string, string> = { ł: 'l', Ł: 'l' };

export function foldPolish(input: string): string {
  return input
    .replace(/[łŁ]/g, (ch) => EXTRA_FOLD[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** Login as stored and compared: folded, trimmed, only [a-z0-9._-]. */
export function normalizeLogin(input: string): string {
  return foldPolish(input.trim()).replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
}

/** Proposed login for a new employee: "Łukasz Żółć" → "lukasz.zolc". */
export function proposeLogin(firstName: string, lastName: string): string {
  return normalizeLogin(`${firstName}.${lastName}`).replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
}

const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

/** Sort by the Polish alphabet (ą after a, ł after l, ś after s …). */
export function comparePl(a: string, b: string): number {
  return collator.compare(a, b);
}
