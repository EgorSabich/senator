import { pushRoutes } from './routes/push';
import { liveRoutes } from './routes/live';
import { runNotifications } from './lib/notifyRules';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from './env';
import { securityHeaders } from './middleware/security';
import { ApiError } from './lib/http';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { contentAdminRoutes } from './routes/content';
import { mediaAdminRoutes, mediaPublicRoutes } from './routes/media';
import { menuAdminRoutes, menuRoutes } from './routes/menu';
import { programAdminRoutes } from './routes/programs';
import { learnRoutes } from './routes/learn';
import { terminalRoutes } from './routes/terminal';
import { timeAdminRoutes } from './routes/time';
import { checklistAdminRoutes, checklistRoutes } from './routes/checklists';
import { scheduleAdminRoutes, scheduleRoutes } from './routes/schedule';
import { todayAdminRoutes } from './routes/today';
import { calendarFeedRoutes, recruitmentAdminRoutes } from './routes/recruitment';
import { notificationAdminRoutes } from './routes/notifications';
import { expireCandidates } from './jobs/candidates';
import { requireSameOrigin, requireSession } from './auth/session';
import { runNightlyBackup } from './jobs/backup';
import { anonymizeExpiredUsers } from './jobs/anonymize';
import { expirePunchPhotos, expireChecklistPhotos } from './jobs/punchPhotos';

const app = new Hono<AppEnv>();

app.use('*', securityHeaders);
app.use('/api/*', requireSameOrigin);

/** Liveness + database check. Never exposes data. */
app.get('/api/health', async (c) => {
  let db = false;
  try {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM allergens').first<{ n: number }>();
    db = typeof row?.n === 'number';
  } catch {
    db = false;
  }
  // `secret` only says whether AUTH_SECRET is configured (never its value) — without it every login fails.
  const secret = typeof c.env.AUTH_SECRET === 'string' && c.env.AUTH_SECRET.length >= 32;
  // push keys: only whether they are there and look right (never the values)
  const pub = (c.env.VAPID_PUBLIC_KEY ?? '').trim();
  const priv = (c.env.VAPID_PRIVATE_KEY ?? '').trim();
  const push = !pub && !priv ? 'missing' : !pub ? 'public_missing' : !priv ? 'private_missing' : /^[A-Za-z0-9_-]{86,88}$/.test(pub) && /^[A-Za-z0-9_-]{42,44}$/.test(priv) ? 'ok' : 'invalid';
  return c.json({ ok: db, db, secret, push, env: c.env.APP_ENV, version: __APP_VERSION__ }, db ? 200 : 503);
});

app.route('/api/auth', authRoutes);
const admin = new Hono<AppEnv>();
admin.use('*', requireSession);
admin.route('/', adminRoutes);
admin.route('/', contentAdminRoutes);
admin.route('/', mediaAdminRoutes);
admin.route('/', menuAdminRoutes);
admin.route('/', programAdminRoutes);
admin.route('/', timeAdminRoutes);
admin.route('/', checklistAdminRoutes);
admin.route('/', scheduleAdminRoutes);
admin.route('/', todayAdminRoutes);
admin.route('/', recruitmentAdminRoutes);
admin.route('/', notificationAdminRoutes);
app.route('/api/admin', admin);

// Staff (waiter) views; every path here needs a session.
const staff = new Hono<AppEnv>();
staff.use('/locations/*', requireSession);
staff.use('/menu/*', requireSession);
staff.use('/content/*', requireSession);
staff.use('/checklists/*', requireSession);
staff.use('/push/*', requireSession);
staff.route('/', menuRoutes);
staff.route('/', learnRoutes);
staff.route('/', checklistRoutes);
staff.route('/', scheduleRoutes);
staff.route('/', pushRoutes);
staff.route('/', liveRoutes);
// Time clock phone (role "terminal" reaches nothing else — see requireSession).
const terminal = new Hono<AppEnv>();
terminal.use('*', requireSession);
terminal.route('/', terminalRoutes);
app.route('/api/terminal', terminal);
// Google Calendar subscription: no session, a secret link (routes/recruitment.ts)
app.route('/api', calendarFeedRoutes);
app.route('/api', staff);
app.route('/media', mediaPublicRoutes);

/** Unknown API routes: JSON 404 (the SPA handles every other path). */
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, ...(err.details ? { details: err.details } : {}) }, err.status);
  }
  if (err instanceof HTTPException) return c.json({ error: 'http_error' }, err.status);
  console.error('Unhandled error', err);
  return c.json({ error: 'internal_error' }, 500);
});

const EVERY5 = '*/5 * * * *';

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date(controller.scheduledTime);
    if (controller.cron === EVERY5) {
      // notifications by the settings per division (Panel → Powiadomienia); local tests: everything due at once
      ctx.waitUntil(
        runNotifications(env, controller.scheduledTime, env.APP_ENV === 'development')
          .then((r) => console.log(JSON.stringify({ job: 'notifications', ...r })))
          .catch((e) => console.warn('notifications', String(e))),
      );
      return;
    }
    ctx.waitUntil(
      (async () => {
        await env.DB.prepare(`DELETE FROM push_log WHERE created_at < ?`).bind(now.getTime() - 60 * 86400_000).run().catch(() => undefined);
        const backup = await runNightlyBackup(env, now);
        const anonymized = await anonymizeExpiredUsers(env.DB, now);
        const punchPhotos = await expirePunchPhotos(env.DB, env.PHOTOS, now).catch((e) => `error: ${String(e)}`);
        const checklistPhotos = await expireChecklistPhotos(env.DB, env.PHOTOS, now).catch((e) => `error: ${String(e)}`);
        const candidates = await expireCandidates(env, now).catch((e) => `error: ${String(e)}`);
        console.log(JSON.stringify({ job: 'nightly', backup, anonymized, punchPhotos, checklistPhotos, candidates }));
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

export { app };
