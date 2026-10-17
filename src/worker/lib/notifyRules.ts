/**
 * Notification settings per division and the engine that sends them (owner, 2026-10-17; mockups 10–11).
 * Runs every 5 minutes (cron). Each message goes to a person once (push_log kind + ref).
 * Decisions: no quiet hours; employees cannot switch kinds off; checklist reminder once; no messages to leaders.
 */
import type { Env } from '../env';
import { POSITIONS, divisionOf } from '../../shared/constants';
import { addDays, warsawDate } from '../../shared/time';
import { formatHm, unavailabilityDeadline, weekDays, weekStart } from '../../shared/schedule';
import { checklistDoneFor } from '../routes/checklists';
import { lockedUserIds } from './deadlines';
import { notify } from './notify';
import { entryPositions, positionsAt } from './positions';
import { rangeLabel } from './reminders';
import type { PushMessage } from './webpush';

export const DIVISIONS = POSITIONS.filter((p) => divisionOf(p) === p) as string[];
export const RULE_KINDS = ['tomorrow_shift', 'clock_in', 'clock_out', 'checklist_open', 'checklist_close', 'unavailability'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface Rule {
  kind: RuleKind;
  enabled: boolean;
  timeMin: number | null;
  minutes: number | null;
  listIds: string[] | null; // null = chosen automatically by the list title
}

const DEFAULTS: Record<RuleKind, Omit<Rule, 'kind'>> = {
  tomorrow_shift: { enabled: true, timeMin: 18 * 60, minutes: null, listIds: null },
  clock_in: { enabled: true, timeMin: null, minutes: null, listIds: null },
  clock_out: { enabled: true, timeMin: null, minutes: null, listIds: null },
  checklist_open: { enabled: true, timeMin: null, minutes: 30, listIds: null },
  checklist_close: { enabled: true, timeMin: null, minutes: 30, listIds: null },
  unavailability: { enabled: true, timeMin: 18 * 60, minutes: null, listIds: null },
};

/** All rules of a location: division → kind → rule (stored values over the defaults). */
export async function loadRules(db: D1Database, locId: string): Promise<Map<string, Map<RuleKind, Rule>>> {
  const { results } = await db
    .prepare(`SELECT division, kind, enabled, time_min AS timeMin, minutes, list_ids AS listIds FROM notification_rules WHERE location_id = ?`)
    .bind(locId)
    .all<{ division: string; kind: RuleKind; enabled: number; timeMin: number | null; minutes: number | null; listIds: string | null }>();
  const out = new Map<string, Map<RuleKind, Rule>>();
  for (const d of DIVISIONS) {
    const m = new Map<RuleKind, Rule>();
    for (const k of RULE_KINDS) m.set(k, { kind: k, ...DEFAULTS[k] });
    out.set(d, m);
  }
  for (const r of results) {
    const m = out.get(r.division);
    if (!m || !(RULE_KINDS as readonly string[]).includes(r.kind)) continue;
    let ids: string[] | null = null;
    try {
      ids = r.listIds ? (JSON.parse(r.listIds) as string[]) : null;
    } catch {
      ids = null;
    }
    m.set(r.kind, {
      kind: r.kind,
      enabled: Boolean(r.enabled),
      timeMin: r.timeMin ?? DEFAULTS[r.kind].timeMin,
      minutes: r.minutes ?? DEFAULTS[r.kind].minutes,
      listIds: ids,
    });
  }
  return out;
}

export interface ListInfo {
  id: string;
  title: string;
  positions: string[];
}

/** Published checklists of a location with the positions they are for. */
export async function locationChecklists(db: D1Database, locId: string): Promise<ListInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.id, ci.title, (SELECT group_concat(position) FROM content_item_positions p WHERE p.content_item_id = ci.id) AS positions
       FROM content_items ci WHERE ci.kind = 'checklist' AND ci.status = 'published' AND (ci.location_id = ? OR ci.location_id IS NULL) ORDER BY ci.sort_order, ci.title`,
    )
    .bind(locId)
    .all<{ id: string; title: string; positions: string | null }>();
  return results.map((r) => ({ id: r.id, title: r.title, positions: r.positions ? r.positions.split(',') : [] }));
}

const forDivision = (l: ListInfo, division: string) => !l.positions.length || l.positions.some((p) => divisionOf(p) === division);

/** The lists a rule reminds about: the chosen ones, or (not chosen yet) those titled „Otwarcie…” / „Zamknięcie…”. */
export function listsOf(rule: Rule, division: string, lists: ListInfo[]): ListInfo[] {
  const mine = lists.filter((l) => forDivision(l, division));
  if (rule.listIds) return mine.filter((l) => rule.listIds!.includes(l.id));
  const re = rule.kind === 'checklist_open' ? /otwarc/i : /zamkni|zamkn/i;
  return mine.filter((l) => re.test(l.title));
}

const DOW = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
const DIV_LABEL: Record<string, string> = {
  waiter: 'Kelnerzy',
  host: 'Host',
  bartender: 'Bar',
  kitchen: 'Kuchnia',
  hookah_master: 'Shisha',
  shift_manager: 'Menedżer zmiany',
  call_center: 'Call center',
};
const warsawMin = (ms: number) => {
  const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Warsaw' }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
};
const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** days bitmask: Monday = 1 … Sunday = 64; 0 = every day */
export const dayBit = (date: string) => 1 << ((dowOf(date) + 6) % 7);
const shiftMs = (date: string, min: number) => {
  // minutes from the business day's midnight in Warsaw → ms
  const base = Date.parse(`${date}T12:00:00Z`);
  const noonWarsaw = warsawMin(base);
  return base + (min - noonWarsaw) * 60000;
};
const durationText = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;

/** A time-of-day rule fires in the 5-minute run that covers it (force: always, for local tests). */
const inWindow = (nowMin: number, at: number | null, force: boolean) => force || (at !== null && nowMin >= at && nowMin < at + 5);

interface Ctx {
  env: Env;
  now: number;
  force: boolean;
}

/** Every 5 minutes. */
export async function runNotifications(env: Env, now: number, force = false) {
  const ctx: Ctx = { env, now, force };
  const { results: locs } = await env.DB.prepare(`SELECT id, unavail_deadline_dow AS dow, unavail_deadline_hour AS hour FROM locations WHERE is_active = 1`).all<{ id: string; dow: number; hour: number }>();
  const out = { tomorrow: 0, unavailability: 0, checklists: 0, custom: 0 };
  for (const loc of locs) {
    const rules = await loadRules(env.DB, loc.id);
    out.tomorrow += await tomorrowShift(ctx, loc.id, rules);
    out.unavailability += await unavailabilityReminder(ctx, loc, rules);
    out.checklists += await checklistReminders(ctx, loc.id, rules);
    out.custom += await customRun(ctx, loc.id);
  }
  return out;
}

async function tomorrowShift(ctx: Ctx, locId: string, rules: Map<string, Map<RuleKind, Rule>>) {
  const nowMin = warsawMin(ctx.now);
  const divisions = [...rules].filter(([, m]) => m.get('tomorrow_shift')!.enabled && inWindow(nowMin, m.get('tomorrow_shift')!.timeMin, ctx.force)).map(([d]) => d);
  if (!divisions.length) return 0;
  const tomorrow = addDays(warsawDate(ctx.now), 1);
  const { results: shifts } = await ctx.env.DB.prepare(
    `SELECT user_id AS u, division, pub_start_min AS s, pub_end_min AS e FROM schedule_shifts
     WHERE location_id = ? AND date = ? AND published = 1 AND is_deleted = 0 AND division IN (${divisions.map(() => '?').join(', ')}) ORDER BY pub_start_min`,
  )
    .bind(locId, tomorrow, ...divisions)
    .all<{ u: string; division: string; s: number; e: number }>();
  if (!shifts.length) return 0;
  const locked = await lockedUserIds(ctx.env.DB, locId, shifts.map((s) => s.u), ctx.now);
  const ids = [...new Set(shifts.map((s) => s.u))].filter((u) => !locked.has(u));
  const r = await notify(
    ctx.env,
    ids,
    (u) => {
      const parts = shifts.filter((s) => s.u === u).map((s) => `${formatHm(s.s)}–${formatHm(s.e)} · ${DIV_LABEL[s.division] ?? s.division}`);
      return { title: 'Jutro zmiana', body: `${DOW[dowOf(tomorrow)]} ${parts.join(', ')}`, url: '/grafik', tag: `shift-${tomorrow}` };
    },
    { kind: 'shift', ref: `${locId}:${tomorrow}` },
  );
  return r.people;
}

async function unavailabilityReminder(ctx: Ctx, loc: { id: string; dow: number; hour: number }, rules: Map<string, Map<RuleKind, Rule>>) {
  const db = ctx.env.DB;
  const nowMin = warsawMin(ctx.now);
  const today = warsawDate(ctx.now);
  const tomorrow = addDays(today, 1);
  let sent = 0;
  for (const k of [1, 2]) {
    const monday = addDays(weekStart(today), 7 * k);
    const deadline = unavailabilityDeadline(monday, loc.dow ?? 0, loc.hour ?? 23);
    if (deadline <= ctx.now || warsawDate(deadline) !== tomorrow) continue;
    const days = weekDays(monday);
    const people = await positionsAt(db, loc.id);
    const { results: active } = await db
      .prepare(`SELECT DISTINCT u.id FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1 WHERE u.role = 'employee' AND u.status = 'active'`)
      .bind(loc.id)
      .all<{ id: string }>();
    const { results: marked } = await db
      .prepare(`SELECT DISTINCT user_id AS u FROM unavailability WHERE location_id = ? AND date BETWEEN ? AND ?`)
      .bind(loc.id, days[0], days[6])
      .all<{ u: string }>();
    const has = new Set(marked.map((m) => m.u));
    const candidates = active
      .map((a) => a.id)
      .filter((u) => {
        if (has.has(u)) return false;
        const primary = people.get(u)?.primary;
        const rule = primary ? rules.get(divisionOf(primary))?.get('unavailability') : null;
        return Boolean(rule?.enabled && inWindow(nowMin, rule.timeMin, ctx.force));
      });
    if (!candidates.length) continue;
    const locked = await lockedUserIds(db, loc.id, candidates, ctx.now);
    const r = await notify(
      ctx.env,
      candidates.filter((u) => !locked.has(u)),
      () => ({
        title: 'Niedostępność',
        body: `Jutro do ${String(loc.hour ?? 23).padStart(2, '0')}:59 mija termin na zaznaczenie dni na tydzień ${rangeLabel(days[0]!, days[6]!)}.`,
        url: '/grafik',
        tag: `unav-${monday}`,
      }),
      { kind: 'unav', ref: `${loc.id}:${monday}` },
    );
    sent += r.people;
  }
  return sent;
}

/** Lists not ticked: some minutes after clock-in (opening) and before the planned end (closing). Once each. */
async function checklistReminders(ctx: Ctx, locId: string, rules: Map<string, Map<RuleKind, Rule>>) {
  const db = ctx.env.DB;
  const anyOn = [...rules.values()].some((m) => m.get('checklist_open')!.enabled || m.get('checklist_close')!.enabled);
  if (!anyOn) return 0;
  const lists = await locationChecklists(db, locId);
  if (!lists.length) return 0;
  // people on shift now (open time entries from the last 16 h)
  const { results: open } = await db
    .prepare(
      `SELECT id, user_id AS userId, business_date AS businessDate, clock_in_at AS clockInAt, position FROM time_entries
       WHERE location_id = ? AND clock_out_at IS NULL AND clock_in_at > ?`,
    )
    .bind(locId, ctx.now - 16 * 3600_000)
    .all<{ id: string; userId: string; businessDate: string; clockInAt: number; position: string | null }>();
  if (!open.length) return 0;
  const posOf = await entryPositions(db, locId, open);
  let sent = 0;
  for (const e of open) {
    const division = divisionOf(posOf.get(e.id) ?? '');
    const m = rules.get(division);
    if (!m) continue;
    // opening lists
    const ro = m.get('checklist_open')!;
    if (ro.enabled && (ctx.force || ctx.now >= e.clockInAt + (ro.minutes ?? 30) * 60000)) sent += await remindLists(ctx, locId, e.userId, e.businessDate, listsOf(ro, division, lists), 'cl_open', e.id);
    // closing lists: before the end of today's planned shift
    const rc = m.get('checklist_close')!;
    if (!rc.enabled) continue;
    const shift = await db
      .prepare(
        `SELECT id, pub_end_min AS e FROM schedule_shifts WHERE location_id = ? AND user_id = ? AND date = ? AND published = 1 AND is_deleted = 0 ORDER BY pub_start_min DESC LIMIT 1`,
      )
      .bind(locId, e.userId, e.businessDate)
      .first<{ id: string; e: number }>();
    if (!shift) continue;
    const end = shiftMs(e.businessDate, shift.e);
    if (ctx.force || (ctx.now >= end - (rc.minutes ?? 30) * 60000 && ctx.now < end + 3600_000)) sent += await remindLists(ctx, locId, e.userId, e.businessDate, listsOf(rc, division, lists), 'cl_close', shift.id);
  }
  return sent;
}

async function remindLists(ctx: Ctx, locId: string, userId: string, date: string, lists: ListInfo[], kind: string, ref: string) {
  const undone: { id: string; title: string }[] = [];
  for (const l of lists) {
    const st = await checklistDoneFor(ctx.env.DB, l.id, userId, date, locId);
    if (st && !st.done) undone.push({ id: l.id, title: st.title });
  }
  if (!undone.length) return 0;
  const r = await notify(
    ctx.env,
    [userId],
    () => ({
      title: 'Lista kontrolna',
      body: undone.length === 1 ? `Wypełnij listę „${undone[0]!.title}”.` : `Wypełnij listy: ${undone.map((u) => `„${u.title}”`).join(', ')}.`,
      url: `/listy/${undone[0]!.id}`,
      tag: `${kind}-${ref}`,
    }),
    { kind, ref },
  );
  return r.people;
}

/** Right after a punch on the terminal (not for old offline punches). */
export async function clockPush(env: Env, locId: string, userId: string, entry: { id: string; businessDate: string; clockInAt: number; position?: string | null }, out: { at: number; minutes: number } | null) {
  const rules = await loadRules(env.DB, locId);
  const pos = (await entryPositions(env.DB, locId, [{ ...entry, userId }])).get(entry.id) ?? '';
  const rule = rules.get(divisionOf(pos))?.get(out ? 'clock_out' : 'clock_in');
  if (!rule?.enabled) return;
  const hm = (ms: number) => formatHm(warsawMin(ms));
  const msg: PushMessage = out
    ? { title: 'Wyjście', body: `Zarejestrowano wyjście o ${hm(out.at)}. Dziś: ${durationText(out.minutes)}. Dziękujemy za zmianę!`, url: '/godziny', tag: `out-${entry.id}` }
    : { title: 'Wejście', body: `Zarejestrowano wejście o ${hm(entry.clockInAt)}. Dobrej zmiany!`, url: '/', tag: `in-${entry.id}` };
  await notify(env, [userId], () => msg);
}

/* ───────── Own notifications ───────── */

interface Custom {
  id: string;
  title: string;
  body: string;
  divisions: string;
  audience: 'on_shift' | 'division';
  trigger: 'once' | 'weekly' | 'shift_start' | 'after_clock_in' | 'shift_end';
  atMs: number | null;
  days: number;
  timeMin: number | null;
  minutes: number | null;
  url: string | null;
}

async function customRun(ctx: Ctx, locId: string) {
  const db = ctx.env.DB;
  const { results } = await db
    .prepare(
      `SELECT id, title, body, divisions, audience, trigger, at_ms AS atMs, days, time_min AS timeMin, minutes, url FROM custom_notifications WHERE location_id = ? AND enabled = 1`,
    )
    .bind(locId)
    .all<Custom>();
  if (!results.length) return 0;
  const today = warsawDate(ctx.now);
  const nowMin = warsawMin(ctx.now);
  let sent = 0;
  const people = await positionsAt(db, locId);
  for (const n of results) {
    const divs = n.divisions.split(',').filter(Boolean);
    const msg = (): PushMessage => ({ title: n.title, body: n.body, url: n.url || '/', tag: `custom-${n.id}` });
    const dayOk = (date: string) => !n.days || (n.days & dayBit(date)) !== 0;
    if (n.trigger === 'once' || n.trigger === 'weekly') {
      const due = n.trigger === 'once' ? n.atMs !== null && (ctx.force || (ctx.now >= n.atMs && ctx.now < n.atMs + 5 * 60000)) : dayOk(today) && inWindow(nowMin, n.timeMin, ctx.force);
      if (!due) continue;
      const ids = await audienceOf(ctx, locId, divs, n.audience, people);
      const r = await notify(ctx.env, ids, msg, { kind: 'custom', ref: n.trigger === 'once' ? n.id : `${n.id}:${today}` });
      sent += r.people;
      continue;
    }
    // tied to shifts or clock-ins
    if (!dayOk(today) && !dayOk(addDays(today, -1))) continue;
    const off = (n.minutes ?? 0) * 60000;
    if (n.trigger === 'after_clock_in') {
      const { results: open } = await db
        .prepare(`SELECT id, user_id AS userId, business_date AS businessDate, clock_in_at AS clockInAt, position FROM time_entries WHERE location_id = ? AND clock_out_at IS NULL AND clock_in_at > ?`)
        .bind(locId, ctx.now - 16 * 3600_000)
        .all<{ id: string; userId: string; businessDate: string; clockInAt: number; position: string | null }>();
      const posOf = await entryPositions(db, locId, open);
      for (const e of open) {
        if (!dayOk(e.businessDate) || !divs.includes(divisionOf(posOf.get(e.id) ?? '')) || (!ctx.force && ctx.now < e.clockInAt + off)) continue;
        sent += (await notify(ctx.env, [e.userId], msg, { kind: 'custom', ref: `${n.id}:${e.id}` })).people;
      }
      continue;
    }
    const { results: shifts } = await db
      .prepare(
        `SELECT id, user_id AS u, date, division, pub_start_min AS s, pub_end_min AS e FROM schedule_shifts
         WHERE location_id = ? AND date IN (?, ?) AND published = 1 AND is_deleted = 0`,
      )
      .bind(locId, today, addDays(today, -1))
      .all<{ id: string; u: string; date: string; division: string; s: number; e: number }>();
    for (const s of shifts) {
      if (!divs.includes(s.division) || !dayOk(s.date)) continue;
      const at = n.trigger === 'shift_start' ? shiftMs(s.date, s.s) - off : shiftMs(s.date, s.e) - off;
      if (!(ctx.force || (ctx.now >= at && ctx.now < at + 30 * 60000))) continue;
      sent += (await notify(ctx.env, [s.u], msg, { kind: 'custom', ref: `${n.id}:${s.id}` })).people;
    }
  }
  return sent;
}

/** on_shift: published shift today in those divisions or clocked in now; division: everyone active there. */
async function audienceOf(ctx: Ctx, locId: string, divs: string[], audience: string, people: Map<string, { positions: string[] }>) {
  const db = ctx.env.DB;
  if (audience === 'division') {
    const { results } = await db
      .prepare(`SELECT DISTINCT u.id FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1 WHERE u.role = 'employee' AND u.status = 'active'`)
      .bind(locId)
      .all<{ id: string }>();
    return results.map((r) => r.id).filter((u) => people.get(u)?.positions.some((p) => divs.includes(divisionOf(p))));
  }
  const today = warsawDate(ctx.now);
  const { results: s } = await db
    .prepare(`SELECT DISTINCT user_id AS u FROM schedule_shifts WHERE location_id = ? AND date = ? AND published = 1 AND is_deleted = 0 AND division IN (${divs.map(() => '?').join(', ')})`)
    .bind(locId, today, ...divs)
    .all<{ u: string }>();
  const { results: e } = await db
    .prepare(`SELECT DISTINCT user_id AS u FROM time_entries WHERE location_id = ? AND clock_out_at IS NULL AND clock_in_at > ?`)
    .bind(locId, ctx.now - 16 * 3600_000)
    .all<{ u: string }>();
  const onShift = e.map((x) => x.u).filter((u) => people.get(u)?.positions.some((p) => divs.includes(divisionOf(p))));
  return [...new Set([...s.map((x) => x.u), ...onShift])];
}
