/**
 * Time clock (D35) and daily checklists (D36): terminal account, punches by PIN only, offline re-sends,
 * unique PINs, panel corrections, checklist marks while on shift.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let terminalPassword = '';
let terminalId = '';
let anna: Client;
let annaId = '';
let bartek: Client;
let checklistId = '';
const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sala' }] },
    {
      type: 'bulletList',
      content: ['Wytrzyj stoły.', 'Ustaw krzesła.', 'Sprawdź menu QR.'].map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })),
    },
  ],
};
let n = 0;
const cid = () => `test-${Date.now()}-${n++}`;
const punch = (pin: string, extra: Record<string, unknown> = {}) => term.post('/api/terminal/punch', { pin, clientId: cid(), ...extra });

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon sala' });
  expect(t.status).toBe(201);
  terminalId = t.data.id;
  terminalPassword = t.data.tempSecret;
  term = new Client();
  expect((await term.login(t.data.login, terminalPassword)).status).toBe(200);

  const a = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Anna', lastName: 'Zegar', position: 'waiter' });
  annaId = a.data.id;
  expect((await punch(a.data.tempSecret)).data.outcome).toBe('unknown_pin'); // a temporary PIN never works on the terminal
  anna = await activateClient(a.data.login, a.data.tempSecret, '702615');
  const b = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Bartek', lastName: 'Zegar', position: 'waiter' });
  bartek = await activateClient(b.data.login, b.data.tempSecret, '813726');
});

describe('terminal account', () => {
  it('reaches only the terminal API', async () => {
    const s = await term.get('/api/terminal/status');
    expect(s.status).toBe(200);
    expect(s.data.terminal.name).toBe('Telefon sala');
    expect((await term.get(`/api/locations/${SENATOR}/home`)).status).toBe(403);
    expect((await term.get(`/api/admin/locations/${SENATOR}/employees`)).status).toBe(403);
    expect((await term.post('/api/auth/logout')).status).toBe(403);
    expect((await anna.get('/api/terminal/status')).status).toBe(403);
  });
});

describe('punches', () => {
  it('first PIN starts the shift, a quick second one is a double tap, a later one ends it', async () => {
    const first = await punch('702615');
    expect(first.data).toMatchObject({ outcome: 'in', firstName: 'Anna' });
    expect((await punch('702615')).data.outcome).toBe('duplicate');
    // move the start 3 hours back (manager correction), then the next PIN closes the shift
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=2026-01-01&to=2026-02-28`);
    expect(cal.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const range = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today.slice(0, 8)}01&to=${today}`);
    const entry = [...range.data.entries, ...range.data.openBefore].find((e: { userId: string }) => e.userId === annaId);
    expect(entry.clockOutAt).toBeNull();
    expect((await owner.put(`/api/admin/time/entries/${entry.id}`, { clockInAt: entry.clockInAt - 3 * 3600_000, clockOutAt: null })).status).toBe(200);
    const out = await punch('702615');
    expect(out.data.outcome).toBe('out');
    expect(out.data.minutes).toBeGreaterThanOrEqual(180);
  });

  it('accepts offline punches with their own time, once', async () => {
    const clientId = cid();
    const at = Date.now() - 20 * 60_000;
    const r1 = await term.post('/api/terminal/punch', { pin: '813726', clientId, at, offline: true });
    expect(r1.data).toMatchObject({ outcome: 'in', at });
    const r2 = await term.post('/api/terminal/punch', { pin: '813726', clientId, at, offline: true });
    expect(r2.data).toMatchObject({ outcome: 'in', repeated: true });
    const old = await term.post('/api/terminal/punch', { pin: '813726', clientId: cid(), at: Date.now() - 5 * 86400_000, offline: true });
    expect(old.data.outcome).toBe('rejected');
  });

  it('keeps PINs unique: a PIN someone tried to take stops working for its holder too', async () => {
    const c = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Celina', lastName: 'Zegar', position: 'waiter' });
    const cel = new Client();
    await cel.login(c.data.login, c.data.tempSecret);
    expect((await cel.post('/api/auth/change-secret', { current: c.data.tempSecret, next: '702615' })).data.error).toBe('pin_unavailable');
    expect((await punch('702615')).data.outcome).toBe('unknown_pin');
    expect((await anna.get('/api/auth/me')).data.user.mustChangeSecret).toBe(true);
    expect((await anna.post('/api/auth/change-secret', { current: '702615', next: '702618' })).status).toBe(200);
    expect((await punch('702618')).data).toMatchObject({ outcome: 'in', firstName: 'Anna' });
  });

  it('managers are not timed: no terminal PIN, not in the calendar (D37)', async () => {
    const m = await owner.post('/api/admin/managers', { firstName: 'Marta', lastName: 'Zegar', locationId: SENATOR });
    const mgr = await activateClient(m.data.login, m.data.tempSecret, 'HasloMenedzeraZegar1');
    expect((await mgr.req('PUT', '/api/auth/terminal-pin', { password: 'HasloMenedzeraZegar1', pin: '914837' })).status).toBe(404);
    const today = new Date().toISOString().slice(0, 10);
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    expect(cal.data.people.every((p: { role: string }) => p.role === 'employee')).toBe(true);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: m.data.id, clockInAt: Date.now() - 7200_000, clockOutAt: Date.now() - 3600_000 })).status).toBe(404);
  });
});

describe('hourly rates and the employee card', () => {
  it('cost uses the rate valid on the day; only wages.manage sees money', async () => {
    const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${annaId}/rate`, { rate: '30,50', validFrom: '2026-01-01' })).status).toBe(200);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/users/${annaId}/rate`, { rate: -1 })).data.error).toBe('rate_invalid');
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${day(1)}&to=${day(0)}`);
    expect(cal.data.wages).toBe(true);
    expect(cal.data.rates).toEqual(expect.arrayContaining([{ userId: annaId, rateGrosze: 3050, validFrom: '2026-01-01' }]));
    const sum = await owner.get(`/api/admin/locations/${SENATOR}/users/${annaId}/summary`);
    expect(sum.status).toBe(200);
    expect(sum.data.rate.current).toBe(3050);
    expect(sum.data.hours.thisMonth.minutes).toBeGreaterThanOrEqual(180);
    expect(sum.data.hours.thisMonth.costGrosze).toBeGreaterThan(0);
    expect(sum.data.lessons).toMatchObject({ total: expect.any(Number) });

    const m = await owner.post('/api/admin/managers', { firstName: 'Ewa', lastName: 'Bezstawek', locationId: SENATOR, permissions: ['employees.view', 'time.manage'] });
    const mgr = await activateClient(m.data.login, m.data.tempSecret, 'HasloMenedzeraBez1');
    const c2 = await mgr.get(`/api/admin/locations/${SENATOR}/time?from=${day(1)}&to=${day(0)}`);
    expect(c2.data).toMatchObject({ wages: false, rates: [] });
    const s2 = await mgr.get(`/api/admin/locations/${SENATOR}/users/${annaId}/summary`);
    expect(s2.data.rate).toBeNull();
    expect(s2.data.hours.thisMonth.costGrosze).toBeUndefined();
    expect((await mgr.req('PUT', `/api/admin/locations/${SENATOR}/users/${annaId}/rate`, { rate: 99 })).status).toBe(403);
  });
});

describe('panel corrections', () => {
  it('adds, edits and deletes shifts; refuses overlaps and exits before entries', async () => {
    const base = Date.now() - 10 * 86400_000;
    const add = await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: annaId, clockInAt: base, clockOutAt: base + 8 * 3600_000, note: 'Zapomniała' });
    expect(add.status).toBe(201);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: annaId, clockInAt: base + 3600_000, clockOutAt: base + 2 * 3600_000 })).status).toBe(409);
    expect((await owner.put(`/api/admin/time/entries/${add.data.id}`, { clockInAt: base, clockOutAt: base - 60_000 })).data.error).toBe('time_out_before_in');
    expect((await owner.put(`/api/admin/time/entries/${add.data.id}`, { clockInAt: base, clockOutAt: base + 9 * 3600_000 })).status).toBe(200);
    const audit = await owner.get('/api/admin/audit?limit=50');
    expect(audit.data.entries.some((e: { action: string }) => e.action === 'time.entry_edit')).toBe(true);
    expect((await owner.req('DELETE', `/api/admin/time/entries/${add.data.id}`)).status).toBe(200);
    expect((await anna.get(`/api/admin/locations/${SENATOR}/time?from=2026-01-01&to=2026-01-07`)).status).toBe(403);
  });
});

describe('daily checklists', () => {
  beforeAll(async () => {
    const created = await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'checklist', title: 'Lista testowa zamknięcia' });
    checklistId = created.data.id;
    expect((await owner.get(`/api/admin/content/${checklistId}`)).data.item.checklistMode).toBe('individual'); // D42 default
    await owner.put(`/api/admin/content/${checklistId}`, { body: doc, positions: ['waiter'], checklistMode: 'shared' });
    expect((await owner.post(`/api/admin/content/${checklistId}/publish`, {})).status).toBe(200);
  });

  it('marks only while on shift; one item, one person; close with items left', async () => {
    const today = await anna.get(`/api/locations/${SENATOR}/checklists/today`);
    expect(today.status).toBe(200);
    expect(today.data.onShift.since).toBeGreaterThan(0);
    expect(today.data.checklists.find((x: { id: string }) => x.id === checklistId)).toMatchObject({ done: 0, total: 3, closed: false });
    const list = await anna.get(`/api/checklists/${checklistId}/today`);
    expect(list.data.total).toBe(3);
    const [k1, k2] = list.data.items.map((i: { key: string }) => i.key);

    // Celina never clocked in
    expect((await anna.post(`/api/checklists/${checklistId}/marks`, { key: k1 })).status).toBe(200);
    expect((await bartek.post(`/api/checklists/${checklistId}/marks`, { key: k1 })).data).toMatchObject({ error: 'item_taken', details: { name: 'Anna Zegar' } });
    expect((await bartek.post(`/api/checklists/${checklistId}/marks`, { key: k2 })).status).toBe(200);
    expect((await bartek.req('DELETE', `/api/checklists/${checklistId}/marks/${k1}`)).status).toBe(404); // not his
    expect((await bartek.req('DELETE', `/api/checklists/${checklistId}/marks/${k2}`)).status).toBe(200);
    expect((await bartek.post(`/api/checklists/${checklistId}/marks`, { key: k2 })).status).toBe(200);

    expect((await anna.post(`/api/checklists/${checklistId}/close`)).status).toBe(200);
    expect((await bartek.post(`/api/checklists/${checklistId}/marks`, { key: list.data.items[2].key })).data.error).toBe('checklist_closed');

    const date = list.data.date;
    const day = await owner.get(`/api/admin/locations/${SENATOR}/checklists/day?date=${date}`);
    const cl = day.data.checklists.find((x: { id: string }) => x.id === checklistId);
    expect(cl.done).toBe(2);
    expect(cl.closed).toMatchObject({ doneCount: 2, totalCount: 3, closedByName: 'Anna Zegar' });
    expect(cl.items.map((i: { mark: { name: string } | null }) => i.mark?.name ?? null)).toEqual(['Anna Zegar', 'Bartek Zegar', null]);
    const stats = await owner.get(`/api/admin/locations/${SENATOR}/checklists/stats?from=${date}&to=${date}`);
    expect(stats.data.people.map((p: { name: string; items: number }) => [p.name, p.items])).toEqual(expect.arrayContaining([['Anna Zegar', 1], ['Bartek Zegar', 1]]));
    expect((await owner.req('DELETE', `/api/admin/locations/${SENATOR}/checklists/${checklistId}/days/${date}`)).status).toBe(200);
    expect((await bartek.post(`/api/checklists/${checklistId}/marks`, { key: list.data.items[2].key })).status).toBe(200);
  });

  it('refuses marks from someone not on shift', async () => {
    const c = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Dorota', lastName: 'Zegar', position: 'waiter' });
    const dor = await activateClient(c.data.login, c.data.tempSecret, '925148');
    const list = await dor.get(`/api/checklists/${checklistId}/today`);
    expect(list.data.onShift).toBeNull();
    expect((await dor.post(`/api/checklists/${checklistId}/marks`, { key: list.data.items[0].key })).data.error).toBe('not_on_shift');
  });
});

describe('terminal safety', () => {
  it('pauses after five wrong PINs in a row', async () => {
    for (let i = 0; i < 5; i++) expect((await punch(`10${i}937`)).data.outcome).toBe('unknown_pin');
    const paused = await punch('100938');
    expect(paused.status).toBe(429);
    expect(paused.data.error).toBe('terminal_paused');
  });

  it('leaves terminal mode only with its password', async () => {
    expect((await term.post('/api/terminal/exit', { password: 'zle' })).status).toBe(401);
    expect((await term.post('/api/terminal/exit', { password: terminalPassword })).status).toBe(200);
    expect((await term.get('/api/terminal/status')).status).toBe(401);
    expect((await owner.post(`/api/admin/terminals/${terminalId}/disable`)).status).toBe(200);
    expect((await new Client().login((await owner.get(`/api/admin/locations/${SENATOR}/terminals`)).data.terminals[0].login, terminalPassword)).status).toBe(401);
  });
});
