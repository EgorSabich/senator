/**
 * D44: leadership roles. A head chef works only with the kitchen (staff, materials, programs, time, rates, menu),
 * sees the whole schedule; a zarządzający sees everything incl. leaders, location settings and the log. D45: "Dziś".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX, type ManagerRole } from '../../src/shared/constants';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
let chef: Client;
let gm: Client;
let gmId = '';
let waiterId = '';
let cookId = '';
const perms = (r: ManagerRole) => {
  const x = MANAGER_ROLES[r];
  return [...(x.permissions === 'all' ? PERMISSIONS : x.permissions), ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + r];
};
async function leader(first: string, role: ManagerRole) {
  const m = await owner.post('/api/admin/managers', { firstName: first, lastName: 'Rola', locationId: SENATOR, permissions: perms(role) });
  expect(m.status).toBe(201);
  const c = new Client();
  await c.login(m.data.login, m.data.tempSecret);
  await c.post('/api/auth/change-secret', { current: m.data.tempSecret, next: `${first}Haslo2026!x` });
  return { c, id: m.data.id as string };
}

beforeAll(async () => {
  owner = await ownerClient();
  chef = (await leader('Szymon', 'head_chef')).c;
  const g = await leader('Zenon', 'general_manager');
  gm = g.c;
  gmId = g.id;
  waiterId = (await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Wanda', lastName: 'Sala', position: 'waiter' })).data.id;
  cookId = (await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Kamil', lastName: 'Garnek', position: 'kitchen' })).data.id;
});

describe('head chef', () => {
  it('sees and manages only the kitchen team', async () => {
    const list = await chef.get(`/api/admin/locations/${SENATOR}/employees`);
    expect(list.data.divisions).toEqual(['kitchen']);
    const ids = list.data.employees.map((e: { id: string }) => e.id);
    expect(ids).toContain(cookId);
    expect(ids).not.toContain(waiterId);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'X', lastName: 'Y', position: 'waiter' })).data.error).toBe('outside_divisions');
    expect((await chef.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Nowy', lastName: 'Kucharz', position: 'kitchen' })).status).toBe(201);
    expect((await chef.post(`/api/admin/users/${waiterId}/reset-secret`)).status).toBe(403);
    expect((await chef.get(`/api/admin/locations/${SENATOR}/users/${waiterId}/summary`)).status).toBe(404);
    expect((await chef.get(`/api/admin/locations/${SENATOR}/users/${cookId}/summary`)).status).toBe(200);
    expect((await chef.req('PUT', `/api/admin/locations/${SENATOR}/users/${cookId}/rate`, { rate: 32 })).status).toBe(200);
    expect((await chef.req('PUT', `/api/admin/locations/${SENATOR}/users/${waiterId}/rate`, { rate: 32 })).status).toBe(404);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const cal = await chef.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    expect(cal.data.people.every((p: { id: string }) => p.id !== waiterId)).toBe(true);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: waiterId, clockInAt: Date.now() - 3600_000, clockOutAt: Date.now() - 60_000 })).data.error).toBe('outside_divisions');
  });

  it('materials: creates kitchen ones, reads shared ones, cannot touch the floor', async () => {
    const id = (await chef.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'sop', title: 'SOP mycia garnków' })).data.id;
    expect((await chef.get(`/api/admin/content/${id}`)).data.item).toMatchObject({ positions: ['kitchen'], editable: true });
    expect((await chef.put(`/api/admin/content/${id}`, { positions: [] })).data.error).toBe('outside_divisions');
    expect((await chef.put(`/api/admin/content/${id}`, { positions: ['kitchen', 'waiter'] })).data.error).toBe('outside_divisions');
    const forAll = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Regulamin dla wszystkich — role' })).data.id;
    const floor = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Regulamin sali — role' })).data.id;
    await owner.put(`/api/admin/content/${floor}`, { positions: ['waiter'] });
    expect((await chef.get(`/api/admin/content/${forAll}`)).data.item.editable).toBe(false);
    expect((await chef.put(`/api/admin/content/${forAll}`, { title: 'x' })).data.error).toBe('outside_divisions');
    expect((await chef.get(`/api/admin/content/${floor}`)).status).toBe(404);
    const list = await chef.get(`/api/admin/locations/${SENATOR}/content?kind=regulation`);
    const titles = list.data.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Regulamin dla wszystkich — role');
    expect(titles).not.toContain('Regulamin sali — role');
    // programs
    expect((await chef.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Sala', position: 'waiter' })).status).toBe(403);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Kuchnia — start', position: 'kitchen' })).status).toBe(201);
    const progs = await chef.get(`/api/admin/locations/${SENATOR}/programs`);
    expect(progs.data.programs.every((p: { position: string }) => p.position === 'kitchen')).toBe(true);
  });

  it('menu: kitchen only; no leaders, settings or log', async () => {
    const bar = await chef.post(`/api/admin/locations/${SENATOR}/menu/categories`, { section: 'bar', name: 'Koktajle szefa' });
    expect(bar.data.error).toBe('outside_divisions');
    expect((await chef.post(`/api/admin/locations/${SENATOR}/menu/categories`, { section: 'kitchen', name: 'Zupy szefa' })).status).toBe(201);
    expect((await chef.get(`/api/admin/locations/${SENATOR}/menu`)).data.editableSections).toEqual(['kitchen']);
    expect((await chef.get('/api/admin/managers')).status).toBe(403);
    expect((await chef.get('/api/admin/audit')).status).toBe(403);
    expect((await chef.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { staleHours: 12 })).status).toBe(403);
  });
});

describe('zarządzający', () => {
  it('sees everything, adds leaders, edits settings, reads the log; not his own permissions', async () => {
    expect((await gm.get(`/api/admin/locations/${SENATOR}/employees`)).data.employees.some((e: { id: string }) => e.id === waiterId)).toBe(true);
    const m = await gm.post('/api/admin/managers', { firstName: 'Barbara', lastName: 'Bar', locationId: SENATOR, permissions: perms('head_bartender') });
    expect(m.status).toBe(201);
    const list = await gm.get('/api/admin/managers');
    const bb = list.data.managers.find((x: { id: string }) => x.id === m.data.id);
    expect(bb.permissions[SENATOR]).toContain('role:head_bartender');
    expect(list.data.managers.find((x: { id: string }) => x.id === gmId).self).toBe(true);
    expect((await gm.req('PUT', `/api/admin/managers/${gmId}/permissions`, { locationId: SENATOR, permissions: [] })).data.error).toBe('own_permissions');
    expect((await gm.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { staleHours: 16 })).status).toBe(200);
    expect((await gm.get('/api/admin/audit')).status).toBe(200);
    expect((await gm.post('/api/admin/locations', { name: 'Drugi lokal' })).status).toBe(403); // new locations: owner only
  });
});

describe('Dziś', () => {
  it('plan vs reality for my divisions', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: cookId, date: today, start: '06:00', end: '21:00' })).status).toBe(201);
    await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: waiterId, date: today, start: '06:30', end: '21:30' });
    const monday = (() => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: monday });
    const all = await owner.get(`/api/admin/locations/${SENATOR}/today`);
    expect(all.status).toBe(200);
    expect(all.data.rows.map((r: { name: string }) => r.name)).toEqual(expect.arrayContaining(['Kamil G.', 'Wanda S.']));
    const c = await chef.get(`/api/admin/locations/${SENATOR}/today`);
    expect(c.data.rows.map((r: { name: string }) => r.name)).toContain('Kamil G.');
    expect(c.data.rows.map((r: { name: string }) => r.name)).not.toContain('Wanda S.');
    const row = c.data.rows.find((r: { name: string }) => r.name === 'Kamil G.');
    expect(['late', 'absent', 'not_yet']).toContain(row.status);
  });
});
