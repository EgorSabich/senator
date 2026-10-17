/**
 * Reading period for mandatory documents (owner, 2026-10-17). Each person has N days (Lokale → „Dni na zapoznanie się”):
 * - a new person: from their first sign-in;
 * - a new or significantly changed document: from its publication.
 * After the period the person's Grafik (view and days off) is locked until they read everything that is overdue.
 * Time tracking is never affected.
 */
import { itemProgress, type VersionRef } from '../../shared/progress';
import { isVisibleFor, MANDATORY_KINDS, visibleContent } from './learning';

const DAY = 86400_000;

export interface DocDeadline {
  id: string;
  title: string;
  status: 'new' | 'review';
  due: number;
  overdue: boolean;
}
export interface PersonDeadlines {
  items: DocDeadline[];
  /** earliest missed deadline (Grafik locked since) or null */
  lockedSince: number | null;
  /** earliest coming deadline among items not overdue yet */
  nextDue: number | null;
}

export async function ackDaysOf(db: D1Database, locId: string): Promise<number> {
  const r = await db.prepare(`SELECT ack_days AS d FROM locations WHERE id = ?`).bind(locId).first<{ d: number }>();
  return r?.d ?? 3;
}

/** Deadlines of many people at once (a few queries, whatever the number of people). */
export async function deadlinesFor(
  db: D1Database,
  locId: string,
  people: { id: string; positions: string[]; firstLoginAt: number | null }[],
  now = Date.now(),
): Promise<Map<string, PersonDeadlines>> {
  const out = new Map<string, PersonDeadlines>();
  const ackDays = await ackDaysOf(db, locId);
  const docs = (await visibleContent(db, locId, null, MANDATORY_KINDS)).filter((d) => d.requiresAck && !d.externalUrl);
  if (!docs.length || !people.length) {
    for (const p of people) out.set(p.id, { items: [], lockedSince: null, nextDue: null });
    return out;
  }
  const versions = new Map<string, (VersionRef & { createdAt: number })[]>();
  const acked = new Map<string, Set<string>>(); // userId → version ids
  const ids = docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const marks = chunk.map(() => '?').join(', ');
    const [v, a] = await db.batch([
      db
        .prepare(`SELECT id, content_item_id AS itemId, version_no AS versionNo, change_level AS changeLevel, created_at AS createdAt FROM content_versions WHERE content_item_id IN (${marks})`)
        .bind(...chunk),
      db.prepare(`SELECT user_id AS userId, version_id AS versionId FROM content_acknowledgements WHERE content_item_id IN (${marks})`).bind(...chunk),
    ]);
    for (const r of v!.results as (VersionRef & { itemId: string; createdAt: number })[]) (versions.get(r.itemId) ?? versions.set(r.itemId, []).get(r.itemId)!).push(r);
    for (const r of a!.results as { userId: string; versionId: string }[]) (acked.get(r.userId) ?? acked.set(r.userId, new Set()).get(r.userId)!).add(r.versionId);
  }
  for (const p of people) {
    const items: DocDeadline[] = [];
    if (p.firstLoginAt) {
      for (const d of docs) {
        if (!isVisibleFor(d.positions, p.positions) || !isVisibleFor(d.tabPositions, p.positions)) continue;
        const vs = (versions.get(d.id) ?? []).sort((a, b) => a.versionNo - b.versionNo);
        if (!vs.length) continue;
        const prog = itemProgress(vs, acked.get(p.id) ?? new Set());
        if (prog.status === 'done') continue;
        // from first sign-in or the document's publication — whichever is later; a change: from the first significant version after the read one
        const since =
          prog.status === 'new'
            ? Math.max(p.firstLoginAt, vs[0]!.createdAt)
            : Math.max(p.firstLoginAt, vs.find((v) => v.versionNo > (prog.ackedVersionNo ?? 0) && v.changeLevel === 'significant')?.createdAt ?? vs[vs.length - 1]!.createdAt);
        const due = since + ackDays * DAY;
        items.push({ id: d.id, title: d.title, status: prog.status, due, overdue: due < now });
      }
    }
    items.sort((a, b) => a.due - b.due);
    const over = items.filter((i) => i.overdue);
    const coming = items.filter((i) => !i.overdue);
    out.set(p.id, { items, lockedSince: over.length ? over[0]!.due : null, nextDue: coming.length ? coming[0]!.due : null });
  }
  return out;
}

/** One employee (staff screens). Managers and the owner are never locked. */
export async function myDeadlines(db: D1Database, locId: string, user: { id: string; role: string }, positions: string[] | null): Promise<PersonDeadlines> {
  const empty = { items: [], lockedSince: null, nextDue: null };
  if (user.role !== 'employee' || !positions) return empty;
  const u = await db.prepare(`SELECT first_login_at AS f FROM users WHERE id = ?`).bind(user.id).first<{ f: number | null }>();
  return (await deadlinesFor(db, locId, [{ id: user.id, positions, firstLoginAt: u?.f ?? null }])).get(user.id) ?? empty;
}

/** Who among these people has a locked Grafik right now (employees only). Used to hold back schedule notifications. */
export async function lockedUserIds(db: D1Database, locId: string, userIds: string[], now = Date.now()): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return out;
  const people: { id: string; positions: string[]; firstLoginAt: number | null }[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT u.id, u.first_login_at AS f, ul.position FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
         WHERE u.role = 'employee' AND u.id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(locId, ...chunk)
      .all<{ id: string; f: number | null; position: string }>();
    const byId = new Map<string, { id: string; positions: string[]; firstLoginAt: number | null }>();
    for (const r of results) {
      const p = byId.get(r.id) ?? { id: r.id, positions: [], firstLoginAt: r.f };
      p.positions.push(r.position);
      byId.set(r.id, p);
    }
    people.push(...byId.values());
  }
  if (!people.length) return out;
  for (const [id, d] of await deadlinesFor(db, locId, people, now)) if (d.lockedSince !== null) out.add(id);
  return out;
}
