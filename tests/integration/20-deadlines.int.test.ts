/**
 * 2026-10-17 (iteration 3): N days to read mandatory documents; after that Grafik (view and days off) is locked
 * until the person reads them. Time tracking is not affected.
 */
// @ts-ignore -- tests run in Node; the app's tsconfig has no Node types
import { execSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let emp: Client;
let empId = '';
let docId = '';
const sql = (q: string) => execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/state-int --command "${q}"`, { stdio: 'pipe' });
const DAY = 86400_000;
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zasady pracy przy telefonie.' }] }] };

beforeAll(async () => {
  owner = await ownerClient();
  expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { ackDays: 2 })).status).toBe(200);
  docId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Regulamin call center' })).data.id;
  await owner.put(`/api/admin/content/${docId}`, { body: doc, positions: ['call_center'] });
  expect((await owner.post(`/api/admin/content/${docId}/publish`, {})).status).toBe(200);
  const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Celina', lastName: 'Termin', position: 'call_center' });
  empId = e.data.id;
  emp = await activateClient(e.data.login, e.data.tempSecret, '846213');
});

describe('reading period', () => {
  it('within the period: a deadline on Start, Grafik open', async () => {
    expect((await owner.get(`/api/admin/locations/${SENATOR}/settings`)).data.location?.ackDays ?? (await owner.get(`/api/admin/locations/${SENATOR}/settings`)).data.ackDays).toBe(2);
    const home = await emp.get(`/api/locations/${SENATOR}/home`);
    const item = home.data.deadlines.items.find((i: { id: string }) => i.id === docId);
    expect(item.overdue).toBe(false);
    expect(item.due - Date.now()).toBeGreaterThan(1.9 * DAY);
    expect(home.data.deadlines.lockedSince).toBeNull();
    expect((await emp.get(`/api/locations/${SENATOR}/my-schedule`)).data.locked).toBeFalsy();
  });

  it('after the period: Grafik and days off locked, leaders see it; reading unlocks', async () => {
    const back = Date.now() - 3 * DAY;
    sql(`UPDATE users SET first_login_at = ${back} WHERE id = '${empId}'`);
    sql(`UPDATE content_versions SET created_at = ${back} WHERE content_item_id = '${docId}'`);
    const sched = await emp.get(`/api/locations/${SENATOR}/my-schedule`);
    expect(sched.data.locked.documents.map((d: { id: string }) => d.id)).toContain(docId);
    expect(sched.data.shifts).toEqual([]);
    const unav = await emp.get(`/api/locations/${SENATOR}/unavailability`);
    expect(unav.data.locked).toBeTruthy();
    expect((await emp.req('PUT', `/api/locations/${SENATOR}/unavailability`, { week: unav.data.weeks[1].week, items: [] })).data.error).toBe('docs_overdue');
    expect((await emp.get(`/api/locations/${SENATOR}/home`)).data.deadlines.lockedSince).not.toBeNull();

    const today = await owner.get(`/api/admin/locations/${SENATOR}/today`);
    expect(today.data.documents.find((d: { userId: string }) => d.userId === empId)).toMatchObject({ overdue: 1 });
    const card = await owner.get(`/api/admin/locations/${SENATOR}/users/${empId}/summary`);
    expect(card.data.deadlines.lockedSince).not.toBeNull();

    const got = await emp.get(`/api/content/${docId}`);
    expect((await emp.post(`/api/content/${docId}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true })).status).toBe(200);
    expect((await emp.get(`/api/locations/${SENATOR}/my-schedule`)).data.locked).toBeFalsy();
    // other documents may still be pending (other tests publish ones for everyone), but nothing is overdue now
    const after = (await owner.get(`/api/admin/locations/${SENATOR}/today`)).data.documents.find((d: { userId: string }) => d.userId === empId);
    expect(after?.lockedSince ?? null).toBeNull();
  });

  it('settings validate the number of days', async () => {
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { ackDays: 0 })).status).toBe(400);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { ackDays: 3 })).status).toBe(200);
  });
});
