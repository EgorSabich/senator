/**
 * What the notifications say and when reminders go out (owner, 2026-10-17):
 * - schedule published: only people whose shifts changed, never people whose Grafik is locked;
 * - a new or significantly changed mandatory document: people who now have to read it;
 * Tomorrow's shift, days-off deadline, checklists and own notifications: lib/notifyRules.ts (settings per division).
 */
import type { Env } from '../env';
import { addDays, warsawDate } from '../../shared/time';
import { formatHm, unavailabilityDeadline, weekDays, weekStart } from '../../shared/schedule';
import { deadlinesFor, lockedUserIds } from './deadlines';
import { notify, type NotifyResult } from './notify';
import type { PushMessage } from './webpush';

const DIVISIONS: Record<string, string> = {
  waiter: 'Kelnerzy',
  host: 'Host',
  bartender: 'Bar',
  kitchen: 'Kuchnia',
  hookah_master: 'Shisha',
  shift_manager: 'Menedżer zmiany',
  call_center: 'Call center',
};
const DOW = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_LONG = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const day = (date: string) => Number(date.slice(8, 10));
const mon = (date: string) => Number(date.slice(5, 7)) - 1;

/** „19–25 paź”, „26 paź–1 lis” */
export function rangeLabel(from: string, to: string): string {
  return mon(from) === mon(to) ? `${day(from)}–${day(to)} ${MONTHS[mon(to)]}` : `${day(from)} ${MONTHS[mon(from)]}–${day(to)} ${MONTHS[mon(to)]}`;
}
/** 1 zmianę / 2 zmiany / 5 zmian (accusative after „masz”) */
export function shiftsWord(n: number): string {
  if (n === 1) return '1 zmianę';
  const t = n % 10;
  const h = n % 100;
  return t >= 2 && t <= 4 && (h < 12 || h > 14) ? `${n} zmiany` : `${n} zmian`;
}

export interface ShiftChange {
  userId: string;
  date: string;
  kind: 'new' | 'changed' | 'deleted';
  startMin: number;
  endMin: number;
}

/** Message for one person after a publish. `shiftsAfter` = their published shifts in the period. */
export function scheduleMessage(changes: ShiftChange[], shiftsAfter: number, period: { days: string[]; monday: string | null }): PushMessage {
  const first = period.days[0]!;
  const label = period.monday ? `na ${rangeLabel(first, period.days[period.days.length - 1]!)}` : `na ${MONTHS_LONG[mon(first)]}`;
  const anyOld = changes.some((c) => c.kind !== 'new');
  const head = anyOld ? `Zmiany w grafiku ${label}.` : `Nowy grafik ${label}.`;
  const count = shiftsAfter ? `Masz ${shiftsWord(shiftsAfter)}.` : 'Nie masz zmian w tym okresie.';
  const shown = changes.filter((c) => c.kind !== 'new').sort((a, b) => a.date.localeCompare(b.date))[0];
  const detail = shown
    ? ` ${DOW[dow(shown.date)]} ${day(shown.date)}.${String(mon(shown.date) + 1).padStart(2, '0')} ${formatHm(shown.startMin)}–${formatHm(shown.endMin)} ${shown.kind === 'deleted' ? 'odwołana' : 'zmieniona'}.`
    : '';
  return { title: 'Grafik', body: `${head} ${count}${detail}`, url: '/grafik', tag: `grafik-${first}` };
}

/** After „Opublikuj i powiadom”: sends to people whose shifts changed, except those with a locked Grafik. */
export async function notifySchedule(env: Env, locId: string, changes: ShiftChange[], period: { days: string[]; monday: string | null }): Promise<NotifyResult> {
  const db = env.DB;
  const ids = [...new Set(changes.map((c) => c.userId))];
  const locked = await lockedUserIds(db, locId, ids);
  const target = ids.filter((id) => !locked.has(id));
  if (!target.length) return { people: 0, devices: 0, delivered: 0 };
  const counts = new Map<string, number>();
  const { results } = await db
    .prepare(
      `SELECT user_id AS u, COUNT(*) AS n FROM schedule_shifts WHERE location_id = ? AND published = 1 AND is_deleted = 0 AND date BETWEEN ? AND ? GROUP BY user_id`,
    )
    .bind(locId, period.days[0], period.days[period.days.length - 1])
    .all<{ u: string; n: number }>();
  for (const r of results) counts.set(r.u, r.n);
  return notify(env, target, (u) => scheduleMessage(changes.filter((c) => c.userId === u), counts.get(u) ?? 0, period));
}

/** After publishing a new or significantly changed mandatory document: everyone who now has it to read. */
export async function notifyDocument(env: Env, item: { id: string; locationId: string | null; title: string }, versionId: string, isNew: boolean): Promise<NotifyResult> {
  const db = env.DB;
  const locs = item.locationId
    ? [item.locationId]
    : (await db.prepare(`SELECT id FROM locations`).all<{ id: string }>()).results.map((r) => r.id);
  const total: NotifyResult = { people: 0, devices: 0, delivered: 0 };
  for (const locId of locs) {
    const people = await employeesAt(db, locId);
    const dl = await deadlinesFor(db, locId, people);
    const ack = await db.prepare(`SELECT ack_days AS d FROM locations WHERE id = ?`).bind(locId).first<{ d: number }>();
    const days = ack?.d ?? 3;
    const target = people.filter((p) => dl.get(p.id)?.items.some((i) => i.id === item.id)).map((p) => p.id);
    const r = await notify(
      env,
      target,
      () => ({
        title: 'Dokument do przeczytania',
        body: `„${item.title}” — ${isNew ? 'nowy dokument' : 'nowa wersja'}. Masz ${days === 1 ? '1 dzień' : `${days} dni`}.`,
        url: `/m/${item.id}`,
        tag: `doc-${item.id}`,
      }),
      { kind: 'doc', ref: versionId },
    );
    total.people += r.people;
    total.devices += r.devices;
    total.delivered += r.delivered;
  }
  return total;
}

async function employeesAt(db: D1Database, locId: string) {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.first_login_at AS f, ul.position FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
       WHERE u.role = 'employee' AND u.status = 'active'`,
    )
    .bind(locId)
    .all<{ id: string; f: number | null; position: string }>();
  const byId = new Map<string, { id: string; positions: string[]; firstLoginAt: number | null }>();
  for (const r of results) {
    const p = byId.get(r.id) ?? { id: r.id, positions: [], firstLoginAt: r.f };
    p.positions.push(r.position);
    byId.set(r.id, p);
  }
  return [...byId.values()];
}
