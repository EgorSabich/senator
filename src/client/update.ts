/**
 * Keeping phones on the newest version (2026-10-17). An app added to the home screen can stay open for days
 * and keep running the old code; after a deploy the old screens' files are gone, which showed a blank page.
 * - lazyPage(): if a screen's file cannot be loaded (deploy in between), reload once instead of a blank page;
 * - watchForUpdates(): asks the server for its version when the app comes back to the screen and every
 *   10 minutes; a new version reloads the app when it returns to the screen, or shows a small bar right away.
 */
import { lazy, type ComponentType } from 'react';

const RELOADED = 'sa.reloadedFor';

function reloadOnce(reason: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED) === reason) return false;
    sessionStorage.setItem(RELOADED, reason);
  } catch {
    /* storage blocked: still reload, the browser stops loops on its own */
  }
  location.reload();
  return true;
}

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      const C = await load();
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        /* none */
      }
      return { default: C };
    } catch (e) {
      if (navigator.onLine && reloadOnce(`chunk:${__APP_VERSION__}`)) return new Promise<never>(() => undefined);
      throw e;
    }
  });
}

async function serverVersion(): Promise<string | null> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    const j = (await r.json()) as { version?: string };
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  }
}

let watching = false;
export function watchForUpdates(onNewVersion: () => void): void {
  if (watching) return;
  watching = true;
  let pending = false;
  const check = async () => {
    if (pending) return;
    const v = await serverVersion();
    if (!v || v === __APP_VERSION__) return;
    pending = true;
    // fresh service worker too, so the new files are taken from the network
    try {
      await (await navigator.serviceWorker?.getRegistration())?.update();
    } catch {
      /* none */
    }
    onNewVersion();
  };
  const swCheck = () => navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void swCheck();
    if (pending) {
      reloadOnce(`version:${__APP_VERSION__}`);
      return;
    }
    void check();
  });
  window.setInterval(() => document.visibilityState === 'visible' && void check(), 10 * 60_000);
  window.setTimeout(() => void check(), 5_000);
}

export function reloadNow(): void {
  location.reload();
}
