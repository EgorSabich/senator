/** 2026-10-17: Statystyki — Czas pracy i koszt, Listy kontrolne, Szkolenia i dokumenty. */
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, businessDate, warsawDate, warsawToMs } from '../../src/shared/time';
import { weekStart } from '../../src/shared/schedule';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let viewer: Client;
let ola: Client;
let olaId = '';
let term: Client;
let listId = '';
let docId = '';
const W = weekStart(addDays(warsawDate(Date.now()), -35));
// the restaurant's working day (it starts at the hour set in Lokale), so the suite also passes after midnight
let today = warsawDate(Date.now());
// reading a document counts on its calendar day
const calToday = warsawDate(Date.now());
const A = `/api/admin/locations/${SENATOR}/stats`;
const li = (t: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mine = (rows: any[]) => rows.find((r: { userId: string }) => r.userId === olaId);

beforeAll(async () => {
  owner = await ownerClient();
  today = businessDate(Date.now(), (await owner.get(`/api/locations/${SENATOR}/info`)).data.location.dayStartHour);
  const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ola', lastName: 'Staty', position: 'hookah_master', rate: '40' , startDate: addDays(W, -7) });
  olaId = e.data.id;
  ola = await activateClient(e.data.login, e.data.tempSecret, '357913');
  // two planned shifts of 6 h, worked 7 h and 6 h
  for (const [d, out] of [
    [0, '23:00'],
    [1, '22:00'],
  ] as const) {
    await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: olaId, date: addDays(W, d), start: '16:00', end: '22:00' });
    await owner.post(`/api/admin/locations/${SENATOR}/time/entries`, { userId: olaId, clockInAt: warsawToMs(addDays(W, d), '16:00'), clockOutAt: warsawToMs(addDays(W, d), out) });
  }
  await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: W, notify: false });
  // a viewer who sees statistics but not rates
  const m = await owner.post('/api/admin/managers', { firstName: 'Wiktor', lastName: 'Staty', locationId: SENATOR, permissions: ['stats.view', 'division:hookah_master'] });
  viewer = new Client();
  await viewer.login(m.data.login, m.data.tempSecret);
  await viewer.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'WiktorHaslo2026!x' });
  // today's checklist, half done
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon staty' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  await term.post('/api/terminal/punch', { pin: '357913', clientId: `st-${Date.now()}` });
  listId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'checklist', title: 'Shisha — statystyka' })).data.id;
  await owner.put(`/api/admin/content/${listId}`, { body: { type: 'doc', content: [{ type: 'bulletList', content: [li('Węgiel rozpalony'), li('Fajki umyte')] }] }, positions: ['hookah_master'] });
  await owner.post(`/api/admin/content/${listId}/publish`, {});
  const v = await ola.get(`/api/checklists/${listId}/today`);
  await ola.post(`/api/checklists/${listId}/marks`, { key: v.data.items[0].key });
  // a mandatory document, read today
  docId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Bezpieczeństwo przy shishy' })).data.id;
  await owner.put(`/api/admin/content/${docId}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Węgiel tylko szczypcami.' }] }] }, positions: ['hookah_master'] });
  await owner.post(`/api/admin/content/${docId}/publish`, {});
  const got = await ola.get(`/api/content/${docId}`);
  await ola.post(`/api/content/${docId}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true });
});

describe('czas pracy i koszt', () => {
  it('hours, hours above the plan, cost by the rate', async () => {
    const r = await owner.get(`${A}/cost?from=${W}&to=${addDays(W, 6)}&division=hookah_master`);
    expect(r.status).toBe(200);
    expect(mine(r.data.people)).toMatchObject({ shifts: 2, plannedMin: 720, workedMin: 780, overMin: 60, rate: 4000, cost: 52000 });
    expect(r.data.totals.cost).toBeGreaterThanOrEqual(52000);
    expect(r.data.byDivision.find((d: { division: string }) => d.division === 'hookah_master')).toBeTruthy();
  });
  it('without access to rates: hours only', async () => {
    const r = await viewer.get(`${A}/cost?from=${W}&to=${addDays(W, 6)}`);
    expect(r.data.wages).toBe(false);
    expect(r.data.totals.cost).toBeUndefined();
    expect(mine(r.data.people)).toMatchObject({ workedMin: 780 });
    expect(mine(r.data.people).cost).toBeUndefined();
    expect(r.data.divisions).toEqual(['hookah_master']);
  });
});

describe('listy kontrolne', () => {
  it('half of the list done today, the skipped item named', async () => {
    const r = await owner.get(`${A}/checklists?from=${today}&to=${today}&division=hookah_master`);
    const l = r.data.lists.find((x: { id: string }) => x.id === listId);
    // other shisha people from earlier suites work today too and did nothing on this list
    expect(l).toMatchObject({ days: 1, fullPct: 0, topSkipped: 'Fajki umyte' });
    expect(mine(r.data.people)).toMatchObject({ complete: 0 });
    expect(mine(r.data.people).avgPct).toBeLessThan(100);
  });
});

describe('szkolenia i dokumenty', () => {
  it('a document read in time; nothing overdue', async () => {
    const r = await owner.get(`${A}/training?from=${calToday}&to=${calToday}&division=hookah_master`);
    expect(r.status).toBe(200);
    expect(r.data.totals).toMatchObject({ acks: 1, onTimePct: 100 });
    const d = r.data.documents.find((x: { id: string }) => x.id === docId);
    expect(d).toMatchObject({ done: 1, overdue: 0 });
    expect(d.toRead).toBeGreaterThanOrEqual(1);
    expect(mine(r.data.people)).toMatchObject({ acks: 1, acksOnTime: 1, overdue: 0 });
  });
  it('employees cannot see statistics', async () => {
    expect((await ola.get(`${A}/training?from=${calToday}&to=${calToday}`)).status).toBe(403);
  });
});
