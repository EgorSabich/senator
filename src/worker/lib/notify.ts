/**
 * Notifications (2026-10-17): who gets what. Only active employees and leaders who switched notifications on;
 * a reminder (kind + ref) goes out once. Without VAPID secrets nothing is sent and nothing breaks.
 */
import type { Env } from '../env';
import { sendPush, type PushMessage, type VapidKeys } from './webpush';

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY.trim(), privateKey: env.VAPID_PRIVATE_KEY.trim(), subject: (env.VAPID_SUBJECT || 'mailto:kontakt@senator.pl').trim() };
}

/** How many of these people will see a notification (they have at least one device switched on). */
export async function withPush(db: D1Database, userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    const { results } = await db
      .prepare(`SELECT DISTINCT user_id AS u FROM push_subscriptions WHERE user_id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ u: string }>();
    for (const r of results) out.add(r.u);
  }
  return out;
}

export interface NotifyResult {
  people: number;
  devices: number;
  delivered: number;
}

/**
 * Sends `message(userId)` to every device of the given people. With `once`, a person gets each kind+ref only once.
 * Gone subscriptions (404/410) are removed. Never throws.
 */
export async function notify(env: Env, userIds: string[], message: (userId: string) => PushMessage | null, once?: { kind: string; ref: string }): Promise<NotifyResult> {
  const result: NotifyResult = { people: 0, devices: 0, delivered: 0 };
  const keys = vapidKeys(env);
  if (!keys || !userIds.length) return result;
  const db = env.DB;
  const ids = [...new Set(userIds)];
  const subs: { id: string; userId: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT s.id, s.user_id AS userId, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id
         WHERE u.status = 'active' AND s.user_id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(...chunk)
      .all<{ id: string; userId: string; endpoint: string; p256dh: string; auth: string }>();
    subs.push(...results);
  }
  const people = [...new Set(subs.map((s) => s.userId))];
  const send = new Set<string>();
  for (const u of people) {
    if (once) {
      const r = await db.prepare(`INSERT INTO push_log (user_id, kind, ref) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(u, once.kind, once.ref).run();
      if (!r.meta.changes) continue;
    }
    send.add(u);
  }
  const todo = subs.filter((s) => send.has(s.userId));
  result.people = send.size;
  result.devices = todo.length;
  const gone: string[] = [];
  const ok: string[] = [];
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (s) => {
        const msg = message(s.userId);
        if (!msg) return;
        try {
          const status = await sendPush(s, msg, keys);
          if (status === 404 || status === 410) gone.push(s.id);
          else if (status >= 200 && status < 300) {
            ok.push(s.id);
            result.delivered++;
          } else console.warn('push', status, new URL(s.endpoint).host);
        } catch (e) {
          console.warn('push failed', String(e));
        }
      }),
    );
  }
  const now = Date.now();
  const stmts = [...gone.map((id) => db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id)), ...ok.map((id) => db.prepare(`UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?`).bind(now, id))];
  if (stmts.length) await db.batch(stmts).catch(() => undefined);
  return result;
}
