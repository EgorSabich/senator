/**
 * 2026-10-17: Dostępy — a leader paid by the hour (PIN for the terminal, counted like an employee) and
 * „Wyłącz dostęp” / „Włącz ponownie” / „Usuń na zawsze” for leaders.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX, type ManagerRole } from '../../src/shared/constants';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let gm: Client;
let barbara: Client;
let barbaraId = '';
let barbaraLogin = '';
let n = 0;
const cid = () => `mgr-${Date.now()}-${n++}`;
const perms = (r: ManagerRole) => {
  const x = MANAGER_ROLES[r];
  return [...(x.permissions === 'all' ? PERMISSIONS : x.permissions), ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + r];
};
async function leader(first: string, role: ManagerRole) {
  const m = await owner.post('/api/admin/managers', { firstName: first, lastName: 'Dostep', locationId: SENATOR, permissions: perms(role) });
  const c = new Client();
  await c.login(m.data.login, m.data.tempSecret);
  await c.post('/api/auth/change-secret', { current: m.data.tempSecret, next: `${first}Haslo2026!x` });
  return { c, id: m.data.id as string, login: m.data.login as string };
}

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon dostępy' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  gm = (await leader('Zbigniew', 'general_manager')).c;
  ({ c: barbara, id: barbaraId, login: barbaraLogin } = await leader('Barbara', 'head_bartender'));
});

describe('hourly leader', () => {
  it('owner switches it on with a position and rate; the leader must set a PIN', async () => {
    expect((await barbara.get('/api/auth/me')).data.user.needsPin).toBe(false);
    expect((await owner.put(`/api/admin/managers/${barbaraId}/time`, { locationId: SENATOR, enabled: true, position: 'kelner' })).data.error).toBe('position_invalid');
    expect((await owner.put(`/api/admin/managers/${barbaraId}/time`, { locationId: SENATOR, enabled: true, position: 'bartender', rate: '38,00' })).status).toBe(200);
    const me = (await barbara.get('/api/auth/me')).data.user;
    expect(me).toMatchObject({ tracksTime: true, needsPin: true });
    const list = (await owner.get('/api/admin/managers')).data.managers.find((m: { id: string }) => m.id === barbaraId);
    expect(list).toMatchObject({ tracksTime: true, pinSet: false });
    expect(list.hours[SENATOR]).toMatchObject({ position: 'bartender', rate: 38 });
  });

  it('PIN rules; then the terminal knows the leader', async () => {
    expect((await barbara.post('/api/auth/set-pin', { pin: '123456' })).status).toBe(400);
    expect((await gm.post('/api/auth/set-pin', { pin: '739251' })).status).toBe(403); // not hourly
    expect((await barbara.post('/api/auth/set-pin', { pin: '739251' })).status).toBe(200);
    expect((await barbara.get('/api/auth/me')).data.user.needsPin).toBe(false);
    const p = await term.post('/api/terminal/punch', { pin: '739251', clientId: cid() });
    expect(p.data).toMatchObject({ outcome: 'in', firstName: 'Barbara' });
  });

  it('counted like an employee: Czas pracy and Grafik', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const time = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    expect(time.data.people.some((x: { id: string }) => x.id === barbaraId)).toBe(true);
    const shift = await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: barbaraId, date: today, start: '18:00', end: '23:00' });
    expect(shift.status).toBe(201);
    expect(shift.data.shift?.division ?? 'bartender').toBe('bartender');
  });

  it('switched off: the PIN stops working', async () => {
    await term.post('/api/terminal/punch', { pin: '739251', clientId: cid(), offline: true, at: Date.now() - 1000 }).catch(() => undefined);
    expect((await owner.put(`/api/admin/managers/${barbaraId}/time`, { locationId: SENATOR, enabled: false })).status).toBe(200);
    expect((await barbara.get('/api/auth/me')).data.user).toMatchObject({ tracksTime: false, needsPin: false });
    expect((await term.post('/api/terminal/punch', { pin: '739251', clientId: cid() })).data.outcome).toBe('unknown_pin');
  });
});

describe('access', () => {
  it('a zarządzający switches a leader off and on; nobody switches himself off', async () => {
    expect((await gm.post(`/api/admin/managers/${barbaraId}/deactivate`)).status).toBe(200);
    expect((await barbara.get('/api/auth/me')).status).toBe(401);
    expect((await new Client().login(barbaraLogin, 'BarbaraHaslo2026!x')).status).toBe(401);
    const r = await gm.post(`/api/admin/managers/${barbaraId}/reactivate`);
    expect(r.data).toMatchObject({ login: barbaraLogin, secretKind: 'password' });
    expect((await new Client().login(barbaraLogin, r.data.tempSecret)).status).toBe(200);
    const me = (await gm.get('/api/auth/me')).data.user.id;
    expect((await gm.post(`/api/admin/managers/${me}/deactivate`)).data.error).toBe('own_permissions');
  });

  it('a head bartender cannot; delete forever needs a switched-off leader and the login typed', async () => {
    const chef = await leader('Szymon', 'head_chef');
    expect((await chef.c.post(`/api/admin/managers/${barbaraId}/deactivate`)).status).toBe(404);
    expect((await owner.req('DELETE', `/api/admin/managers/${barbaraId}`, { confirm: barbaraLogin })).data.error).toBe('delete_needs_inactive');
    await owner.post(`/api/admin/managers/${barbaraId}/deactivate`);
    expect((await owner.req('DELETE', `/api/admin/managers/${barbaraId}`, { confirm: 'zly' })).data.error).toBe('delete_confirm_mismatch');
    expect((await owner.req('DELETE', `/api/admin/managers/${barbaraId}`, { confirm: barbaraLogin })).status).toBe(200);
    expect((await owner.get('/api/admin/managers')).data.managers.some((m: { id: string }) => m.id === barbaraId)).toBe(false);
  });
});
