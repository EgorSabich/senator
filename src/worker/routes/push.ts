/** Notifications on this device (2026-10-17): the public key, switching on/off, a test message. */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { badRequest, newId, readJson } from '../lib/http';
import { notify, vapidKeys } from '../lib/notify';

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get('/push/key', (c) => c.json({ publicKey: vapidKeys(c.env)?.publicKey ?? null }));

const B64URL = /^[A-Za-z0-9_-]+$/;

pushRoutes.post('/push/subscribe', async (c) => {
  if (c.var.user.role === 'terminal') throw badRequest('invalid_input');
  const body = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(c.req.raw);
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
  let host = '';
  try {
    const u = new URL(endpoint);
    // local tests use a fake push service on localhost; everywhere else only https
    const local = c.env.APP_ENV === 'development' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (u.protocol !== 'https:' && !local) throw new Error('http');
    host = u.host;
  } catch {
    throw badRequest('invalid_input');
  }
  if (!host || endpoint.length > 1000 || !B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100 || !B64URL.test(auth) || auth.length < 16 || auth.length > 30) throw badRequest('invalid_input');
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(newId('ps'), c.var.user.id, endpoint, p256dh, auth, Date.now())
    .run();
  return c.json({ ok: true });
});

pushRoutes.post('/push/unsubscribe', async (c) => {
  const body = await readJson<{ endpoint?: unknown }>(c.req.raw);
  if (typeof body.endpoint === 'string') await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`).bind(body.endpoint, c.var.user.id).run();
  return c.json({ ok: true });
});

/** „Wyślij próbne” in Konto: shows the person that it works on this phone. */
pushRoutes.post('/push/test', async (c) => {
  const r = await notify(c.env, [c.var.user.id], () => ({ title: 'Próba', body: 'Powiadomienia działają na tym urządzeniu.', url: '/konto', tag: 'test' }));
  return c.json(r);
});
