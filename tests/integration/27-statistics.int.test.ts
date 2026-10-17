/**
 * 2026-10-17: Panel → Statystyki. Late from 5 minutes, absence = ended shift without a clock-in, „usprawiedliwione”
 * takes a shift out of the statistics, early leaving is not counted; leaders see their divisions. Recruitment funnel,
 * sources, rejection reasons, no-shows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';
import { addDays, warsawDate, warsawToMs } from '../../src/shared/time';
import { weekStart } from '../../src/shared/schedule';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let chef: Client;
let worker: Client;
const ids: Record<string, string> = {};
const W = weekStart(addDays(warsawDate(Date.now()), -28));
const R = `from=${W}&to=${addDays(W, 6)}`;
const A = `/api/admin/locations/${SENATOR}/stats`;

beforeAll(async () => {
  owner = await ownerClient();
  for (const [first, pos] of [
    ['Gosia', 'waiter'],
    ['Hubert', 'waiter'],
    ['Kasia', 'kitchen'],
  ]) {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: first, lastName: 'Stat', position: pos });
    ids[first!] = e.data.id;
    if (first === 'Gosia') worker = await activateClient(e.data.login, e.data.tempSecret, '864213');
  }
  const shift = async (who: string, day: number, start: string, end: string) =>
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: ids[who], date: addDays(W, day), start, end })).status).toBe(201);
  await shift('Gosia', 0, '16:00', '23:00');
  await shift('Gosia', 1, '16:00', '23:00');
  await shift('Gosia', 2, '16:00', '23:00');
  await shift('Hubert', 0, '16:00', '23:00');
  await shift('Kasia', 0, '10:00', '18:00');
  expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: W, notify: false })).status).toBe(200);
  const entry = async (who: string, day: number, inAt: string, outAt: string | null) =>
    expect(
      (
        await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, {
          userId: ids[who],
          clockInAt: warsawToMs(addDays(W, day), inAt),
          clockOutAt: outAt ? warsawToMs(addDays(W, day), outAt) : null,
        })
      ).status,
    ).toBe(201);
  await entry('Gosia', 0, '16:04', '22:00'); // 4 min: on time; leaving early is not counted
  await entry('Gosia', 1, '16:05', '23:00'); // 5 min: late
  await entry('Hubert', 0, '16:20', null); // late 20, no exit
  const x = MANAGER_ROLES.head_chef;
  const m = await owner.post('/api/admin/managers', {
    firstName: 'Marta',
    lastName: 'Stat',
    locationId: SENATOR,
    permissions: [...x.permissions, ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'head_chef'],
  });
  chef = new Client();
  await chef.login(m.data.login, m.data.tempSecret);
  await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'MartaHaslo2026!x' });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const person = (data: any, who: string) => data.people.find((p: { userId: string }) => p.userId === ids[who]) as Record<string, unknown> | undefined;

describe('attendance', () => {
  it('late from 5 minutes, absence without a clock-in, no exit', async () => {
    const r = await owner.get(`${A}/attendance?${R}`);
    expect(r.status).toBe(200);
    expect(person(r.data, 'Gosia')).toMatchObject({ division: 'waiter', shifts: 3, absences: 1, late: 1, lateAvgMin: 5, missingExit: 0 });
    expect(person(r.data, 'Hubert')).toMatchObject({ shifts: 1, late: 1, lateAvgMin: 20, missingExit: 1, fixedExit: 0 });
    expect(person(r.data, 'Kasia')).toMatchObject({ division: 'kitchen', absences: 1 });
    expect(r.data.weeks).toHaveLength(1);
    expect(r.data.canExcuse).toBe(true);
    const w = await owner.get(`${A}/attendance?${R}&division=waiter`);
    expect(person(w.data, 'Kasia')).toBeUndefined();
  });

  it('person days: plan, clock-in, lateness, status', async () => {
    const r = await owner.get(`${A}/attendance/${ids.Gosia}?${R}`);
    expect(r.data.name).toBe('Gosia Stat');
    expect(r.data.days.map((d: { status: string }) => d.status)).toEqual(['absent', 'late', 'ok']);
    expect(r.data.days[1]).toMatchObject({ lateMin: 5, division: 'waiter' });
  });

  it('„usprawiedliwione” takes the absence out; can be undone', async () => {
    const days = (await owner.get(`${A}/attendance/${ids.Gosia}?${R}`)).data.days;
    const sid = days[0].shiftId;
    expect((await owner.put(`${A}/excuses/${sid}`, { reason: 'zwolnienie' })).data.error).toBe('reason_invalid');
    expect((await owner.put(`${A}/excuses/${sid}`, { reason: 'sick', note: 'L4' })).status).toBe(200);
    let g = person((await owner.get(`${A}/attendance?${R}`)).data, 'Gosia');
    expect(g).toMatchObject({ absences: 0, excused: 1 });
    const d = (await owner.get(`${A}/attendance/${ids.Gosia}?${R}`)).data.days[0];
    expect(d).toMatchObject({ status: 'excused', excuse: { reason: 'sick', note: 'L4' } });
    expect((await owner.req('DELETE', `${A}/excuses/${sid}`)).status).toBe(200);
    g = person((await owner.get(`${A}/attendance?${R}`)).data, 'Gosia');
    expect(g).toMatchObject({ absences: 1, excused: 0 });
  });

  it('a head chef sees only the kitchen; employees see nothing', async () => {
    const r = await chef.get(`${A}/attendance?${R}`);
    expect(r.data.divisions).toEqual(['kitchen']);
    expect(person(r.data, 'Gosia')).toBeUndefined();
    expect(person(r.data, 'Kasia')).toMatchObject({ absences: 1 });
    expect((await chef.get(`${A}/attendance?${R}&division=waiter`)).status).toBe(403);
    expect((await chef.get(`${A}/attendance/${ids.Gosia}?${R}`)).status).toBe(404);
    const gosiaShift = (await owner.get(`${A}/attendance/${ids.Gosia}?${R}`)).data.days[0].shiftId;
    expect((await chef.put(`${A}/excuses/${gosiaShift}`, { reason: 'sick' })).status).toBe(403);
    const kasiaShift = (await chef.get(`${A}/attendance/${ids.Kasia}?${R}`)).data.days[0].shiftId;
    expect((await chef.put(`${A}/excuses/${kasiaShift}`, { reason: 'swap' })).status).toBe(200);
    expect((await worker.get(`${A}/attendance?${R}`)).status).toBe(403);
    expect((await owner.get(`${A}/attendance?from=${W}&to=${addDays(W, -1)}`)).data.error).toBe('date_invalid');
  });
});

const today = warsawDate(Date.now());
let base: Record<string, number> = {};
let baseChef = 0;
const minus = (t: Record<string, number>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? v - (base[k] ?? 0) : v]));

describe('recruitment', () => {
  it('source, rejection reason and no-shows are saved on the candidate', async () => {
    // other suites add candidates today too: compare with the numbers before
    base = (await owner.get(`${A}/recruitment?from=${today}&to=${today}`)).data.totals;
    baseChef = (await chef.get(`${A}/recruitment?from=${today}&to=${today}`)).data.totals.candidates;
    const C = `/api/admin/locations/${SENATOR}/candidates`;
    expect((await owner.post(C, { name: 'Zła Źródło', position: 'waiter', source: 'gazeta' })).data.error).toBe('source_invalid');
    const mk = async (name: string, position: string, source: string | null) => (await owner.post(C, { name, position, source })).data.candidate.id as string;
    const a = await mk('Adam Kand', 'waiter', 'pracuj');
    const b = await mk('Beata Kand', 'waiter', 'olx');
    const c = await mk('Cyryl Kand', 'kitchen', 'referral');
    await mk('Dorota Kand', 'kitchen', null);
    await owner.put(`/api/admin/candidates/${a}`, { interviewAt: '2026-11-02T12:00' });
    await owner.put(`/api/admin/candidates/${a}`, { trialAt: '2026-11-04T16:00' });
    await owner.put(`/api/admin/candidates/${a}`, { stage: 'hired' });
    await owner.put(`/api/admin/candidates/${b}`, { interviewAt: '2026-11-02T13:00' });
    const nb = await owner.put(`/api/admin/candidates/${b}`, { noShowInterview: true, stage: 'rejected', rejectReason: 'no_show' });
    expect(nb.data.candidate).toMatchObject({ noShowInterview: true, rejectReason: 'no_show', source: 'olx' });
    await owner.put(`/api/admin/candidates/${c}`, { stage: 'rejected', rejectReason: 'availability' });
    expect((await owner.put(`/api/admin/candidates/${c}`, { rejectReason: 'zly' })).data.error).toBe('reason_invalid');
  });

  it('funnel, sources, divisions; leaders see their own', async () => {
    const r = await owner.get(`${A}/recruitment?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    expect(minus(r.data.totals)).toMatchObject({ candidates: 4, interviews: 2, trials: 1, hired: 1, rejected: 2, interviewsBooked: 2, noShowInterview: 1, noSource: 1 });
    expect(r.data.sources).toEqual(expect.arrayContaining([{ source: 'pracuj', candidates: 1, hired: 1 }]));
    expect(r.data.byDivision.find((d: { division: string }) => d.division === 'kitchen')).toMatchObject({ topReason: 'availability' });
    const k = await chef.get(`${A}/recruitment?from=${today}&to=${today}`);
    expect(k.data.totals.candidates - baseChef).toBe(2);
    expect(k.data.byDivision.map((d: { division: string }) => d.division)).toEqual(['kitchen']);
  });
});
