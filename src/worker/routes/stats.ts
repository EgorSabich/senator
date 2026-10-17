/**
 * Panel → Statystyki (owner, 2026-10-17; mockups 12–13). Permission `stats.view`.
 * Leaders see their own divisions; the owner and zarządzający (no division limit) see everything.
 * „Usprawiedliwione” on a shift needs `time.manage` for its division.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { divisionOf } from '../../shared/constants';
import { REJECT_REASONS, SOURCES } from '../../shared/recruitment';
import { addDays, isIsoDate, warsawDate, warsawToMs } from '../../shared/time';
import { allowedDivisions, loadAccess, requireDivision, requirePermission, userInScope, type Access } from '../auth/access';
import { attendanceDays, byWeek, totals } from '../lib/attendance';
import { auditStatement } from '../lib/audit';
import { locationRules } from '../lib/location';
import { ApiError, badRequest, notFound, readJson, str } from '../lib/http';
import { DIVISIONS } from '../lib/notifyRules';

export const statsAdminRoutes = new Hono<AppEnv>();

export const EXCUSE_REASONS = ['sick', 'swap', 'leave', 'other'] as const;
const DAY = 86400_000;

function scopeOf(access: Access, locId: string, division: string | undefined): Set<string> | null {
  const allowed = allowedDivisions(access, locId);
  const mine = DIVISIONS.filter((d) => !allowed || allowed.has(d));
  if (division && division !== 'all') {
    if (!mine.includes(division)) throw new ApiError(403, 'forbidden');
    return new Set([division]);
  }
  return allowed ? new Set(mine) : null;
}

function range(q: (k: string) => string | undefined) {
  const from = q('from');
  const to = q('to');
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw badRequest('date_invalid');
  if (Date.parse(to) - Date.parse(from) > 400 * DAY) throw badRequest('range_too_long');
  return { from, to };
}

async function names(db: D1Database, ids: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db
      .prepare(`SELECT id, first_name AS f, last_name AS l, status FROM users WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ id: string; f: string; l: string; status: string }>();
    for (const r of results) out.set(r.id, r.status === 'anonymized' ? 'Były pracownik' : `${r.f} ${r.l}`.trim());
  }
  return out;
}

/* ───────── Obecność i spóźnienia ───────── */

statsAdminRoutes.get('/locations/:locId/stats/attendance', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'stats.view');
  const { from, to } = range((k) => c.req.query(k));
  const scope = scopeOf(access, locId, c.req.query('division'));
  const now = Date.now();
  const { staleHours } = await locationRules(db, locId);
  const days = await attendanceDays(db, locId, from, to, scope, now, undefined, staleHours);
  // the same length just before, for „+2 vs …”
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const prev = totals(await attendanceDays(db, locId, addDays(from, -len), addDays(from, -1), scope, now, undefined, staleHours));
  const byUser = new Map<string, typeof days>();
  for (const d of days) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  const who = await names(db, [...byUser.keys()]);
  const people = [...byUser].map(([userId, list]) => {
    const count = new Map<string, number>();
    for (const d of list) count.set(d.division, (count.get(d.division) ?? 0) + 1);
    const division = [...count].sort((a, b) => b[1] - a[1])[0]![0];
    return { userId, name: who.get(userId) ?? '—', division, ...totals(list) };
  });
  people.sort((a, b) => b.absences + b.late - (a.absences + a.late) || a.name.localeCompare(b.name, 'pl'));
  const allowed = allowedDivisions(access, locId);
  return c.json({
    divisions: DIVISIONS.filter((d) => !allowed || allowed.has(d)),
    canExcuse: access.locations.get(locId)?.has('time.manage') ?? false,
    totals: totals(days),
    previous: prev,
    weeks: byWeek(days, from, to < warsawDate(now) ? to : warsawDate(now)),
    people: people.filter((p) => p.shifts > 0),
  });
});

statsAdminRoutes.get('/locations/:locId/stats/attendance/:userId', async (c) => {
  const locId = c.req.param('locId');
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'stats.view');
  const { from, to } = range((k) => c.req.query(k));
  const scope = scopeOf(access, locId, c.req.query('division'));
  const { staleHours } = await locationRules(db, locId);
  const days = await attendanceDays(db, locId, from, to, scope, Date.now(), userId, staleHours);
  // a leader sees a person through their own divisions (shifts there, or the person's positions)
  if (scope && !days.length && !(await userInScope(db, access, locId, userId))) throw notFound();
  const who = await names(db, [userId]);
  if (!who.has(userId)) throw notFound();
  return c.json({ name: who.get(userId), totals: totals(days), days: days.reverse() });
});

async function shiftFor(c: { env: AppEnv['Bindings']; var: AppEnv['Variables'] }, locId: string, shiftId: string) {
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'time.manage');
  const s = await db
    .prepare(`SELECT id, user_id AS userId, date, division FROM schedule_shifts WHERE id = ? AND location_id = ? AND published = 1`)
    .bind(shiftId, locId)
    .first<{ id: string; userId: string; date: string; division: string }>();
  if (!s) throw notFound();
  requireDivision(access, locId, divisionOf(s.division));
  return s;
}

