/**
 * D42: individual checklists (everyone on shift does every item) next to shared ones; checklist import with mode.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let a: Client;
let b: Client;
let listId = '';
let n = 0;
const cid = () => `clm-${Date.now()}-${n++}`;
const bd = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(ms - 6 * 3600_000));
const li = (t: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const doc = { type: 'doc', content: [{ type: 'bulletList', content: [li('Sprawdź shishe'), li('Uzupełnij węgiel'), li('Wyczyść wężyki')] }] };

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon shisha' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  const x = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Hubert', lastName: 'Shisha', position: 'hookah_master' });
  a = await activateClient(x.data.login, x.data.tempSecret, '981739');
  const y = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Igor', lastName: 'Shisha', position: 'hookah_master' });
  b = await activateClient(y.data.login, y.data.tempSecret, '992840');
  const z = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Jan', lastName: 'Shisha', position: 'hookah_master' });
  await activateClient(z.data.login, z.data.tempSecret, '903951');
  for (const pin of ['981739', '992840', '903951']) expect((await term.post('/api/terminal/punch', { pin, clientId: cid() })).data.outcome).toBe('in');
  listId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'checklist', title: 'Shisha — otwarcie' })).data.id;
  await owner.put(`/api/admin/content/${listId}`, { body: doc, positions: ['hookah_master'] });
  await owner.post(`/api/admin/content/${listId}/publish`, {});
});

describe('individual checklist', () => {
  it('each person marks every item; nobody sees others as taken; no closing; panel shows each person', async () => {
    const va = await a.get(`/api/checklists/${listId}/today`);
    expect(va.data).toMatchObject({ mode: 'individual', done: 0, total: 3 });
    const key = va.data.items[0].key;
    expect((await a.post(`/api/checklists/${listId}/marks`, { key })).status).toBe(200);
    expect((await b.post(`/api/checklists/${listId}/marks`, { key })).status).toBe(200); // same item, other person — fine
    expect((await a.post(`/api/checklists/${listId}/marks`, { key })).status).toBe(200); // repeat is harmless
    for (const it of va.data.items.slice(1)) await a.post(`/api/checklists/${listId}/marks`, { key: it.key });
    const va2 = await a.get(`/api/checklists/${listId}/today`);
    expect(va2.data).toMatchObject({ done: 3, total: 3 });
    const vb = await b.get(`/api/checklists/${listId}/today`);
    expect(vb.data.done).toBe(1);
    expect(vb.data.items.filter((i: { mark: unknown }) => i.mark).length).toBe(1);
    expect((await a.post(`/api/checklists/${listId}/close`)).data.error).toBe('checklist_no_closing');
    const today = (await a.get(`/api/locations/${SENATOR}/checklists/today`)).data.checklists.find((c: { id: string }) => c.id === listId);
    expect(today).toMatchObject({ mode: 'individual', done: 3, total: 3 });
    // undo own mark only
    expect((await b.req('DELETE', `/api/checklists/${listId}/marks/${key}`)).status).toBe(200);
    expect((await a.get(`/api/checklists/${listId}/today`)).data.done).toBe(3);

    const date = bd(Date.now());
    const day = await owner.get(`/api/admin/locations/${SENATOR}/checklists/day?date=${date}`);
    const cl = day.data.checklists.find((c: { id: string }) => c.id === listId);
    expect(cl.mode).toBe('individual');
    // Jan worked but did nothing: still listed
    expect(cl.people.map((p: { name: string; done: number }) => [p.name, p.done])).toEqual([
      ['Hubert Shisha', 3],
      ['Igor Shisha', 0],
      ['Jan Shisha', 0],
    ]);
    expect(cl.items[0]).toMatchObject({ count: 1 });
    const stats = await owner.get(`/api/admin/locations/${SENATOR}/checklists/stats?from=${date}&to=${date}`);
    expect(stats.data.checklists.find((c: { id: string }) => c.id === listId).shared).toBe(0);
    expect(stats.data.perDay.find((r: { id: string }) => r.id === listId)).toMatchObject({ done: 3, people: 3 });
  });

  it('mode is a checklist setting, validated', async () => {
    expect((await owner.put(`/api/admin/content/${listId}`, { checklistMode: 'grupa' })).data.error).toBe('checklist_mode_invalid');
    const lesson = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title: 'Lekcja bez trybu' })).data.id;
    expect((await owner.put(`/api/admin/content/${lesson}`, { checklistMode: 'shared' })).data.error).toBe('checklist_mode_invalid');
    expect((await owner.put(`/api/admin/content/${listId}`, { checklistMode: 'shared' })).status).toBe(200);
    expect((await a.get(`/api/checklists/${listId}/today`)).data.mode).toBe('shared');
    await owner.put(`/api/admin/content/${listId}`, { checklistMode: 'individual' });
  });
});

describe('checklist import', () => {
  it('imports drafts with mode and positions; re-import skips', async () => {
    const item = {
      importKey: 'checklist:test-import-listy',
      kind: 'checklist',
      title: 'Import — zamknięcie baru',
      positions: ['bartender'],
      requiresAck: false,
      checklistMode: 'shared',
      body: { type: 'doc', content: [{ type: 'bulletList', content: [li('Umyj shaker')] }] },
    };
    const r = await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'senator-content-bundle', items: [item] });
    expect(r.data.created).toEqual(['Import — zamknięcie baru']);
    const list = await owner.get(`/api/admin/locations/${SENATOR}/content?kind=checklist`);
    const id = list.data.items.find((i: { title: string }) => i.title === 'Import — zamknięcie baru').id;
    const got = await owner.get(`/api/admin/content/${id}`);
    expect(got.data.item).toMatchObject({ checklistMode: 'shared', positions: ['bartender'], status: 'draft', requiresAck: false });
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'senator-content-bundle', items: [item] })).data.skipped).toHaveLength(1);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'senator-content-bundle', items: [{ ...item, importKey: 'x2', checklistMode: 'zle' }] })).data.error).toBe(
      'checklist_mode_invalid',
    );
  });
});
