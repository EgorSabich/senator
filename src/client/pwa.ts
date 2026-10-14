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
}

export async function clearPersonalCache(): Promise<void> {
  try {
    if ('caches' in window) await caches.delete(DATA_CACHE);
  } catch {
    /* storage blocked — nothing cached */
  }
}
