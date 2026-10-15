/**
 * Permanent deletion (D30): employees, menu items and materials. Only archived / deactivated records,
 * the name (login / title) must be typed, everything linked goes in one transaction.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

beforeAll(async () => {
  owner = await ownerClient();
});

async function newEmployee(firstName: string, lastName: string) {
  const r = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName, lastName, position: 'bartender' });
  expect(r.status).toBe(201);
  return { id: r.data.id as string, login: r.data.login as string, temp: r.data.tempSecret as string };
}

async function publishDoc(title: string, client = owner) {
  const id = (await client.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title })).data.id as string;
  await client.put(`/api/admin/content/${id}`, { body: doc('Treść testowa do usunięcia.'), positions: ['bartender'], requiresAck: true });
  expect((await client.post(`/api/admin/content/${id}/publish`, {})).status).toBe(200);
  return id;
}

describe('deleting an employee', () => {
  it('needs deactivation first and the typed login; then removes the person and their history', async () => {
    const e = await newEmployee('Jan', 'Dousunięcia');
    const emp = await activateClient(e.login, e.temp, '715304');
    const docId = await publishDoc('Regulamin baru (test usuwania)');
    const got = await emp.get(`/api/content/${docId}`);
    expect((await emp.post(`/api/content/${docId}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true })).status).toBe(200);

    expect((await owner.req('DELETE', `/api/admin/users/${e.id}`, { confirm: e.login })).data.error).toBe('delete_needs_inactive');
    expect((await owner.post(`/api/admin/users/${e.id}/deactivate`)).status).toBe(200);

    const impact = await owner.get(`/api/admin/users/${e.id}/deletion`);
    expect(impact.data).toMatchObject({ confirmText: e.login, acknowledgements: 1 });
    expect((await owner.req('DELETE', `/api/admin/users/${e.id}`, { confirm: 'ktoś.inny' })).data.error).toBe('delete_confirm_mismatch');
    expect((await owner.req('DELETE', `/api/admin/users/${e.id}`, { confirm: `  ${e.login.toUpperCase()} ` })).status).toBe(200);

    const list = await owner.get(`/api/admin/locations/${SENATOR}/employees`);
    expect(list.data.employees.some((x: { id: string }) => x.id === e.id)).toBe(false);
    expect((await owner.get(`/api/admin/users/${e.id}/deletion`)).status).toBe(404);
    expect((await new Client().login(e.login, '715304')).status).toBe(401);
    // the material stays, without the deleted acknowledgement
    expect((await owner.get(`/api/admin/content/${docId}/deletion`)).data.acknowledgements).toBe(0);
    // the audit log keeps the action, not the name
    const audit = await owner.get('/api/admin/audit?limit=500');
    const entries = audit.data.entries.filter((a: { entityId: string }) => a.entityId === e.id);
    expect(entries.map((a: { action: string }) => a.action)).toContain('user.delete');
    expect(JSON.stringify(entries)).not.toContain('Dousuni');
  });

  it('never deletes the owner or yourself; a manager deletes only employees of his location', async () => {
    const me = await owner.get('/api/auth/me');
    const ownerId = me.data.user.id as string;
    expect((await owner.req('DELETE', `/api/admin/users/${ownerId}`, { confirm: me.data.user.login })).status).toBe(409);

    const m = await owner.post('/api/admin/managers', { firstName: 'Marta', lastName: 'Kasująca', locationId: SENATOR, permissions: ['employees.view', 'employees.manage', 'content.edit', 'menu.edit'] });
    const mgr = await activateClient(m.data.login, m.data.tempSecret, 'HasloMenedzera2026x');
    const e = await newEmployee('Piotr', 'Zwolniony');
    expect((await mgr.post(`/api/admin/users/${e.id}/deactivate`)).status).toBe(200);
    expect((await mgr.req('DELETE', `/api/admin/users/${e.id}`, { confirm: e.login })).status).toBe(200);
    expect((await mgr.req('DELETE', `/api/admin/users/${ownerId}`, { confirm: me.data.user.login })).status).toBe(404);

    // a manager who authored content can be deleted by the owner; his content stays without an author
    const docId = await publishDoc('Materiał autorstwa menedżera', mgr);
    expect((await owner.post(`/api/admin/users/${m.data.id}/deactivate`)).status).toBe(200);
    expect((await owner.req('DELETE', `/api/admin/users/${m.data.id}`, { confirm: m.data.login })).status).toBe(200);
    const after = await owner.get(`/api/admin/content/${docId}`);
    expect(after.status).toBe(200);
  });
});

describe('deleting a menu item', () => {
  it('only an archived item, with its guest name typed; versions and search entry go too', async () => {
    const cat = await owner.post(`/api/admin/locations/${SENATOR}/menu/categories`, { section: 'kitchen', name: 'Do usunięcia' });
    const item = await owner.post(`/api/admin/locations/${SENATOR}/menu/items`, { categoryId: cat.data.id, nameGuest: 'Zupa kasowana', howToSell: 'Test.' });
    const id = item.data.id as string;
    expect((await owner.req('DELETE', `/api/admin/menu/items/${id}`, { confirm: 'Zupa kasowana' })).data.error).toBe('delete_needs_archive');
    expect((await owner.post(`/api/admin/menu/items/${id}/archive`)).status).toBe(200);
    expect((await owner.req('DELETE', `/api/admin/menu/items/${id}`, { confirm: 'Zupa' })).data.error).toBe('delete_confirm_mismatch');
    expect((await owner.req('DELETE', `/api/admin/menu/items/${id}`, { confirm: 'zupa kasowana' })).status).toBe(200);
    expect((await owner.get(`/api/admin/menu/items/${id}`)).status).toBe(404);
  });
});

describe('deleting a material', () => {
  it('only archived; removed from programs together with acknowledgements', async () => {
    const e = await newEmployee('Ola', 'Czytelniczka');
    const emp = await activateClient(e.login, e.temp, '826415');
    const docId = await publishDoc('Instrukcja do usunięcia');
    const got = await emp.get(`/api/content/${docId}`);
    await emp.post(`/api/content/${docId}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true });
    const p = await owner.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Program baru', position: 'bartender' });
    const mod = await owner.post(`/api/admin/programs/${p.data.id}/modules`, { title: 'Start' });
    expect((await owner.put(`/api/admin/modules/${mod.data.id}/items`, { items: [{ contentItemId: docId }] })).status).toBe(200);

    expect((await owner.req('DELETE', `/api/admin/content/${docId}`, { confirm: 'Instrukcja do usunięcia' })).data.error).toBe('delete_needs_archive');
    expect((await owner.post(`/api/admin/content/${docId}/archive`)).status).toBe(200);
    expect((await owner.get(`/api/admin/content/${docId}/deletion`)).data).toMatchObject({ acknowledgements: 1, programs: 1, versions: 1 });
    expect((await owner.req('DELETE', `/api/admin/content/${docId}`, { confirm: 'Instrukcja do usunięcia' })).status).toBe(200);

    expect((await owner.get(`/api/admin/content/${docId}`)).status).toBe(404);
    const prog = await owner.get(`/api/admin/programs/${p.data.id}`);
    expect(JSON.stringify(prog.data)).not.toContain(docId);
    expect((await emp.get(`/api/content/${docId}`)).status).toBe(404);
  });
});
