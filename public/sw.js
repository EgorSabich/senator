/* Senator Academy service worker: offline reading of material already opened (spec D4, PWA).
   Shell: cache-first for hashed assets, network-first for pages.
   Data: network-first for staff API GETs and /media, kept in a cache cleared on logout/login.
   Never cached: auth (except /api/auth/me), admin API, non-GET, error answers. */
const SHELL = 'sa-shell-v4';
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

async function shellFirst(request, event) {
  const update = fetch(request)
    .then(async (res) => {
      if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
        const c = await caches.open(SHELL);
        await c.put('/', res.clone());
        precacheAssets(await res.clone().text());
      }
      return res;
    })
    .catch(() => null);
  const hit = await caches.match('/', { cacheName: SHELL });
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return (await update) || Response.error();
}

/** Scripts and styles named in the page: cached right away, so the next start needs no network for them. */
function precacheAssets(html) {
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (!urls.length) return;
  caches.open(SHELL).then(async (c) => {
    for (const u of urls) if (!(await c.match(u))) await c.add(u).catch(() => undefined);
  });
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
  // The time clock must see the real connection state: never answer it from the cache.
  if (p.startsWith('/api/terminal/')) return;
  // live change checks and push keys always come from the network
  if (p.endsWith('/changes') || p.startsWith('/api/push/')) return;
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
    // the app opens at once from the phone (2026-10-17); the page is refreshed in the background for the next start.
    // A new version shows „Jest nowa wersja” and its button loads it (live.ts → updateApp).
    event.respondWith(shellFirst(req, event));
  }
});

// Push notifications (2026-10-17): Grafik, tomorrow's shift, documents to read, days-off deadline.
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  const title = msg.title ? `Senator · ${msg.title}` : 'Senator';
  // an open app refreshes what it shows (new schedule, new document)
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'refresh' })));
  event.waitUntil(
    self.registration.showNotification(title, {
      body: msg.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: msg.tag || undefined,
      renotify: Boolean(msg.tag),
      data: { url: msg.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          // the open app moves to the page itself (no reload)
          c.postMessage({ type: 'open', url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
