import { apiCache } from './apiCache';
import { navigate } from './router';
/**
 * PWA: service worker registration and clearing cached personal data.
 * The worker (public/sw.js) keeps the app shell and the API answers a person opened, so read
 * material works without internet. Cached API answers belong to one person: cleared on logout and login.
 */
export const DATA_CACHE = 'sa-data-v1';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  });
  // a tapped notification while the app is open: go to its page without reloading
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (d?.type !== 'open' || !d.url) return;
    try {
      const u = new URL(d.url, location.origin);
      if (u.origin === location.origin) navigate(u.pathname + u.search);
    } catch {
      /* ignore */
    }
  });
}

export async function clearPersonalCache(): Promise<void> {
  apiCache.clear();
  try {
    if ('caches' in window) await caches.delete(DATA_CACHE);
  } catch {
    /* storage blocked — nothing cached */
  }
}
