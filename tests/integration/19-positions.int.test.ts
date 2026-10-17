/**
 * 2026-10-17 (iteration 3): several positions per person, a rate per position, the shift paid by the planned position.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { weekStart } from '../../src/shared/schedule';
import { Client, ownerClient, SENATOR } from './client';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';

let owner: Client;
let olaId = '';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() - 3 * 86400_000));
const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00+02:00`);

beforeAll(async () => {
  owner = await ownerClient();
  olaId = (await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ola', lastName: 'Dwie', position: 'waiter' })).data.id;
});

describe('positions', () => {
  it('adds a second position, keeps one main, lists the person once', async () => {
    const r = await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/positions`, {
      positions: [{ position: 'waiter' }, { position: 'host', startDate: day }],
      primary: 'waiter',
    });
    expect(r.status).toBe(200);
    const list = (await owner.get(`/api/admin/locations/${SENATOR}/employees`)).data.employees.filter((e: { id: string }) => e.id === olaId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ position: 'waiter', positions: expect.arrayContaining(['waiter', 'host']) });
    const sum = await owner.get(`/api/admin/locations/${SENATOR}/users/${olaId}/summary`);
    expect(sum.data.positions.map((p: { position: string; primary: boolean }) => [p.position, p.primary])).toEqual([
      ['waiter', true],
      ['host', false],
    ]);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/positions`, { positions: [] })).data.error).toBe('positions_invalid');
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/positions`, { positions: [{ position: 'pilot' }] })).data.error).toBe('positions_invalid');
  });

  it('a chef cannot change a waiter', async () => {
    const x = MANAGER_ROLES.head_chef;
    const xp = x.permissions as readonly string[] | 'all';
    const perms = [...(xp === 'all' ? PERMISSIONS : xp), ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'head_chef'];
    const m = await owner.post('/api/admin/managers', { firstName: 'Szef', lastName: 'Pozycji', locationId: SENATOR, permissions: perms });
    const chef = new Client();
    await chef.login(m.data.login, m.data.tempSecret);
    await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'SzefPozycji2026!x' });
    const r = await chef.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/positions`, { positions: [{ position: 'kitchen' }] });
    expect([403, 404]).toContain(r.status);
  });

  it('rates per position; the planned position decides; the manager can override', async () => {
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/rate`, { rate: 30, validFrom: '2026-01-01', position: 'waiter' })).status).toBe(200);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/rate`, { rate: 20, validFrom: '2026-01-01', position: 'host' })).status).toBe(200);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/rate`, { rate: 20, position: 'kitchen' })).data.error).toBe('position_invalid');

    const s = await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: olaId, date: day, division: 'host', start: '12:00', end: '16:00' });
    expect(s.status).toBe(201);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: weekStart(day) })).status).toBe(200);
    const e = await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: olaId, clockInAt: at('12:00'), clockOutAt: at('16:00') });
    expect(e.status).toBe(201);

    const time = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${day}&to=${day}`);
    const entry = time.data.entries.find((x: { userId: string }) => x.userId === olaId);
    expect(entry.position).toBe('host');
    expect(time.data.rates.filter((r: { userId: string }) => r.userId === olaId).map((r: { position: string }) => r.position).sort()).toEqual(['host', 'waiter']);
    const month = day.slice(0, 7);
    const thisOrPrev = (sum: Record<string, any>): { costGrosze: number } => (Object.values(sum.hours) as { month: string; costGrosze: number }[]).find((h) => h.month === month)!;
    expect(thisOrPrev((await owner.get(`/api/admin/locations/${SENATOR}/users/${olaId}/summary`)).data).costGrosze).toBe(8000); // 4 h × 20 zł

    expect((await owner.req('PUT', `/api/admin/time/entries/${entry.id}`, { clockInAt: at('12:00'), clockOutAt: at('16:00'), position: 'waiter' })).status).toBe(200);
    expect(thisOrPrev((await owner.get(`/api/admin/locations/${SENATOR}/users/${olaId}/summary`)).data).costGrosze).toBe(12000); // 4 h × 30 zł
    expect((await owner.req('PUT', `/api/admin/time/entries/${entry.id}`, { clockInAt: at('12:00'), clockOutAt: at('16:00'), position: 'bartender' })).data.error).toBe('position_invalid');
  });

  it('removing a position keeps the history; the last one stays', async () => {
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${olaId}/positions`, { positions: [{ position: 'host' }], primary: 'host' })).status).toBe(200);
    const list = (await owner.get(`/api/admin/locations/${SENATOR}/employees`)).data.employees.find((e: { id: string }) => e.id === olaId);
    expect(list).toMatchObject({ position: 'host', positions: ['host'] });
    const time = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${day}&to=${day}`);
    expect(time.data.entries.some((x: { userId: string }) => x.userId === olaId)).toBe(true);
  });
});
