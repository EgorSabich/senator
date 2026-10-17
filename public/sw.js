/* Senator Academy service worker: offline reading of material already opened (spec D4, PWA).
   Shell: cache-first for hashed assets, network-first for pages.
   Data: network-first for staff API GETs and /media, kept in a cache cleared on logout/login.
   Never cached: auth (except /api/auth/me), admin API, non-GET, error answers. */
const BUILD = '__SW_BUILD__'; // replaced at build time: a new file on every deploy
const SHELL = `sa-shell-${BUILD}`; // v4: drops files saved by mistake as a page (blank screen after a deploy)
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
  let updated = false; // an older version was here before (not the very first visit)
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const old = keys.filter((k) => k !== SHELL && k !== DATA);
        updated = old.some((k) => k.startsWith('sa-shell-'));
        return Promise.all(old.map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim())
      // Screens opened with an older version reload themselves, so nobody keeps old code after a deploy
      // (a home-screen app on iPhone can stay open for days). No reinstall needed.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((wins) => {
        // not awaited: the reload goes through this worker, which must finish activating first
        if (updated) for (const w of wins) if (w.navigate) w.navigate(w.url).catch(() => undefined);
      }),
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

/** App page: from the server, past the browser's HTTP cache; the saved copy only when offline. */
async function page(req) {
  try {
    const res = await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put('/', copy));
    }
    return res;
  } catch (err) {
    const hit = await caches.match('/', { cacheName: SHELL });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { cacheName });
  if (hit) return hit;
  const res = await fetch(request);
  // a script that no longer exists comes back as the app page (SPA fallback): never keep that
  const isPage = (res.headers.get('content-type') || '').includes('text/html');
  if (res.ok && !isPage) {
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
  // The time clock must see the real connection state: never answer it from the cache.
  if (p.startsWith('/api/terminal/')) return;
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
    // always the newest page from the server (never the browser's HTTP cache); the saved copy only without internet
    event.respondWith(page(req));
  }
});
