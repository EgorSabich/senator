/**
 * D41: "Moje godziny" — own shifts and punches, hours only; materials assigned to positions in bulk.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let gosia: Client;
let gosiaId = '';
let other: Client;
let n = 0;
const cid = () => `my-${Date.now()}-${n++}`;
const bd = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(ms - 6 * 3600_000));

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon godziny' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  const g = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Gosia', lastName: 'Godziny', position: 'call_center' });
  gosiaId = g.data.id;
  gosia = await activateClient(g.data.login, g.data.tempSecret, '958406');
  const o = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Olek', lastName: 'Godziny', position: 'call_center' });
  other = await activateClient(o.data.login, o.data.tempSecret, '969517');
});

describe('my time', () => {
  it('shows own shifts and punches of the month, hours only', async () => {
    const now = Date.now();
    await term.post('/api/terminal/punch', { pin: '958406', clientId: cid(), offline: true, at: now - 3 * 3600_000 });
    await term.post('/api/terminal/punch', { pin: '958406', clientId: cid() });
    await term.post('/api/terminal/punch', { pin: '969517', clientId: cid() });
    const r = await gosia.get(`/api/locations/${SENATOR}/my-time`);
    expect(r.status).toBe(200);
    expect(r.data.month).toBe(bd(now).slice(0, 7));
    expect(r.data.nextMonth).toBeNull();
    expect(r.data.entries).toHaveLength(1);
    expect(r.data.entries[0]).toMatchObject({ date: bd(now - 3 * 3600_000), open: false, missingExit: false, byManager: false });
    expect(r.data.entries[0].minutes).toBeGreaterThanOrEqual(179);
    expect(r.data.totalMinutes).toBe(r.data.entries[0].minutes);
    expect(r.data.shifts).toBe(1);
    expect(r.data.punches.map((p: { outcome: string }) => p.outcome)).toEqual(['out', 'in']);
    expect(JSON.stringify(r.data)).not.toMatch(/rate|cost|wage/i);

    // a manager correction is marked
    const today = bd(now);
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    const entry = cal.data.entries.find((e: { userId: string }) => e.userId === gosiaId);
    expect((await owner.put(`/api/admin/time/entries/${entry.id}`, { clockInAt: entry.clockInAt - 15 * 60_000, clockOutAt: entry.clockOutAt, note: 'Przyszła wcześniej' })).status).toBe(200);
    const r2 = await gosia.get(`/api/locations/${SENATOR}/my-time`);
    expect(r2.data.entries[0].byManager).toBe(true);

    // other months; future months are not allowed
    const prev = await gosia.get(`/api/locations/${SENATOR}/my-time?month=${r.data.prevMonth}`);
    expect(prev.data.entries).toHaveLength(0);
    expect(prev.data.nextMonth).toBe(r.data.month);
    expect((await gosia.get(`/api/locations/${SENATOR}/my-time?month=2999-01`)).data.month).toBe(r.data.month);
    // only own data
    const o = await other.get(`/api/locations/${SENATOR}/my-time`);
    expect(o.data.entries).toHaveLength(1);
    expect(o.data.entries[0].open).toBe(true);
  });
});

describe('materials per position', () => {
  it('bulk positions: staff see only their own and the shared-for-all ones', async () => {
    const mk = async (title: string) => {
      const id = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title })).data.id as string;
      await owner.put(`/api/admin/content/${id}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] } });
      await owner.post(`/api/admin/content/${id}/publish`, {});
      return id;
    };
    const a = await mk('Skrypt rozmowy telefonicznej');
    const b = await mk('Rezerwacje telefoniczne');
    const forAll = await mk('Regulamin dla wszystkich (call center test)');
    expect((await gosia.post('/api/admin/content/positions', { ids: [a], positions: ['call_center'] })).status).toBe(403);
    expect((await owner.post('/api/admin/content/positions', { ids: [a, b], positions: ['nie_ma'] })).data.error).toBe('positions_invalid');
    const r = await owner.post('/api/admin/content/positions', { ids: [a, b], positions: ['call_center'] });
    expect(r.data.updated).toBe(2);
    expect((await owner.get(`/api/admin/content/${a}`)).data.item.positions).toEqual(['call_center']);

    const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Wiktor', lastName: 'Stanowisko', position: 'kitchen' });
    const kitchen = await activateClient(w.data.login, w.data.tempSecret, '970628');
    const libKitchen = (await kitchen.get(`/api/locations/${SENATOR}/library`)).data;
    const libGosia = (await gosia.get(`/api/locations/${SENATOR}/library`)).data;
    const ids = (lib: unknown) => JSON.stringify(lib);
    expect(ids(libKitchen)).not.toContain(a);
    expect(ids(libKitchen)).toContain(forAll);
    expect(ids(libGosia)).toContain(a);
    expect(ids(libGosia)).toContain(b);
    // back to everyone
    await owner.post('/api/admin/content/positions', { ids: [a, b], positions: [] });
    expect(JSON.stringify((await kitchen.get(`/api/locations/${SENATOR}/library`)).data)).toContain(a);
  });
});
