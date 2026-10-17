/** 2026-10-17: Praca zdalna — call-center people start and end work in the app, marked „zdalnie”. */
import { beforeAll, describe, expect, it } from 'vitest';
import { businessDate } from '../../src/shared/time';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let ida: Client;
let idaId = '';
let waiter: Client;
let waiterId = '';
const R = `/api/locations/${SENATOR}/remote`;

beforeAll(async () => {
  owner = await ownerClient();
  const a = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ida', lastName: 'Zdalna', position: 'call_center' });
  idaId = a.data.id;
  ida = await activateClient(a.data.login, a.data.tempSecret, '593174');
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Wit', lastName: 'Zdalny', position: 'waiter' });
  waiterId = w.data.id;
  waiter = await activateClient(w.data.login, w.data.tempSecret, '604285');
});

describe('remote work', () => {
  it('off by default; only for call center', async () => {
    expect((await ida.get(R)).data.allowed).toBe(false);
    expect((await ida.post(`${R}/start`)).status).toBe(403);
    expect((await owner.put(`/api/admin/locations/${SENATOR}/users/${waiterId}/remote`, { enabled: true })).data.error).toBe('remote_call_center_only');
    expect((await owner.put(`/api/admin/locations/${SENATOR}/users/${idaId}/remote`, { enabled: true })).status).toBe(200);
    expect((await owner.get(`/api/admin/locations/${SENATOR}/users/${idaId}/summary`)).data.remoteWork).toBe(true);
    expect((await ida.get('/api/auth/me')).data.user.remoteWork).toBe(true);
    expect((await waiter.get('/api/auth/me')).data.user.remoteWork).toBe(false);
  });

  it('start and stop; marked „zdalnie” in Czas pracy', async () => {
    const s = await ida.post(`${R}/start`);
    expect(s.data.open).toMatchObject({ source: 'remote' });
    expect((await ida.post(`${R}/start`)).data.error).toBe('shift_open');
    const e = await ida.post(`${R}/stop`);
    expect(e.data).toMatchObject({ open: null, minutes: 0 });
    expect((await ida.post(`${R}/stop`)).data.error).toBe('no_remote_shift');
    // the working day starts at the hour set in Lokale: after midnight it is still yesterday
    const today = businessDate(Date.now(), (await owner.get(`/api/locations/${SENATOR}/info`)).data.location.dayStartHour);
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    const entry = cal.data.entries.find((x: { userId: string }) => x.userId === idaId);
    expect(entry).toMatchObject({ inSource: 'remote', outSource: 'remote' });
  });

  it('switched off: no more remote start', async () => {
    await owner.put(`/api/admin/locations/${SENATOR}/users/${idaId}/remote`, { enabled: false });
    expect((await ida.get(R)).data.allowed).toBe(false);
    expect((await ida.post(`${R}/start`)).status).toBe(403);
  });
});
