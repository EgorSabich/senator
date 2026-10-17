/**
 * Last API answers per path. A page opened again — or reached by swiping back — shows them at once, fresh data follows.
 *
 * 2026-10-17 (owner: „мгновенно из кэша”): the staff app's answers are also kept on the phone (IndexedDB), so the app
 * opens with what was there last time — no loader, then it refreshes in the background. Panel (/api/admin/…) answers
 * stay in memory only: they hold other people's data. Everything is removed on logout and on login (another person).
 */
const DB = 'sa-cache';
const STORE = 'answers';
const KEY = 'snapshot';
const MAX_ENTRIES = 400;

const persistable = (path: string) => path.startsWith('/api/') && !path.startsWith('/api/admin/') && !path.startsWith('/api/terminal/') && !path.startsWith('/api/tests/') && !path.endsWith('/remote') && !path.endsWith('/changes');

class PersistentMap extends Map<string, unknown> {
  override set(key: string, value: unknown): this {
    super.set(key, value);
    if (persistable(key)) schedule();
    return this;
  }
  override delete(key: string): boolean {
    const r = super.delete(key);
    if (persistable(key)) schedule();
    return r;
  }
  override clear(): void {
    super.clear();
    void wipe();
  }
}

export const apiCache = new PersistentMap();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let timer: number | null = null;
function schedule() {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    void save();
  }, 700);
}

async function save() {
  const entries = [...apiCache.entries()].filter(([k]) => persistable(k)).slice(-MAX_ENTRIES);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ savedAt: Date.now(), entries }, KEY);
    await new Promise((r) => {
      tx.oncomplete = tx.onerror = tx.onabort = r;
    });
  } catch {
    /* storage full or blocked — memory still works */
  } finally {
    db.close();
  }
}

async function wipe() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    await new Promise((r) => {
      tx.oncomplete = tx.onerror = tx.onabort = r;
    });
  } catch {
    /* nothing to remove */
  } finally {
    db.close();
  }
}

/** Before the first render: put the saved answers back into memory (gives up after `ms`, the app then loads normally). */
export async function hydrateCache(ms = 400): Promise<void> {
  const read = (async () => {
    const db = await open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      const snap = await new Promise<{ entries: [string, unknown][] } | undefined>((r) => {
        req.onsuccess = () => r(req.result as { entries: [string, unknown][] } | undefined);
        req.onerror = () => r(undefined);
      });
      for (const [k, v] of snap?.entries ?? []) if (!Map.prototype.has.call(apiCache, k)) Map.prototype.set.call(apiCache, k, v);
    } catch {
      /* unreadable — start empty */
    } finally {
      db.close();
    }
  })();
  await Promise.race([read, new Promise((r) => setTimeout(r, ms))]);
}
