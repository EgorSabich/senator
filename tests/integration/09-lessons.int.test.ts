/**
 * D39: all lessons of a position in "Wiedza" (locked ones marked), drafts can sit in a module but stay hidden from staff,
 * a program whose modules hold nothing readable is "not ready", not "finished".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let bartender: Client;
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

async function lesson(title: string, positions: string[], publish = true) {
  const id = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title })).data.id as string;
  await owner.put(`/api/admin/content/${id}`, { body: doc(title), positions });
  if (publish) await owner.post(`/api/admin/content/${id}/publish`, {});
  return id;
}

beforeAll(async () => {
  owner = await ownerClient();
  const b = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Bartek', lastName: 'Lekcje', position: 'hookah_master' });
  bartender = await activateClient(b.data.login, b.data.tempSecret, '846215');
});

describe('lessons for a position', () => {
  it('draft-only program is hidden, lessons list shows own position only, locked module marks its lessons', async () => {
    const draft = await lesson('Koktajle — szkic', ['hookah_master'], false);
    const p = await owner.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Barman — start', position: 'hookah_master' });
    const m1 = (await owner.post(`/api/admin/programs/${p.data.id}/modules`, { title: 'Bar' })).data.id;
    expect((await owner.put(`/api/admin/modules/${m1}/items`, { items: [{ contentItemId: draft }] })).status).toBe(200);
    // only a draft inside: not "finished"
    const prog0 = await bartender.get(`/api/locations/${SENATOR}/program`);
    expect(prog0.data.program).toBeNull();
    expect((await bartender.get(`/api/locations/${SENATOR}/home`)).data.program).toBeNull();

    const first = await lesson('Klasyki baru', ['hookah_master']);
    const second = await lesson('Degustacja whisky', ['hookah_master']);
    const waiterOnly = await lesson('Nakrycie stołu', ['waiter']);
    await owner.put(`/api/admin/modules/${m1}/items`, { items: [{ contentItemId: draft }, { contentItemId: first }] });
    const m2 = (await owner.post(`/api/admin/programs/${p.data.id}/modules`, { title: 'Whisky' })).data.id;
    await owner.put(`/api/admin/modules/${m2}/items`, { items: [{ contentItemId: second }] });
    expect((await owner.put(`/api/admin/modules/${m2}`, { title: 'Whisky', isMandatory: true, unlockRule: 'after_module', unlockAfterModuleId: m1 })).status).toBe(200);

    const prog = await bartender.get(`/api/locations/${SENATOR}/program`);
    expect(prog.data.modules.map((m: { title: string }) => m.title)).toEqual(['Bar', 'Whisky']);
    expect(prog.data.modules[0].items.map((i: { title: string }) => i.title)).toEqual(['Klasyki baru']);

    const list = await bartender.get(`/api/locations/${SENATOR}/lessons`);
    expect(list.status).toBe(200);
    const byId = new Map(list.data.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.has(draft)).toBe(false);
    expect(byId.has(waiterOnly)).toBe(false);
    expect(byId.get(first)).toMatchObject({ locked: false, status: 'new' });
    expect(byId.get(second)).toMatchObject({ locked: true });
  });
});
