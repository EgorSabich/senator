/**
 * Statystyki — Czas pracy i koszt, Listy kontrolne, Szkolenia i dokumenty (owner, 2026-10-17; mockups 14–16).
 * Every function takes the divisions the viewer may see (null = all) and a date range (business dates).
 */
import { divisionOf } from '../../shared/constants';
import { checklistItems } from '../../shared/checklist';
import { addDays, warsawDate as warsawDateOf, warsawToMs } from '../../shared/time';
import { shiftEndMs, shiftStartMs, weekStart } from '../../shared/schedule';
import { itemProgress, type VersionRef } from '../../shared/progress';
import { keySet, loadChecklist } from '../routes/checklists';
import type { SessionUser } from '../env';
import { ackDaysOf, deadlinesFor } from './deadlines';
import { isVisibleFor, MANDATORY_KINDS, programFor, visibleContent } from './learning';
import { entryPositions, positionsAt, rateFor, type RateRow } from './positions';

const DAY = 86400_000;
type Scope = Set<string> | null;

function weeksOf(from: string, to: string) {
  const out: string[] = [];
  for (let w = weekStart(from); w <= to && out.length < 60; w = addDays(w, 7)) out.push(w);
  return out;
}
const inWeek = (date: string, w: string) => date >= w && date <= addDays(w, 6);

