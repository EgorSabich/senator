/**
 * D43: Grafik — drafts vs published, templates, overlap, copy week, division-limited managers, days off with a deadline,
 * plan next to real times in Czas pracy.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';
import { addDays } from '../../src/shared/time';
import { weekStart } from '../../src/shared/schedule';

let owner: Client;
let waiter: Client;
let waiterId = '';
let cook: Client;
let cookId = '';
let chef: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const next = addDays(weekStart(today), 7);
const nextNext = addDays(next, 7);

beforeAll(async () => {
  owner = await ownerClient();
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Kasia', lastName: 'Grafik', position: 'waiter' });
  waiterId = w.data.id;
  waiter = await activateClient(w.data.login, w.data.tempSecret, '914062');
  const k = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Leon', lastName: 'Grafik', position: 'kitchen' });
  cookId = k.data.id;
  cook = await activateClient(k.data.login, k.data.tempSecret, '417306');
  const m = await owner.post('/api/admin/managers', { firstName: 'Szef', lastName: 'Kuchni', locationId: SENATOR });
  await owner.put(`/api/admin/managers/${m.data.id}/permissions`, { locationId: SENATOR, permissions: ['schedule.manage', 'division:kitchen'] });
  chef = new Client();
  await chef.login(m.data.login, m.data.tempSecret);
  await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'SzefKuchni2026!' });
});

describe('planning and publishing', () => {
  it('drafts are invisible to staff until published; edits and deletes wait for the next publish', async () => {
    const d = addDays(next, 1); // Tuesday
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: d, start: '10:00', end: '25:00' })).data.error).toBe('shift_time_invalid');
    const s1 = await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: d, start: '1000', end: '18:00' });
    expect(s1.status).toBe(201);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: d, start: '17:00', end: '22:00' })).data.error).toBe('shift_overlap');
    // a late shift across midnight is fine
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: addDays(d, 1), start: '18:00', end: '02:00' })).status).toBe(201);

    let mine = await waiter.get(`/api/locations/${SENATOR}/my-schedule?week=${next}`);
    expect(mine.data.shifts).toHaveLength(0);
    const wk = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${next}`);
    expect(wk.data.unpublished).toBe(2);
    expect(wk.data.templates.map((t: { startMin: number; endMin: number }) => [t.startMin, t.endMin])).toEqual(expect.arrayContaining([[600, 1080], [1080, 1560]]));
    expect((await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${addDays(next, 1)}`)).data.error).toBe('week_invalid');

    const pub = await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: next });
    expect(pub.data).toMatchObject({ published: 2, people: 1, userIds: [waiterId] });
    mine = await waiter.get(`/api/locations/${SENATOR}/my-schedule?week=${next}`);
    expect(mine.data.shifts.map((s: { startMin: number; endMin: number }) => [s.startMin, s.endMin])).toEqual([
      [600, 1080],
      [1080, 1560],
    ]);

    // change after publish: staff keep the old times until the next publish
    await owner.put(`/api/admin/schedule/shifts/${s1.data.id}`, { start: '11:00', end: '19:00' });
    const late = (await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${next}`)).data.shifts.find((s: { id: string }) => s.id !== s1.data.id);
    await owner.req('DELETE', `/api/admin/schedule/shifts/${late.id}`);
    mine = await waiter.get(`/api/locations/${SENATOR}/my-schedule?week=${next}`);
    expect(mine.data.shifts).toHaveLength(2);
    expect(mine.data.shifts[0].startMin).toBe(600);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: next })).data.published).toBe(2);
    mine = await waiter.get(`/api/locations/${SENATOR}/my-schedule?week=${next}`);
    expect(mine.data.shifts.map((s: { startMin: number }) => s.startMin)).toEqual([660]);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: next })).data.published).toBe(0);
  });

  it('copies the previous week into empty days only', async () => {
    const r = await owner.post(`/api/admin/locations/${SENATOR}/schedule/copy-week`, { week: nextNext });
    expect(r.data.created).toBeGreaterThanOrEqual(1);
    const again = await owner.post(`/api/admin/locations/${SENATOR}/schedule/copy-week`, { week: nextNext });
    expect(again.data.created).toBe(0);
    const wk = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${nextNext}`);
    expect(wk.data.shifts.find((s: { userId: string }) => s.userId === waiterId)).toMatchObject({ date: addDays(nextNext, 1), startMin: 660, published: false });
  });

  it('a manager limited to the kitchen plans and publishes only the kitchen', async () => {
    const wk = await chef.get(`/api/admin/locations/${SENATOR}/schedule?week=${next}`);
    expect(wk.status).toBe(200);
    expect(wk.data.divisions).toEqual(['kitchen']);
    expect(wk.data.editable).toEqual(['kitchen']);
    // D44: everyone with the schedule sees the whole team
    expect(wk.data.shifts.some((s: { userId: string }) => s.userId === waiterId)).toBe(true);
    expect(wk.data.unpublished).toBe(0);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: next, start: '08:00', end: '16:00' })).status).toBe(403);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: cookId, date: next, start: '08:00', end: '16:00' })).status).toBe(201);
    // the waiter's copied draft next-next week is not published by the chef
    await chef.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: nextNext });
    expect((await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${nextNext}`)).data.unpublished).toBeGreaterThanOrEqual(1);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: next })).data).toMatchObject({ published: 1, userIds: [cookId] });
    expect((await waiter.get(`/api/admin/locations/${SENATOR}/schedule?week=${next}`)).status).toBe(403);
    const cookView = await cook.get(`/api/locations/${SENATOR}/my-schedule?week=${next}`);
    expect(cookView.data.shifts).toHaveLength(1);
  });
});

describe('days off', () => {
  it('open until the deadline, then closed; the manager sees them', async () => {
    const r = await waiter.get(`/api/locations/${SENATOR}/unavailability`);
    expect(r.data.weeks[0].week).toBe(next);
    const target = r.data.weeks[1].week;
    expect(r.data.weeks[1].open).toBe(true);
    expect((await waiter.put(`/api/locations/${SENATOR}/unavailability`, { week: target, dates: [addDays(target, 2), addDays(target, 9)] })).data.error).toBe('invalid_input');
    expect((await waiter.put(`/api/locations/${SENATOR}/unavailability`, { week: target, dates: [addDays(target, 2), addDays(target, 4)], note: 'Egzamin' })).status).toBe(200);
    const wk = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${target}`);
    expect(wk.data.unavailability.filter((u: { userId: string }) => u.userId === waiterId).map((u: { date: string }) => u.date).sort()).toEqual([addDays(target, 2), addDays(target, 4)]);
    // deadline Monday 00:59 of the week before → the week after next is already closed? no: closes on Monday of next week.
    // A deadline that has passed: target = next week with the deadline on this week's Monday 00:59.
    await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { unavailDeadlineDow: 1, unavailDeadlineHour: 0 });
    const closed = await waiter.get(`/api/locations/${SENATOR}/unavailability`);
    expect(closed.data.weeks[0].open).toBe(false);
    expect((await waiter.put(`/api/locations/${SENATOR}/unavailability`, { week: next, dates: [] })).data.error).toBe('unavailability_closed');
    await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { unavailDeadlineDow: 0, unavailDeadlineHour: 23 });
  });
});

describe('plan in Czas pracy', () => {
  it('the published plan comes with the time calendar', async () => {
    const t = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${next}&to=${addDays(next, 6)}`);
    expect(t.data.plan.some((p: { userId: string; startMin: number }) => p.userId === waiterId && p.startMin === 660)).toBe(true);
  });
});