statsAdminRoutes.put('/locations/:locId/stats/excuses/:shiftId', async (c) => {
  const locId = c.req.param('locId');
  const s = await shiftFor(c, locId, c.req.param('shiftId'));
  const body = await readJson<{ reason?: unknown; note?: unknown }>(c.req.raw);
  const reason = EXCUSE_REASONS.find((r) => r === body.reason);
  if (!reason) throw badRequest('reason_invalid');
  const note = str(body.note, 200);
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        `INSERT INTO attendance_excuses (shift_id, location_id, user_id, date, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (shift_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`,
      )
      .bind(s.id, locId, s.userId, s.date, reason, note, c.var.user.id, Date.now()),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'attendance.excuse', entityType: 'schedule_shift', entityId: s.id, after: { reason } }),
  ]);
  return c.json({ ok: true });
});

statsAdminRoutes.delete('/locations/:locId/stats/excuses/:shiftId', async (c) => {
  const locId = c.req.param('locId');
  const s = await shiftFor(c, locId, c.req.param('shiftId'));
  const db = c.env.DB;
  await db.batch([
    db.prepare(`DELETE FROM attendance_excuses WHERE shift_id = ?`).bind(s.id),
    auditStatement(db, { actorId: c.var.user.id, locationId: locId, action: 'attendance.excuse.remove', entityType: 'schedule_shift', entityId: s.id }),
  ]);
  return c.json({ ok: true });
});

/* ───────── Rekrutacja ───────── */

interface Cand {
  id: string;
  position: string;
  stage: string;
  interviewAt: number | null;
  trialAt: number | null;
  source: string | null;
  rejectReason: string | null;
  noShowInterview: number;
  noShowTrial: number;
  createdAt: number;
  hiredAt: number | null;
  leftAt: number | null;
}

statsAdminRoutes.get('/locations/:locId/stats/recruitment', async (c) => {
  const locId = c.req.param('locId');
  const db = c.env.DB;
  const access = await loadAccess(db, c.var.user);
  requirePermission(access, locId, 'stats.view');
  const { from, to } = range((k) => c.req.query(k));
  const scope = scopeOf(access, locId, c.req.query('division'));
  const lo = warsawToMs(from, '00:00');
  const hi = warsawToMs(to, '23:59') + 60_000;
  const { results } = await db
    .prepare(
      `SELECT c.id, c.position, c.stage, c.interview_at AS interviewAt, c.trial_at AS trialAt, c.source, c.reject_reason AS rejectReason,
         c.no_show_interview AS noShowInterview, c.no_show_trial AS noShowTrial, c.created_at AS createdAt,
         u.created_at AS hiredAt, u.deactivated_at AS leftAt
       FROM candidates c LEFT JOIN users u ON u.id = c.hired_user_id
       WHERE c.location_id = ? AND c.created_at BETWEEN ? AND ?`,
    )
    .bind(locId, lo, hi)
    .all<Cand>();
  const list = results.filter((r) => !scope || scope.has(divisionOf(r.position)));
  const interview = (r: Cand) => r.interviewAt !== null || r.noShowInterview > 0 || ['interview', 'trial', 'hired'].includes(r.stage);
  const trial = (r: Cand) => r.trialAt !== null || r.noShowTrial > 0 || ['trial', 'hired'].includes(r.stage);
  const hired = (r: Cand) => r.stage === 'hired' || r.hiredAt !== null;
  const hiredList = list.filter(hired);
  const days = hiredList.filter((r) => r.hiredAt).map((r) => Math.max(0, Math.round((r.hiredAt! - r.createdAt) / DAY))).sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2]! : Math.round((days[days.length / 2 - 1]! + days[days.length / 2]!) / 2)) : null;
  const top = (rows: Cand[]) => {
    const n = new Map<string, number>();
    for (const r of rows) if (r.stage === 'rejected' && r.rejectReason) n.set(r.rejectReason, (n.get(r.rejectReason) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const allowed = allowedDivisions(access, locId);
  return c.json({
    divisions: DIVISIONS.filter((d) => !allowed || allowed.has(d)),
    totals: {
      candidates: list.length,
      interviews: list.filter(interview).length,
      trials: list.filter(trial).length,
      hired: hiredList.length,
      rejected: list.filter((r) => r.stage === 'rejected').length,
      medianDaysToHire: median,
      interviewsBooked: list.filter((r) => r.interviewAt !== null || r.noShowInterview > 0).length,
      noShowInterview: list.filter((r) => r.noShowInterview > 0).length,
      trialsBooked: list.filter((r) => r.trialAt !== null || r.noShowTrial > 0).length,
      noShowTrial: list.filter((r) => r.noShowTrial > 0).length,
      leftIn30: hiredList.filter((r) => r.hiredAt && r.leftAt && r.leftAt - r.hiredAt <= 30 * DAY).length,
      noSource: list.filter((r) => !r.source).length,
    },
    sources: [...SOURCES, null]
      .map((s) => ({ source: s, candidates: list.filter((r) => r.source === s).length, hired: hiredList.filter((r) => r.source === s).length }))
      .filter((s) => s.candidates > 0),
    reasons: REJECT_REASONS.map((r) => ({ reason: r, count: list.filter((x) => x.stage === 'rejected' && x.rejectReason === r).length })).filter((r) => r.count > 0),
    byDivision: DIVISIONS.filter((d) => !scope || scope.has(d))
      .map((d) => {
        const rows = list.filter((r) => divisionOf(r.position) === d);
        return {
          division: d,
          candidates: rows.length,
          interviews: rows.filter(interview).length,
          trials: rows.filter(trial).length,
          hired: rows.filter(hired).length,
          rejected: rows.filter((r) => r.stage === 'rejected').length,
          topReason: top(rows),
        };
      })
      .filter((d) => d.candidates > 0),
  });
});