async function names(db: D1Database, ids: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    if (!chunk.length) continue;
    const { results } = await db
      .prepare(`SELECT id, first_name AS f, last_name AS l, status FROM users WHERE id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(...chunk)
      .all<{ id: string; f: string; l: string; status: string }>();
    for (const r of results) out.set(r.id, r.status === 'anonymized' ? 'Były pracownik' : `${r.f} ${r.l}`.trim());
  }
  return out;
}

/* ───────── Czas pracy i koszt (mockup 14) ───────── */

export async function costStats(db: D1Database, locId: string, from: string, to: string, scope: Scope, wages: boolean, now: number) {
  const calc = async (f: string, t: string) => {
    const { results: entries } = await db
      .prepare(
        `SELECT e.id, e.user_id AS userId, e.business_date AS businessDate, e.clock_in_at AS clockInAt, e.clock_out_at AS clockOutAt, e.position
         FROM time_entries e WHERE e.location_id = ? AND e.business_date BETWEEN ? AND ? AND e.clock_out_at IS NOT NULL`,
      )
      .bind(locId, f, t)
      .all<{ id: string; userId: string; businessDate: string; clockInAt: number; clockOutAt: number; position: string | null }>();
    const posOf = await entryPositions(db, locId, entries);
    const { results: shifts } = await db
      .prepare(`SELECT user_id AS userId, date, division, pub_start_min AS s, pub_end_min AS e FROM schedule_shifts WHERE location_id = ? AND published = 1 AND is_deleted = 0 AND date BETWEEN ? AND ?`)
      .bind(locId, f, t)
      .all<{ userId: string; date: string; division: string; s: number; e: number }>();
    const { results: rateRows } = await db
      .prepare(`SELECT user_id AS userId, position, rate_grosze AS rateGrosze, valid_from AS validFrom FROM pay_rates WHERE location_id = ? ORDER BY valid_from`)
      .bind(locId)
      .all<RateRow & { userId: string }>();
    const rates = new Map<string, RateRow[]>();
    for (const r of rateRows) (rates.get(r.userId) ?? rates.set(r.userId, []).get(r.userId)!).push(r);
    const rows = entries
      .map((e) => {
        const pos = posOf.get(e.id) ?? '';
        const minutes = Math.round((e.clockOutAt - e.clockInAt) / 60000);
        const rate = rateFor(rates.get(e.userId) ?? [], pos || null, e.businessDate);
        return { ...e, pos, division: divisionOf(pos), minutes, rate, cost: rate === null ? 0 : (minutes / 60) * rate };
      })
      .filter((e) => !scope || scope.has(e.division));
    const plan = shifts
      .filter((s) => shiftStartMs(s.date, s.s) <= now && (!scope || scope.has(divisionOf(s.division))))
      .map((s) => ({ ...s, division: divisionOf(s.division), minutes: Math.round((shiftEndMs(s.date, s.e) - shiftStartMs(s.date, s.s)) / 60000) }));
    return { rows, plan, rates };
  };
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const cur = await calc(from, to);
  const prev = await calc(addDays(from, -len), addDays(from, -1));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const workedMin = sum(cur.rows.map((r) => r.minutes));
  const plannedMin = sum(cur.plan.map((p) => p.minutes));
  const cost = Math.round(sum(cur.rows.map((r) => r.cost)));
  const prevCost = Math.round(sum(prev.rows.map((r) => r.cost)));
  // hours above the plan: per person and day, worked − planned when positive
  const overByUser = new Map<string, number>();
  const keys = new Set(cur.rows.map((r) => `${r.userId}|${r.businessDate}`));
  for (const k of keys) {
    const [u, d] = k.split('|') as [string, string];
    const worked = sum(cur.rows.filter((r) => r.userId === u && r.businessDate === d).map((r) => r.minutes));
    const planned = sum(cur.plan.filter((p) => p.userId === u && p.date === d).map((p) => p.minutes));
    if (planned > 0 && worked > planned) overByUser.set(u, (overByUser.get(u) ?? 0) + worked - planned);
  }
  const users = [...new Set([...cur.rows.map((r) => r.userId), ...cur.plan.map((p) => p.userId)])];
  const who = await names(db, users);
  const noRate = new Set(cur.rows.filter((r) => r.rate === null).map((r) => r.userId));
  const people = users
    .map((u) => {
      const mine = cur.rows.filter((r) => r.userId === u);
      const count = new Map<string, number>();
      for (const r of mine) count.set(r.division, (count.get(r.division) ?? 0) + r.minutes);
      for (const p of cur.plan.filter((x) => x.userId === u)) if (!count.size) count.set(p.division, 1);
      const division = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const last = [...mine].sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0];
      return {
        userId: u,
        name: who.get(u) ?? '—',
        division,
        shifts: mine.length,
        plannedMin: sum(cur.plan.filter((p) => p.userId === u).map((p) => p.minutes)),
        workedMin: sum(mine.map((r) => r.minutes)),
        overMin: overByUser.get(u) ?? 0,
        ...(wages ? { rate: last?.rate ?? rateFor(cur.rates.get(u) ?? [], null, to), cost: Math.round(sum(mine.map((r) => r.cost))), missingRate: noRate.has(u) } : {}),
      };
    })
    .sort((a, b) => b.workedMin - a.workedMin || a.name.localeCompare(b.name, 'pl'));
  const divisions = [...new Set([...cur.rows.map((r) => r.division), ...cur.plan.map((p) => p.division)])]
    .map((d) => ({
      division: d,
      workedMin: sum(cur.rows.filter((r) => r.division === d).map((r) => r.minutes)),
      plannedMin: sum(cur.plan.filter((p) => p.division === d).map((p) => p.minutes)),
      ...(wages ? { cost: Math.round(sum(cur.rows.filter((r) => r.division === d).map((r) => r.cost))) } : {}),
    }))
    .sort((a, b) => (b.cost ?? b.workedMin) - (a.cost ?? a.workedMin));
  return {
    wages,
    totals: {
      workedMin,
      plannedMin,
      overMin: sum([...overByUser.values()]),
      people: people.length,
      ...(wages ? { cost, prevCost, avgRate: workedMin ? Math.round(cost / (workedMin / 60)) : null, missingRate: noRate.size } : {}),
    },
    weeks: weeksOf(from, to < warsawDateOf(now) ? to : warsawDateOf(now)).map((w) => ({
      week: w,
      workedMin: sum(cur.rows.filter((r) => inWeek(r.businessDate, w)).map((r) => r.minutes)),
      ...(wages ? { cost: Math.round(sum(cur.rows.filter((r) => inWeek(r.businessDate, w)).map((r) => r.cost))) } : {}),
    })),
    byDivision: divisions,
    people,
  };
}

/* ───────── Listy kontrolne (mockup 15) ───────── */

export async function checklistStats(db: D1Database, locId: string, from: string, to: string, scope: Scope) {
  const visible = await visibleContent(db, locId, null, ['checklist']);
  const lists = [];
  for (const v of visible) {
    const cl = await loadChecklist(db, v.id);
    const items = checklistItems(cl.body);
    if (!items.length) continue;
    const positions = cl.positions ? cl.positions.split(',') : [];
    const divs = [...new Set(positions.map(divisionOf))];
    if (scope && (divs.length ? !divs.some((d) => scope.has(d)) : false)) continue;
    const shared = cl.mode === 'shared' ? new Set(items.map((i) => i.key)) : keySet(cl.sharedKeysJson);
    lists.push({ id: cl.id, title: cl.title, positions: cl.positions, divisions: divs, items, shared, photo: keySet(cl.photoKeysJson) });
  }
  const people = await positionsAt(db, locId);
  const { results: worked } = await db
    .prepare(
      `SELECT e.business_date AS date, e.user_id AS userId, MIN(e.clock_in_at) AS inAt FROM time_entries e JOIN users u ON u.id = e.user_id
       WHERE e.location_id = ? AND e.business_date BETWEEN ? AND ? AND (u.role = 'employee' OR u.tracks_time = 1) GROUP BY 1, 2`,
    )
    .bind(locId, from, to)
    .all<{ date: string; userId: string; inAt: number }>();
  const { results: marks } = await db
    .prepare(
      `SELECT content_item_id AS listId, business_date AS date, item_key AS k, user_id AS userId, marked_at AS at, CASE WHEN photo_key IS NULL THEN 0 ELSE 1 END AS photo
       FROM checklist_marks WHERE location_id = ? AND business_date BETWEEN ? AND ?`,
    )
    .bind(locId, from, to)
    .all<{ listId: string; date: string; k: string; userId: string; at: number; photo: number }>();
  const lo = warsawToMs(from, '00:00');
  const hi = warsawToMs(addDays(to, 1), '12:00');
  const { results: pushes } = await db
    .prepare(`SELECT user_id AS userId, kind, created_at AS at FROM push_log WHERE kind IN ('cl_open', 'cl_close') AND created_at BETWEEN ? AND ?`)
    .bind(lo, hi)
    .all<{ userId: string; kind: string; at: number }>();
  const inScope = (u: string) => !scope || (people.get(u)?.positions ?? []).some((p) => scope.has(divisionOf(p)));
  const posWithDivisions = (u: string) => {
    const ps = people.get(u)?.positions ?? [];
    return [...new Set(ps.flatMap((p) => [p, divisionOf(p)]))];
  };
  const dates = [...new Set(worked.map((w) => w.date))].sort();
  const listOut: { id: string; title: string; division: string; days: number; full: number; pctSum: number; misses: Map<string, number> }[] = [];
  const personAgg = new Map<string, { listDays: number; complete: number; pctSum: number; afterReminder: number; minutes: number[] }>();
  let photoNeed = 0;
  let photoDone = 0;
  for (const l of lists) {
    const out = { id: l.id, title: l.title, division: l.divisions[0] ?? '', days: 0, full: 0, pctSum: 0, misses: new Map<string, number>() };
    const own = l.items.filter((i) => !l.shared.has(i.key));
    const sharedItems = l.items.filter((i) => l.shared.has(i.key));
    for (const d of dates) {
      const lm = marks.filter((m) => m.listId === l.id && m.date === d);
      const expected = new Set(worked.filter((w) => w.date === d && inScope(w.userId) && isVisibleFor(l.positions, posWithDivisions(w.userId))).map((w) => w.userId));
      for (const m of lm) if (inScope(m.userId)) expected.add(m.userId);
      const required = sharedItems.length + (own.length ? own.length * expected.size : 0);
      if (!required || (!expected.size && !lm.length)) continue;
      let done = 0;
      for (const it of sharedItems) {
        if (lm.some((m) => m.k === it.key)) done++;
        else out.misses.set(it.text, (out.misses.get(it.text) ?? 0) + 1);
      }
      for (const u of expected) {
        const mine = lm.filter((m) => m.userId === u && own.some((i) => i.key === m.k));
        const keys = new Set(mine.map((m) => m.k));
        done += Math.min(keys.size, own.length);
        for (const it of own) if (!keys.has(it.key)) out.misses.set(it.text, (out.misses.get(it.text) ?? 0) + 1);
        if (!own.length) continue;
        const agg = personAgg.get(u) ?? { listDays: 0, complete: 0, pctSum: 0, afterReminder: 0, minutes: [] };
        agg.listDays++;
        agg.pctSum += Math.min(1, keys.size / own.length);
        if (keys.size >= own.length) {
          agg.complete++;
          const lastAt = Math.max(...mine.map((m) => m.at));
          const inAt = worked.find((w) => w.date === d && w.userId === u)?.inAt;
          if (inAt && lastAt > inAt) agg.minutes.push(Math.round((lastAt - inAt) / 60000));
          const dayStart = warsawToMs(d, '00:00');
          if (pushes.some((p) => p.userId === u && p.at >= dayStart && p.at < dayStart + 36 * 3600_000 && p.at < lastAt)) agg.afterReminder++;
        }
        personAgg.set(u, agg);
      }
      for (const m of lm) {
        if (!l.photo.has(m.k)) continue;
        photoNeed++;
        if (m.photo) photoDone++;
      }
      out.days++;
      out.pctSum += Math.min(1, done / required);
      if (done >= required) out.full++;
    }
    if (out.days) listOut.push(out);
  }
  const who = await names(db, [...personAgg.keys()]);
  const allMisses = new Map<string, number>();
  for (const l of listOut) for (const [k, v] of l.misses) allMisses.set(k, (allMisses.get(k) ?? 0) + v);
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const listDays = listOut.reduce((a, l) => a + l.days, 0);
  const allMinutes = [...personAgg.values()].flatMap((p) => p.minutes);
  return {
    totals: {
      listDays,
      fullPct: listDays ? Math.round((listOut.reduce((a, l) => a + l.full, 0) / listDays) * 100) : null,
      skipped: [...allMisses.values()].reduce((a, b) => a + b, 0),
      topSkipped: top(allMisses),
      avgMinutes: allMinutes.length ? Math.round(allMinutes.reduce((a, b) => a + b, 0) / allMinutes.length) : null,
      photoPct: photoNeed ? Math.round((photoDone / photoNeed) * 100) : null,
      reminders: pushes.filter((p) => inScope(p.userId)).length,
    },
    lists: listOut
      .map((l) => ({ id: l.id, title: l.title, division: l.division, days: l.days, fullPct: Math.round((l.full / l.days) * 100), avgPct: Math.round((l.pctSum / l.days) * 100), topSkipped: top(l.misses) }))
      .sort((a, b) => a.fullPct - b.fullPct),
    people: [...personAgg]
      .map(([u, a]) => ({
        userId: u,
        name: who.get(u) ?? '—',
        division: divisionOf(people.get(u)?.primary ?? ''),
        listDays: a.listDays,
        complete: a.complete,
        avgPct: a.listDays ? Math.round((a.pctSum / a.listDays) * 100) : 0,
        afterReminder: a.afterReminder,
      }))
      .sort((a, b) => a.avgPct - b.avgPct || a.name.localeCompare(b.name, 'pl')),
  };
}

/* ───────── Szkolenia i dokumenty (mockup 16) ───────── */

export async function trainingStats(db: D1Database, locId: string, from: string, to: string, scope: Scope, now: number) {
  const lo = warsawToMs(from, '00:00');
  const hi = warsawToMs(to, '23:59') + 60_000;
  const { results: staff } = await db
    .prepare(
      `SELECT u.id, u.first_name AS f, u.last_name AS l, u.first_login_at AS firstLoginAt, group_concat(ul.position) AS positions
       FROM users u JOIN user_locations ul ON ul.user_id = u.id AND ul.location_id = ? AND ul.is_active = 1
       WHERE u.role = 'employee' AND u.status = 'active' GROUP BY u.id`,
    )
    .bind(locId)
    .all<{ id: string; f: string; l: string; firstLoginAt: number | null; positions: string }>();
  const people = staff
    .map((s) => {
      const raw = s.positions.split(',');
      return { id: s.id, name: `${s.f} ${s.l}`.trim(), firstLoginAt: s.firstLoginAt, raw, positions: [...new Set(raw.flatMap((p) => [p, divisionOf(p)]))], division: divisionOf(raw[0] ?? '') };
    })
    .filter((p) => !scope || p.raw.some((x) => scope.has(divisionOf(x))));
  const ids = new Set(people.map((p) => p.id));

  // documents: the state now, and how many confirmations in the period came in time
  const ackDays = await ackDaysOf(db, locId);
  const docs = (await visibleContent(db, locId, null, MANDATORY_KINDS)).filter((d) => d.requiresAck && !d.externalUrl);
  const dl = await deadlinesFor(db, locId, people, now);
  const versions = new Map<string, (VersionRef & { createdAt: number; id: string })[]>();
  const acks: { userId: string; itemId: string; versionId: string; at: number }[] = [];
  const docIds = docs.map((d) => d.id);
  for (let i = 0; i < docIds.length; i += 80) {
    const chunk = docIds.slice(i, i + 80);
    const q = chunk.map(() => '?').join(', ');
    const [v, a] = await db.batch([
      db.prepare(`SELECT id, content_item_id AS itemId, version_no AS versionNo, change_level AS changeLevel, created_at AS createdAt FROM content_versions WHERE content_item_id IN (${q})`).bind(...chunk),
      db.prepare(`SELECT user_id AS userId, content_item_id AS itemId, version_id AS versionId, acknowledged_at AS at FROM content_acknowledgements WHERE content_item_id IN (${q})`).bind(...chunk),
    ]);
    for (const r of v!.results as (VersionRef & { itemId: string; createdAt: number; id: string })[]) (versions.get(r.itemId) ?? versions.set(r.itemId, []).get(r.itemId)!).push(r);
    for (const r of a!.results as { userId: string; itemId: string; versionId: string; at: number }[]) if (ids.has(r.userId)) acks.push(r);
  }
  const versionById = new Map<string, { createdAt: number }>();
  for (const vs of versions.values()) for (const v of vs) versionById.set(v.id, v);
  const firstLogin = new Map(people.map((p) => [p.id, p.firstLoginAt ?? 0]));
  const inPeriod = acks.filter((a) => a.at >= lo && a.at < hi);
  const onTime = (a: (typeof acks)[number]) => a.at <= Math.max(firstLogin.get(a.userId) ?? 0, versionById.get(a.versionId)?.createdAt ?? 0) + ackDays * DAY;
  const docRows = docs
    .map((d) => {
      const vs = (versions.get(d.id) ?? []).sort((a, b) => a.versionNo - b.versionNo);
      const should = people.filter((p) => p.firstLoginAt && isVisibleFor(d.positions, p.positions) && isVisibleFor(d.tabPositions, p.positions));
      let done = 0;
      let late = 0;
      for (const p of should) {
        const mine = new Set(acks.filter((a) => a.userId === p.id && a.itemId === d.id).map((a) => a.versionId));
        if (itemProgress(vs, mine).status === 'done') done++;
        if (dl.get(p.id)?.items.some((i) => i.id === d.id && i.overdue)) late++;
      }
      return { id: d.id, title: d.title, toRead: should.length, done, overdue: late };
    })
    .filter((d) => d.toRead > 0)
    .sort((a, b) => b.overdue - a.overdue || a.title.localeCompare(b.title, 'pl'));

  // tests submitted in the period
  const { results: attempts } = await db
    .prepare(
      `SELECT a.id, a.test_id AS testId, t.title, a.user_id AS userId, a.attempt_no AS attemptNo, a.score_percent AS score, a.passed
       FROM test_attempts a JOIN tests t ON t.id = a.test_id WHERE a.location_id = ? AND a.status = 'submitted' AND a.submitted_at BETWEEN ? AND ?`,
    )
    .bind(locId, lo, hi)
    .all<{ id: string; testId: string; title: string; userId: string; attemptNo: number; score: number | null; passed: number | null }>();
  const att = attempts.filter((a) => ids.has(a.userId));
  const answers: { attemptId: string; questionId: string; ok: number; text: string }[] = [];
  for (let i = 0; i < att.length; i += 80) {
    const chunk = att.slice(i, i + 80).map((a) => a.id);
    const { results } = await db
      .prepare(
        `SELECT aa.attempt_id AS attemptId, aa.question_id AS questionId, COALESCE(aa.is_correct, 0) AS ok, q.text FROM attempt_answers aa JOIN questions q ON q.id = aa.question_id
         WHERE aa.attempt_id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(...chunk)
      .all<{ attemptId: string; questionId: string; ok: number; text: string }>();
    answers.push(...results);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const tests = [...new Set(att.map((a) => a.testId))].map((tid) => {
    const list = att.filter((a) => a.testId === tid);
    const mine = new Set(list.map((a) => a.id));
    const byQ = new Map<string, { text: string; n: number; ok: number }>();
    for (const a of answers.filter((x) => mine.has(x.attemptId))) {
      const q = byQ.get(a.questionId) ?? { text: a.text, n: 0, ok: 0 };
      q.n++;
      q.ok += a.ok ? 1 : 0;
      byQ.set(a.questionId, q);
    }
    const hardest = [...byQ.values()].filter((q) => q.n >= 3).sort((a, b) => a.ok / a.n - b.ok / b.n)[0];
    return { testId: tid, title: list[0]!.title, attempts: list.length, passed: list.filter((a) => a.passed).length, avgScore: avg(list.map((a) => a.score ?? 0)), hardest: hardest && hardest.ok < hardest.n ? hardest.text : null };
  });
  const first = att.filter((a) => a.attemptNo === 1);

  // programs: people who started in the period, and everyone's progress for the table
  const progress = new Map<string, number | null>();
  for (const p of people) {
    const view = await programFor(db, { id: p.id, role: 'employee' } as SessionUser, locId);
    progress.set(p.id, view.program ? view.percent : null);
  }
  const newcomers = people.filter((p) => p.firstLoginAt && p.firstLoginAt >= lo && p.firstLoginAt < hi && progress.get(p.id) !== null);

  return {
    totals: {
      acks: inPeriod.length,
      onTimePct: inPeriod.length ? Math.round((inPeriod.filter(onTime).length / inPeriod.length) * 100) : null,
      overduePeople: people.filter((p) => dl.get(p.id)?.items.some((i) => i.overdue)).length,
      overdueDocs: [...dl.values()].reduce((a, d) => a + d.items.filter((i) => i.overdue).length, 0),
      attempts: att.length,
      passedPct: att.length ? Math.round((att.filter((a) => a.passed).length / att.length) * 100) : null,
      firstPassPct: first.length ? Math.round((first.filter((a) => a.passed).length / first.length) * 100) : null,
      avgScore: avg(att.map((a) => a.score ?? 0)),
      newcomers: newcomers.length,
      newcomersDone: newcomers.filter((p) => progress.get(p.id) === 100).length,
    },
    documents: docRows,
    tests: tests.sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0)),
    people: people
      .map((p) => {
        const mineAcks = inPeriod.filter((a) => a.userId === p.id);
        const mineAtt = att.filter((a) => a.userId === p.id);
        const testIds = [...new Set(mineAtt.map((a) => a.testId))];
        return {
          userId: p.id,
          name: p.name,
          division: p.division,
          acksOnTime: mineAcks.filter(onTime).length,
          acks: mineAcks.length,
          overdue: dl.get(p.id)?.items.filter((i) => i.overdue).length ?? 0,
          testsPassed: testIds.filter((t) => mineAtt.some((a) => a.testId === t && a.passed)).length,
          tests: testIds.length,
          avgScore: avg(mineAtt.map((a) => a.score ?? 0)),
          program: progress.get(p.id) ?? null,
        };
      })
      .sort((a, b) => b.overdue - a.overdue || (a.program ?? 101) - (b.program ?? 101) || a.name.localeCompare(b.name, 'pl')),
  };
}
