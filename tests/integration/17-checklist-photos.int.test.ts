/**
 * 2026-10-17 (iteration 2): individual checklist items that are ticked only with a photo.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, getRaw, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let a: Client;
let listId = '';
let n = 0;
const cid = () => `clp-${Date.now()}-${n++}`;
const li = (t: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const h = (t: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
const doc = { type: 'doc', content: [h('Bar'), { type: 'bulletList', content: [li('Wyczyść ekspres'), li('Wynieś śmieci')] }] };
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]).toString('base64');

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon bar zdj' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  const x = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Patryk', lastName: 'Foto', position: 'bartender' });
  a = await activateClient(x.data.login, x.data.tempSecret, '771539');
  expect((await term.post('/api/terminal/punch', { pin: '771539', clientId: cid() })).data.outcome).toBe('in');
  listId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'checklist', title: 'Bar — zdjęcia' })).data.id;
  await owner.put(`/api/admin/content/${listId}`, { body: doc, positions: ['bartender'] });
  await owner.post(`/api/admin/content/${listId}/publish`, {});
});

describe('photo items', () => {
  it('the leader picks items; validation', async () => {
    const v = await a.get(`/api/checklists/${listId}/today`);
    const key = v.data.items[0].key as string;
    expect(v.data.items[0].photo).toBe(false);
    expect((await owner.put(`/api/admin/content/${listId}`, { checklistPhotoKeys: ['zle'] })).data.error).toBe('invalid_input');
    expect((await owner.put(`/api/admin/content/${listId}`, { checklistPhotoKeys: [key] })).status).toBe(200);
    expect((await owner.get(`/api/admin/content/${listId}`)).data.item.checklistPhotoKeys).toEqual([key]);
    const v2 = await a.get(`/api/checklists/${listId}/today`);
    expect(v2.data.items.map((i: { photo: boolean }) => i.photo)).toEqual([true, false]);
  });

  it('a photo item needs a photo; the leader sees it; undo removes it', async () => {
    const v = await a.get(`/api/checklists/${listId}/today`);
    const [photoItem, plain] = v.data.items;
    expect((await a.post(`/api/checklists/${listId}/marks`, { key: photoItem.key })).data.error).toBe('photo_required');
    expect((await a.post(`/api/checklists/${listId}/marks`, { key: photoItem.key, photo: 'data:image/png;base64,AAAA' })).data.error).toBe('photo_required');
    expect((await a.post(`/api/checklists/${listId}/marks`, { key: plain.key })).status).toBe(200);
    expect((await a.post(`/api/checklists/${listId}/marks`, { key: photoItem.key, photo: JPEG })).status).toBe(200);
    const mine = await a.get(`/api/checklists/${listId}/today`);
    expect(mine.data.items[0].mark.photo).toBe(true);
    expect(mine.data.items[1].mark.photo).toBe(false);

    const date = mine.data.date;
    const day = await owner.get(`/api/admin/locations/${SENATOR}/checklists/day?date=${date}`);
    const cl = day.data.checklists.find((c: { id: string }) => c.id === listId);
    const by = cl.items[0].by[0];
    expect(by.photoId).toBeTruthy();
    expect(cl.items[1].by[0].photoId).toBeNull();
    const img = await getRaw(owner, `/api/admin/checklists/marks/${by.photoId}/photo`);
    expect(img.status).toBe(200);
    expect(img.type).toBe('image/jpeg');
    // staff cannot open photos in the panel
    expect((await getRaw(a, `/api/admin/checklists/marks/${by.photoId}/photo`)).status).toBe(403);

    expect((await a.req('DELETE', `/api/checklists/${listId}/marks/${photoItem.key}`)).status).toBe(200);
    expect((await getRaw(owner, `/api/admin/checklists/marks/${by.photoId}/photo`)).status).toBe(404);
  });

  it('shared lists ignore photo items', async () => {
    await owner.put(`/api/admin/content/${listId}`, { checklistMode: 'shared' });
    const v = await a.get(`/api/checklists/${listId}/today`);
    expect(v.data.items.some((i: { photo?: boolean }) => i.photo)).toBe(false);
    expect((await a.post(`/api/checklists/${listId}/marks`, { key: v.data.items[0].key })).status).toBe(200);
    await owner.put(`/api/admin/content/${listId}`, { checklistMode: 'individual' });
  });
});
