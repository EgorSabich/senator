/**
 * Stage 4: menu catalog, allergen confirmation, import (spec D5, L "Меню и поиск").
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, getRaw, ownerClient, SENATOR, upload } from './client';

let owner: Client;
let editor: Client; // menu.edit only
let editorId = '';
let waiter: Client;
let empB: Client;
let locB = '';

const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxRRRXyh9Sf//Z';
const JPEG = Uint8Array.from(atob(JPEG_B64), (ch) => ch.charCodeAt(0));

const ALL = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'];
const allergenSet = (contains: string[], unconfirmed: string[] = []) =>
  Object.fromEntries(ALL.map((a) => [a, contains.includes(a) ? 'contains' : unconfirmed.includes(a) ? 'unconfirmed' : 'not_contains']));
const diets = { vegetarian: 'no', vegan: 'no', gluten_free: 'yes', dairy_free: 'no' };

const bundleChunk = (items: unknown[]) => ({
  format: 'senator-menu-bundle',
  sections: { kitchen: { note: 'Bez glutenu w składzie to nie to samo co dla celiaków.' } },
  categories: [
    { section: 'kitchen', name: 'Zupy', sortOrder: 2 },
    { section: 'bar', name: 'Koktajle Autorskie', sortOrder: 0 },
  ],
  items,
});
const kitchenItem = {
  importKey: 'kitchen:zurek testowy',
  section: 'kitchen',
  category: 'Zupy',
  sortOrder: 1,
  nameGuest: 'Żurek testowy',
  howToSell: '„Klasyczny żurek na zakwasie.”',
  guestQuestions: '„Czy jest ostry?” - Nie.',
  allergens: {
    gluten: { status: 'contains', source: 'X' },
    eggs: { status: 'unconfirmed', source: '?' },
    milk: { status: 'not_contains', source: null },
  },
  diets: { vegetarian: { status: 'no', source: 'nie' }, gluten_free: { status: 'unconfirmed', source: 'tak*' } },
};
const barItem = {
  importKey: 'bar:hortus testowy',
  section: 'bar',
  category: 'Koktajle Autorskie',
  nameGuest: 'HORTUS testowy',
  namePos: 'HORTUS T',
  ingredients: ['London Dry Gin', 'Campari'],
  description: 'PROFIL SMAKOWY: Słodko-gorzki.',
  serving: 'Na podstawce',
  photo: { contentType: 'image/jpeg', data: JPEG_B64 },
};

beforeAll(async () => {
  owner = await ownerClient();
  const m = await owner.post('/api/admin/managers', { firstName: 'Marek', lastName: 'Menu', locationId: SENATOR });
  editorId = m.data.id;
  editor = await activateClient(m.data.login, m.data.tempSecret, 'HasloMarkaMenu2026');
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Kasia', lastName: 'Sala', position: 'waiter' });
  waiter = await activateClient(w.data.login, w.data.tempSecret, '582914');
  const locs = await owner.get('/api/admin/locations');
  locB = locs.data.locations.find((l: { id: string }) => l.id !== SENATOR)?.id;
  const e = await owner.post(`/api/admin/locations/${locB}/employees`, { firstName: 'Iga', lastName: 'Druga', position: 'waiter' });
  empB = await activateClient(e.data.login, e.data.tempSecret, '640273');
});

describe('menu permissions', () => {
  it('manager without menu rights cannot view or edit the admin menu', async () => {
    expect((await editor.get(`/api/admin/locations/${SENATOR}/menu`)).status).toBe(403);
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, bundleChunk([]))).status).toBe(403);
  });

  it('waiter cannot reach the admin menu', async () => {
    expect((await waiter.get(`/api/admin/locations/${SENATOR}/menu`)).status).toBe(403);
  });

  it('owner grants menu.edit only', async () => {
    const res = await owner.put(`/api/admin/managers/${editorId}/permissions`, { locationId: SENATOR, permissions: ['menu.edit'] });
    expect(res.status).toBe(200);
    expect((await editor.get(`/api/admin/locations/${SENATOR}/menu`)).status).toBe(200);
  });
});

describe('import', () => {
  it('imports items, categories, section note and photo', async () => {
    const res = await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, bundleChunk([kitchenItem, barItem]));
    expect(res.status).toBe(200);
    expect(res.data.created).toEqual(['Żurek testowy', 'HORTUS testowy']);
    expect(res.data.photos).toBe(1);
    const list = await editor.get(`/api/admin/locations/${SENATOR}/menu`);
    expect(list.data.sections.kitchen.note).toMatch(/celiaków/);
    expect(list.data.items.map((i: { nameGuest: string }) => i.nameGuest)).toEqual(expect.arrayContaining(['Żurek testowy', 'HORTUS testowy']));
    const z = list.data.items.find((i: { nameGuest: string }) => i.nameGuest === 'Żurek testowy');
    expect(z.allergenState).toBe('none');
  });

  it('a second import skips existing items (no duplicates)', async () => {
    const res = await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, bundleChunk([kitchenItem, barItem]));
    expect(res.data.created).toEqual([]);
    expect(res.data.skipped).toHaveLength(2);
    const list = await editor.get(`/api/admin/locations/${SENATOR}/menu`);
    expect(list.data.items.filter((i: { nameGuest: string }) => i.nameGuest === 'Żurek testowy')).toHaveLength(1);
    expect(list.data.categories.filter((c: { name: string }) => c.name === 'Zupy')).toHaveLength(1);
  });

  it('rejects a wrong format and oversized chunks', async () => {
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, { format: 'x', items: [] })).data.error).toBe('bundle_invalid');
    const many = Array.from({ length: 9 }, (_, i) => ({ ...kitchenItem, importKey: `k:${i}` }));
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, bundleChunk(many))).data.error).toBe('bundle_invalid');
  });

  it('rejects a fake photo', async () => {
    const fake = { ...barItem, importKey: 'bar:fake', nameGuest: 'Fake', photo: { contentType: 'image/jpeg', data: btoa('<svg onload=alert(1)>') } };
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/import`, bundleChunk([fake]))).data.error).toBe('image_type');
  });
});

describe('allergens are visible to waiters only after confirmation', () => {
  let zurek = '';

  it('imported allergens are hidden from waiters', async () => {
    const menu = await waiter.get(`/api/locations/${SENATOR}/menu`);
    expect(menu.status).toBe(200);
    const z = menu.data.items.find((i: { nameGuest: string }) => i.nameGuest === 'Żurek testowy');
    zurek = z.id;
    expect(z.allergens).toEqual([]);
    expect(z.diets).toEqual([]);
    expect(z.allergensComplete).toBe(false);
    const card = await waiter.get(`/api/menu/items/${zurek}`);
    expect(card.data.item.allergens).toEqual([]);
    expect(card.data.item.texts.howToSell).toMatch(/żurek/);
  });

  it('admin card keeps the source wording and shows all 14 allergens', async () => {
    const card = await editor.get(`/api/admin/menu/items/${zurek}`);
    expect(card.data.allergens).toHaveLength(14);
    expect(card.data.allergens.find((a: { allergenId: string }) => a.allergenId === 'eggs')).toMatchObject({ status: 'unconfirmed', sourceNote: '?', confirmedAt: null });
    expect(card.data.diets.find((d: { diet: string }) => d.diet === 'gluten_free')).toMatchObject({ status: 'unconfirmed', sourceNote: 'tak*' });
    expect(card.data.canConfirm).toBe(false);
  });

  it('manager without allergens.confirm cannot confirm', async () => {
    const res = await editor.put(`/api/admin/menu/items/${zurek}/allergens`, { allergens: allergenSet(['gluten']), diets });
    expect(res.status).toBe(403);
  });

  it('incomplete allergen list is refused', async () => {
    const res = await owner.put(`/api/admin/menu/items/${zurek}/allergens`, { allergens: { gluten: 'contains' }, diets });
    expect(res.data.error).toBe('allergens_incomplete');
  });

  it('after confirmation the waiter sees "contains" right away; a status change is a significant version', async () => {
    const res = await owner.put(`/api/admin/menu/items/${zurek}/allergens`, { allergens: allergenSet(['gluten', 'eggs']), diets, changeNote: 'Jajko potwierdzone przez kuchnię' });
    expect(res.status).toBe(200);
    expect(res.data.changed).toBe(true);
    const z = (await waiter.get(`/api/locations/${SENATOR}/menu`)).data.items.find((i: { id: string }) => i.id === zurek);
    expect(z.allergens).toEqual(['gluten', 'eggs']);
    expect(z.diets).toEqual(['gluten_free']);
    expect(z.allergensComplete).toBe(true);
    const card = await owner.get(`/api/admin/menu/items/${zurek}`);
    expect(card.data.versions[0]).toMatchObject({ versionNo: 2, changeLevel: 'significant' });
    expect(card.data.allergens.find((a: { allergenId: string }) => a.allergenId === 'eggs').confirmedByName).toBeTruthy();
  });

  it('confirming without changes does not create a version; "unconfirmed" stays hidden', async () => {
    const res = await owner.put(`/api/admin/menu/items/${zurek}/allergens`, { allergens: allergenSet(['gluten'], ['eggs']), diets });
    expect(res.data.versionNo).toBe(3);
    const again = await owner.put(`/api/admin/menu/items/${zurek}/allergens`, { allergens: allergenSet(['gluten'], ['eggs']), diets });
    expect(again.data).toMatchObject({ versionNo: 3, changed: false });
    const z = (await waiter.get(`/api/menu/items/${zurek}`)).data.item;
    expect(z.allergens).toEqual(['gluten']);
    expect(z.allergensComplete).toBe(false);
  });
});

describe('editing', () => {
  let id = '';
  let catId = '';

  it('creates a category and an item manually', async () => {
    const cat = await editor.post(`/api/admin/locations/${SENATOR}/menu/categories`, { section: 'kitchen', name: 'Desery testowe' });
    expect(cat.status).toBe(201);
    catId = cat.data.id;
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/categories`, { section: 'kitchen', name: 'Desery testowe' })).status).toBe(409);
    const item = await editor.post(`/api/admin/locations/${SENATOR}/menu/items`, { categoryId: catId, nameGuest: 'Sernik', howToSell: 'Domowy sernik.' });
    expect(item.status).toBe(201);
    id = item.data.id;
    expect((await editor.post(`/api/admin/locations/${SENATOR}/menu/items`, { categoryId: catId, nameGuest: '  ' })).data.error).toBe('item_name_required');
  });

  it('every edit needs a change level and creates a version; empty edit refused', async () => {
    expect((await editor.put(`/api/admin/menu/items/${id}`, { texts: { howToSell: 'Domowy sernik z wanilią.' } })).data.error).toBe('change_level_required');
    const v2 = await editor.put(`/api/admin/menu/items/${id}`, { texts: { howToSell: 'Domowy sernik z wanilią.' }, changeLevel: 'clarification' });
    expect(v2.data.versionNo).toBe(2);
    expect((await editor.put(`/api/admin/menu/items/${id}`, { texts: { howToSell: 'Domowy sernik z wanilią.' }, changeLevel: 'cosmetic' })).data.error).toBe('no_changes');
    const card = await editor.get(`/api/admin/menu/items/${id}`);
    const v1 = card.data.versions.find((v: { versionNo: number }) => v.versionNo === 1);
    const old = await editor.get(`/api/admin/menu/items/${id}/versions/${v1.id}`);
    expect(old.data.version.snapshot.texts.howToSell).toBe('Domowy sernik.');
  });

  it('cannot move an item to a bar category', async () => {
    const bar = (await editor.get(`/api/admin/locations/${SENATOR}/menu`)).data.categories.find((c: { section: string }) => c.section === 'bar');
    expect((await editor.put(`/api/admin/menu/items/${id}`, { categoryId: bar.id, changeLevel: 'cosmetic' })).data.error).toBe('category_section');
  });

  it('photo upload checks the type; photo needs a session', async () => {
    const bad = await upload(editor, `/api/admin/menu/items/${id}/photo`, new Blob([new TextEncoder().encode('<svg/>')], { type: 'image/jpeg' }), 'x.jpg');
    expect(bad.data.error).toBe('image_type');
    const ok = await upload(editor, `/api/admin/menu/items/${id}/photo`, new Blob([JPEG], { type: 'image/jpeg' }), 'sernik.jpg');
    expect(ok.status).toBe(201);
    expect((await getRaw(null, ok.data.photoSrc)).status).toBe(401);
    expect((await getRaw(waiter, ok.data.photoSrc)).status).toBe(200);
    expect((await getRaw(empB, ok.data.photoSrc)).status).toBe(404);
  });

  it('archived items disappear for waiters and come back after restore', async () => {
    expect((await editor.post(`/api/admin/menu/items/${id}/archive`)).status).toBe(200);
    const names = (await waiter.get(`/api/locations/${SENATOR}/menu`)).data.items.map((i: { nameGuest: string }) => i.nameGuest);
    expect(names).not.toContain('Sernik');
    expect((await waiter.get(`/api/menu/items/${id}`)).status).toBe(404);
    expect((await editor.get(`/api/admin/menu/items/${id}`)).data.item.isActive).toBe(false);
    await editor.post(`/api/admin/menu/items/${id}/restore`);
    expect((await waiter.get(`/api/menu/items/${id}`)).status).toBe(200);
  });
});

describe('isolation', () => {
  it('employee of another location cannot read this menu or its items', async () => {
    expect((await empB.get(`/api/locations/${SENATOR}/menu`)).status).toBe(404);
    const any = (await owner.get(`/api/admin/locations/${SENATOR}/menu`)).data.items[0];
    expect((await empB.get(`/api/menu/items/${any.id}`)).status).toBe(404);
  });

  it('menu requires a session', async () => {
    expect((await new Client().get(`/api/locations/${SENATOR}/menu`)).status).toBe(401);
  });

  it('import is written to the audit log', async () => {
    const audit = await owner.get(`/api/admin/audit?limit=500`);
    const actions = (audit.data.entries ?? audit.data.items ?? []).map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['menu.import', 'menu.allergens_confirm', 'menu.item_update']));
  });
});
