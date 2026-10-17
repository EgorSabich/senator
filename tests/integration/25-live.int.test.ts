/** 2026-10-17: /changes — a fingerprint per area that moves when something changes; app version included. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
beforeAll(async () => {
  owner = await ownerClient();
});

describe('live changes', () => {
  it('needs a session and a location of the person', async () => {
    expect((await new Client().get(`/api/locations/${SENATOR}/changes`)).status).toBe(401);
    expect((await owner.get('/api/locations/loc_nope/changes')).status).toBe(404);
  });

  it('moves when the schedule or candidates change', async () => {
    const a = (await owner.get(`/api/locations/${SENATOR}/changes`)).data;
    expect(a.version).toMatch(/^\d+\.\d+\.\d+$/);
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Lena', lastName: 'Live', position: 'waiter' });
    const d = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: e.data.id, date: d, start: '10:00', end: '18:00' })).status).toBe(201);
    const b = (await owner.get(`/api/locations/${SENATOR}/changes`)).data;
    expect(b.areas.schedule).not.toBe(a.areas.schedule);
    expect(b.areas.recruitment).toBe(a.areas.recruitment);
    await owner.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'Ola Live', position: 'waiter' });
    const c = (await owner.get(`/api/locations/${SENATOR}/changes`)).data;
    expect(c.areas.recruitment).not.toBe(b.areas.recruitment);
  });
});
