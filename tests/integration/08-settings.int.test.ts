/**
 * D38: location settings (details shown to staff, business-day start, missing-exit hours), program deletion,
 * Service Book mandatory to read.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let waiter: Client;

beforeAll(async () => {
  owner = await ownerClient();
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Iga', lastName: 'Ustawienia', position: 'waiter' });
  waiter = await activateClient(w.data.login, w.data.tempSecret, '736251');
});

describe('location settings', () => {
  it('owner edits details and time rules; staff see the details; validation', async () => {
    const before = await owner.get(`/api/admin/locations/${SENATOR}/settings`);
    expect(before.status).toBe(200);
    expect(before.data.location.dayStartHour).toBe(6);
    expect(before.data.counts).toMatchObject({ employees: expect.any(Number), terminals: expect.any(Number) });
    const put = await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, {
      address: 'ul. Senatorska 1, Warszawa',
      phone: '+48 22 000 00 00',
      email: 'kontakt@example.com',
      openingHours: { mon: '08:00–02:00', sun: 'zamknięte' },
      staffNote: 'Odprawa codziennie o 08:40.',
      dayStartHour: 5,
      staleHours: 14,
    });
    expect(put.status).toBe(200);
    const info = await waiter.get(`/api/locations/${SENATOR}/info`);
    expect(info.data.location).toMatchObject({ address: 'ul. Senatorska 1, Warszawa', staffNote: 'Odprawa codziennie o 08:40.', dayStartHour: 5 });
    expect(info.data.location.openingHours).toMatchObject({ mon: '08:00–02:00', tue: '', sun: 'zamknięte' });
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { email: 'nie-mail' })).data.error).toBe('email_invalid');
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { dayStartHour: 13 })).data.error).toBe('setting_invalid');
    expect((await waiter.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { dayStartHour: 4 })).status).toBe(403);
    const today = new Date().toISOString().slice(0, 10);
    const cal = await owner.get(`/api/admin/locations/${SENATOR}/time?from=${today}&to=${today}`);
    expect(cal.data).toMatchObject({ dayStartHour: 5, staleHours: 14 });
    // back to defaults for later suites
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { dayStartHour: 6, staleHours: 16 })).status).toBe(200);
  });
});

describe('programs', () => {
  it('deletes a program with its modules after typing its name; materials stay', async () => {
    const lesson = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title: 'Lekcja w programie do usunięcia' })).data.id;
    await owner.put(`/api/admin/content/${lesson}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] } });
    await owner.post(`/api/admin/content/${lesson}/publish`, {});
    const p = await owner.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Program kuchni do usunięcia', position: 'kitchen' });
    const m = await owner.post(`/api/admin/programs/${p.data.id}/modules`, { title: 'Start' });
    await owner.put(`/api/admin/modules/${m.data.id}/items`, { items: [{ contentItemId: lesson }] });
    expect((await owner.req('DELETE', `/api/admin/programs/${p.data.id}`, { confirm: 'zła nazwa' })).data.error).toBe('delete_confirm_mismatch');
    expect((await owner.req('DELETE', `/api/admin/programs/${p.data.id}`, { confirm: 'program kuchni do usunięcia' })).status).toBe(200);
    expect((await owner.get(`/api/admin/programs/${p.data.id}`)).status).toBe(404);
    expect((await owner.get(`/api/admin/content/${lesson}`)).status).toBe(200);
    expect((await waiter.req('DELETE', `/api/admin/programs/${p.data.id}`, { confirm: 'x' })).status).toBe(404);
  });
});

describe('service book', () => {
  it('new chapters are mandatory to read and show up as to confirm', async () => {
    const id = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'service_book', title: 'Rozdział obowiązkowy', section: 'Sala' })).data.id;
    await owner.put(`/api/admin/content/${id}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Standard.' }] }] } });
    await owner.post(`/api/admin/content/${id}/publish`, {});
    expect((await owner.get(`/api/admin/content/${id}`)).data.item.requiresAck).toBe(true);
    const home = await waiter.get(`/api/locations/${SENATOR}/home`);
    expect(home.data.toConfirm.some((d: { id: string }) => d.id === id)).toBe(true);
  });
});
