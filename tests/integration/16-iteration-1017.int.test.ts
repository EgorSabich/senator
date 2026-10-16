/**
 * 2026-10-17: first sign-in without retyping the temporary PIN, runners / barbacks in their divisions,
 * leaders off the staff list, days off for part of a day and entered by a leader, rate before the first rate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DIVISION_SCOPE_PREFIX, MANAGER_ROLES, ROLE_PREFIX } from '../../src/shared/constants';
import { addDays } from '../../src/shared/time';
import { weekStart } from '../../src/shared/schedule';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());

beforeAll(async () => {
  owner = await ownerClient();
});

describe('first sign-in', () => {
  it('sets the new PIN without typing the temporary one again; not the same as the temporary one', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Nowa', lastName: 'Osoba', position: 'waiter' });
    const c = new Client();
    await c.login(e.data.login, e.data.tempSecret);
    expect((await c.post('/api/auth/change-secret', { next: e.data.tempSecret })).data.error).toBe('same_secret');
    expect((await c.post('/api/auth/change-secret', { next: '518273' })).status).toBe(200);
    // later changes still need the current PIN
    expect((await c.post('/api/auth/change-secret', { next: '629384' })).data.error).toBe('wrong_current_secret');
  });
});

describe('assistants and leaders', () => {
  it('a runner sees waiter materials; a floor manager manages runners; leaders are not on the staff list', async () => {
    const doc = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Standard sali — runner' })).data.id;
    await owner.put(`/api/admin/content/${doc}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }, positions: ['waiter'] });
    await owner.post(`/api/admin/content/${doc}/publish`, {});
    const r = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Rysiek', lastName: 'Runner', position: 'waiter_assistant' });
    expect(r.status).toBe(201);
    const runner = await activateClient(r.data.login, r.data.tempSecret, '730495');
    expect(JSON.stringify((await runner.get(`/api/locations/${SENATOR}/library`)).data)).toContain(doc);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'job_description', title: 'x' })).data.error).toBe('kind_invalid');

    const fm = MANAGER_ROLES.floor_manager;
    const m = await owner.post('/api/admin/managers', {
      firstName: 'Fryderyk',
      lastName: 'Sala',
      locationId: SENATOR,
      permissions: [...fm.permissions, ...fm.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'floor_manager'],
    });
    const mc = new Client();
    await mc.login(m.data.login, m.data.tempSecret);
    await mc.post('/api/auth/change-secret', { next: 'FryderykSala2026!' });
    const list = await mc.get(`/api/admin/locations/${SENATOR}/employees`);
    expect(list.data.employees.some((e: { id: string }) => e.id === r.data.id)).toBe(true);
    expect((await mc.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Nowy', lastName: 'Runner', position: 'waiter_assistant' })).status).toBe(201);
    expect((await mc.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Nowy', lastName: 'Barback', position: 'bartender_assistant' })).data.error).toBe('outside_divisions');
    const all = await owner.get(`/api/admin/locations/${SENATOR}/employees`);
    expect(all.data.employees.some((e: { id: string }) => e.id === m.data.id)).toBe(false);
    // schedule: the runner is planned in "Kelnerzy"
    const wk = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${weekStart(today)}`);
    expect(wk.data.people.find((p: { id: string }) => p.id === r.data.id).divisions).toEqual(['waiter']);
  });
});

describe('days off', () => {
  it('part of a day from the person; a leader can add and remove; the person keeps the leader entry', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Paula', lastName: 'Pora', position: 'waiter' });
    const c = await activateClient(e.data.login, e.data.tempSecret, '841506');
    const weeks = (await c.get(`/api/locations/${SENATOR}/unavailability`)).data.weeks;
    const w = weeks.find((x: { open: boolean }) => x.open).week as string;
    expect(
      (await c.req('PUT', `/api/locations/${SENATOR}/unavailability`, { week: w, items: [{ date: w, fromMin: 0, toMin: 1020 }, { date: addDays(w, 1) }] })).status,
    ).toBe(200);
    // leader marks Wednesday 18:00 onwards
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/schedule/unavailability`, { userId: e.data.id, date: addDays(w, 2), fromMin: 1080, note: 'Powiedziała osobiście' })).status).toBe(200);
    // the person saves the week again with only Monday: the leader entry stays
    await c.req('PUT', `/api/locations/${SENATOR}/unavailability`, { week: w, items: [{ date: w, fromMin: 0, toMin: 1020 }] });
    const mine = (await c.get(`/api/locations/${SENATOR}/unavailability`)).data.weeks.find((x: { week: string }) => x.week === w).dates;
    expect(mine.map((d: { date: string; fromMin: number | null; toMin: number | null; byManager: number }) => [d.date, d.fromMin, d.toMin, Boolean(d.byManager)]).sort()).toEqual(
      [
        [w, 0, 1020, false],
        [addDays(w, 2), 1080, 1440, true],
      ].sort(),
    );
    const wk = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${w}`);
    const entry = wk.data.unavailability.find((u: { userId: string; date: string }) => u.userId === e.data.id && u.date === addDays(w, 2));
    expect(entry).toMatchObject({ fromMin: 1080, toMin: 1440, note: 'Powiedziała osobiście' });
    expect(entry.setByName).toBeTruthy();
    expect((await owner.req('DELETE', `/api/admin/locations/${SENATOR}/schedule/unavailability?userId=${e.data.id}&date=${addDays(w, 2)}`)).status).toBe(200);
    expect((await c.req('PUT', `/api/locations/${SENATOR}/unavailability`, { week: w, items: [{ date: w, fromMin: 900, toMin: 600 }] })).status).toBe(200); // reversed → whole day
  });
});

describe('rates', () => {
  it('a shift before the first rate is costed with that first rate', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Kasia', lastName: 'Stawka', position: 'kitchen' });
    await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: e.data.id, clockInAt: Date.now() - 5 * 86400_000, clockOutAt: Date.now() - 5 * 86400_000 + 4 * 3600_000 });
    await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${e.data.id}/rate`, { rate: 30 });
    const s = await owner.get(`/api/admin/locations/${SENATOR}/users/${e.data.id}/summary`);
    const all = [s.data.hours.thisMonth, s.data.hours.prevMonth].filter((m: { shifts: number }) => m.shifts > 0);
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ missingRate: false, costGrosze: 12000 });
  });
});
