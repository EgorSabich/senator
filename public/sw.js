/* Senator Academy service worker: offline reading of material already opened (spec D4, PWA).
   Shell: cache-first for hashed assets, network-first for pages.
   Data: network-first for staff API GETs and /media, kept in a cache cleared on logout/login.
   Never cached: auth (except /api/auth/me), admin API, non-GET, error answers. */
const SHELL = 'sa-shell-v2';
const DATA = 'sa-data-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackKey) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(fallbackKey || request, copy));
    }
    return res;
  } catch (err) {
    const hit = await caches.match(fallbackKey || request, { cacheName });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { cacheName });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(request, copy));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // Only "who am I" from auth is kept, so the app can open offline; admin data is never cached.
  if ((p.startsWith('/api/auth/') && p !== '/api/auth/me') || p.startsWith('/api/admin/') || p === '/api/health') return;
  if (p.startsWith('/api/')) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (p.startsWith('/media/')) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (p.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, '/'));
  }
});
