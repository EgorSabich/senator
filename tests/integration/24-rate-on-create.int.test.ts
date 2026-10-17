/** 2026-10-17: the hourly rate can be set right when a person is added (or hired from Rekrutacja). */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
beforeAll(async () => {
  owner = await ownerClient();
});

describe('rate on create', () => {
  it('adding an employee with a rate stores it for the position from the start date', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Rafał', lastName: 'Stawka', position: 'host', startDate: '2026-11-02', rate: '32,50' });
    expect(e.status).toBe(201);
    const card = await owner.get(`/api/admin/locations/${SENATOR}/users/${e.data.id}/summary`);
    const host = card.data.positions.find((p: { position: string }) => p.position === 'host');
    expect(host.history).toEqual([expect.objectContaining({ position: 'host', rateGrosze: 3250, validFrom: '2026-11-02' })]);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'X', lastName: 'Y', position: 'host', rate: 'abc' })).data.error).toBe('rate_invalid');
  });

  it('hiring a candidate with a rate', async () => {
    const c = await owner.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'Ida Nowa', position: 'waiter' });
    const h = await owner.post(`/api/admin/candidates/${c.data.candidate.id}/hire`, { rate: 30 });
    expect(h.status).toBe(201);
    const card = await owner.get(`/api/admin/locations/${SENATOR}/users/${h.data.id}/summary`);
    expect(card.data.positions[0].history[0]).toMatchObject({ position: 'waiter', rateGrosze: 3000 });
  });
});
