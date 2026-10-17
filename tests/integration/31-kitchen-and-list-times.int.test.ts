/** 2026-10-17: cook specialisations belong to Kuchnia; checklist reminders can go out at a set time. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
let chef: Client;
const N = `/api/admin/locations/${SENATOR}/notifications`;

beforeAll(async () => {
  owner = await ownerClient();
  const x = MANAGER_ROLES.head_chef;
  const m = await owner.post('/api/admin/managers', {
    firstName: 'Kuba',
    lastName: 'Kuchnia',
    locationId: SENATOR,
    permissions: [...x.permissions, ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'head_chef'],
  });
  chef = new Client();
  await chef.login(m.data.login, m.data.tempSecret);
  await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'KubaKuchnia2026!x' });
});

describe('cook specialisations', () => {
  it('a sushi cook is added by the head chef and is in Kuchnia', async () => {
    const e = await chef.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Saki', lastName: 'Sushi', position: 'kitchen_sushi' });
    expect(e.status).toBe(201);
    const list = (await chef.get(`/api/admin/locations/${SENATOR}/employees`)).data.employees;
    expect(list.some((p: { id: string }) => p.id === e.data.id)).toBe(true);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Wiki', lastName: 'Kelner', position: 'waiter' })).status).toBe(403);
    const shift = await chef.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: e.data.id, date: '2027-01-12', start: '10:00', end: '18:00' });
    expect(shift.status).toBe(201);
  });
});

describe('checklist reminders at a set time', () => {
  it('time or minutes; back to minutes with null', async () => {
    expect((await owner.put(`${N}/rules`, { division: 'kitchen', kind: 'checklist_open', timeMin: 600 })).status).toBe(200);
    expect((await owner.get(N)).data.rules.kitchen.checklist_open).toMatchObject({ timeMin: 600 });
    expect((await owner.put(`${N}/rules`, { division: 'kitchen', kind: 'checklist_close', timeMin: 1381 })).data.error).toBe('invalid_time');
    expect((await owner.put(`${N}/rules`, { division: 'kitchen', kind: 'checklist_open', timeMin: null, minutes: 20 })).status).toBe(200);
    expect((await owner.get(N)).data.rules.kitchen.checklist_open).toMatchObject({ timeMin: null, minutes: 20 });
  });
});
