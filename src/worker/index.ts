import { Hono } from 'hono';
import type { Env } from './env';
import { securityHeaders } from './middleware/security';
import { runNightlyBackup } from './jobs/backup';
import { anonymizeExpiredUsers } from './jobs/anonymize';

const app = new Hono<{ Bindings: Env }>();

app.use('*', securityHeaders);

/** Liveness + database check. Never exposes data. */
app.get('/api/health', async (c) => {
  let db = false;
  try {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM allergens').first<{ n: number }>();
    db = typeof row?.n === 'number';
  } catch {
    db = false;
  }
  return c.json({ ok: db, db, env: c.env.APP_ENV }, db ? 200 : 503);
});

/** Unknown API routes: JSON 404 (the SPA handles every other path). */
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(
      (async () => {
        const backup = await runNightlyBackup(env, now);
        const anonymized = await anonymizeExpiredUsers(env.DB, now);
        console.log(JSON.stringify({ job: 'nightly', backup, anonymized }));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };
