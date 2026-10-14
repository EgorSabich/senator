/**
 * Stage 5: Academy for staff — program and unlock rules, reading and acknowledgements,
 * "Do powtórki" after significant changes, library by position, Service Book, search (spec D1–D4, D10, L).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let waiter: Client;
let host: Client;
let empB: Client;
let locB = '';
const ids = {} as Record<string, string> & { l1: string; l2: string; reg: string; ext: string; hostDoc: string; draft: string; sb: string; program: string; mA: string; mB: string };

const doc = (...paras: string[]) => ({ type: 'doc', content: paras.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });

async function publish(kind: string, title: string, paras: string[], settings: Record<string, unknown> = {}) {
  const res = await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind, title, section: settings.section ?? null });
  const id = res.data.id as string;
  await owner.put(`/api/admin/content/${id}`, { body: doc(...paras), ...settings });
  const pub = await owner.post(`/api/admin/content/${id}/publish`, {});
  expect(pub.status).toBe(200);
  return id;
}

async function republish(id: string, paras: string[], changeLevel: string) {
  await owner.put(`/api/admin/content/${id}`, { body: doc(...paras) });
  const res = await owner.post(`/api/admin/content/${id}/publish`, { changeLevel });
  expect(res.status).toBe(200);
}

async function read(c: Client, id: string) {
  const got = await c.get(`/api/content/${id}`);
  expect(got.status).toBe(200);
  return c.post(`/api/content/${id}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true });
}

beforeAll(async () => {
  owner = await ownerClient();
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Zofia', lastName: 'Uczeń', position: 'waiter' });
  waiter = await activateClient(w.data.login, w.data.tempSecret, '481937');
  const h = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Hanna', lastName: 'Host', position: 'host' });
  host = await activateClient(h.data.login, h.data.tempSecret, '592048');
  const locs = await owner.get('/api/admin/locations');
  locB = locs.data.locations.find((l: { id: string }) => l.id !== SENATOR)?.id;
  const e = await owner.post(`/api/admin/locations/${locB}/employees`, { firstName: 'Ewa', lastName: 'Obca', position: 'waiter' });
  empB = await activateClient(e.data.login, e.data.tempSecret, '603159');

  ids.l1 = await publish('lesson', 'Powitanie gościa', ['Gościa witamy w ciągu 2 minut.', 'Żurek polecamy z jajkiem.']);
  ids.l2 = await publish('lesson', 'Rozliczenie', ['Rachunek podajemy w etui.']);
  ids.draft = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title: 'Szkic niewidoczny' })).data.id;
  ids.reg = await publish('regulation', 'Regulamin pracy', ['Punktualność to podstawa.'], { positions: ['waiter'], requiresAck: true });
  ids.hostDoc = await publish('sop', 'SOP hostessy', ['Lista rezerwacji o 11:00.'], { positions: ['host'], requiresAck: true });
  ids.ext = await publish('checklist', 'Lista zewnętrzna', ['Zobacz link.'], { externalUrl: 'https://example.com/lista' });
  ids.sb = await publish('service_book', 'Standard nakrycia', ['Sztućce układamy od zewnątrz.'], { section: 'Sala' });
});

describe('program admin', () => {
  it('builds a waiter program with two modules; the second opens after the first', async () => {
    const p = await owner.post(`/api/admin/locations/${SENATOR}/programs`, { name: 'Wdrożenie kelnera', position: 'waiter' });
    expect(p.status).toBe(201);
    ids.program = p.data.id;
    ids.mA = (await owner.post(`/api/admin/programs/${ids.program}/modules`, { title: 'Pierwszy dzień' })).data.id;
    ids.mB = (await owner.post(`/api/admin/programs/${ids.program}/modules`, { title: 'Rozliczenia' })).data.id;
    expect((await owner.put(`/api/admin/modules/${ids.mA}/items`, { items: [{ contentItemId: ids.l1 }, { contentItemId: ids.reg }] })).status).toBe(200);
    expect((await owner.put(`/api/admin/modules/${ids.mB}/items`, { items: [{ contentItemId: ids.l2 }] })).status).toBe(200);
    expect((await owner.put(`/api/admin/modules/${ids.mB}`, { title: 'Rozliczenia', unlockRule: 'after_module', unlockAfterModuleId: ids.mA })).status).toBe(200);
    const detail = await owner.get(`/api/admin/programs/${ids.program}`);
    expect(detail.data.program.isDefault).toBe(true);
    expect(detail.data.modules.map((m: { title: string }) => m.title)).toEqual(['Pierwszy dzień', 'Rozliczenia']);
  });

  it('refuses a module unlocking after itself, foreign content and employees', async () => {
    expect((await owner.put(`/api/admin/modules/${ids.mA}`, { title: 'X', unlockRule: 'after_module', unlockAfterModuleId: ids.mA })).data.error).toBe('unlock_module_invalid');
    expect((await owner.put(`/api/admin/modules/${ids.mA}/items`, { items: [{ contentItemId: 'ci_nope' }] })).data.error).toBe('content_invalid');
    expect((await waiter.get(`/api/admin/locations/${SENATOR}/programs`)).status).toBe(403);
  });
});

describe('waiter home and program', () => {
  it('home shows the program at 0%, the next lesson and documents to confirm for his position', async () => {
    const home = await waiter.get(`/api/locations/${SENATOR}/home`);
    expect(home.status).toBe(200);
    expect(home.data.program).toMatchObject({ name: 'Wdrożenie kelnera', percent: 0 });
    expect(home.data.next).toMatchObject({ id: ids.l1, title: 'Powitanie gościa' });
    const confirm = home.data.toConfirm.map((d: { id: string }) => d.id);
    expect(confirm).toContain(ids.reg);
    expect(confirm).not.toContain(ids.hostDoc);
    expect(confirm).not.toContain(ids.ext);
  });

  it('locked lesson cannot be opened or acknowledged', async () => {
    expect((await waiter.get(`/api/content/${ids.l2}`)).data.error).toBe('lesson_locked');
    const prog = await waiter.get(`/api/locations/${SENATOR}/program`);
    expect(prog.data.modules[1]).toMatchObject({ locked: true, complete: false });
  });

  it('acknowledgement needs the current version and scrolling to the end', async () => {
    const got = await waiter.get(`/api/content/${ids.l1}`);
    expect(got.data.item.version.body.content[0].content[0].text).toMatch(/2 minut/);
    expect(got.data.item.next).toMatchObject({ id: ids.reg });
    expect((await waiter.post(`/api/content/${ids.l1}/ack`, { versionId: got.data.item.version.id })).data.error).toBe('scroll_required');
    expect((await waiter.post(`/api/content/${ids.l1}/ack`, { versionId: 'v_old', scrolledToEnd: true })).status).toBe(409);
    expect((await read(waiter, ids.l1)).status).toBe(200);
    expect((await read(waiter, ids.l1)).status).toBe(200); // repeat is harmless
  });

  it('module B opens after module A is complete; percent follows', async () => {
    expect((await read(waiter, ids.reg)).status).toBe(200);
    const prog = await waiter.get(`/api/locations/${SENATOR}/program`);
    expect(prog.data.modules[0]).toMatchObject({ complete: true, done: 2, total: 2 });
    expect(prog.data.modules[1].locked).toBe(false);
    expect(prog.data.percent).toBe(66);
    expect((await waiter.get(`/api/content/${ids.l2}`)).status).toBe(200);
  });

  it('significant change → "Do powtórki"; clarification → done with "Zaktualizowano"', async () => {
    await republish(ids.l1, ['Gościa witamy w ciągu 2 minut, VIP w ciągu 1 minuty.', 'Żurek polecamy z jajkiem.'], 'significant');
    let home = await waiter.get(`/api/locations/${SENATOR}/home`);
    expect(home.data.review.map((r: { id: string }) => r.id)).toContain(ids.l1);
    expect((await waiter.get(`/api/locations/${SENATOR}/program`)).data.modules[0].complete).toBe(false);
    await read(waiter, ids.l1);
    await republish(ids.reg, ['Punktualność to podstawa. Przychodzimy 15 minut wcześniej.'], 'clarification');
    home = await waiter.get(`/api/locations/${SENATOR}/home`);
    expect(home.data.review).toEqual([]);
    expect(home.data.updated.map((r: { id: string }) => r.id)).toContain(ids.reg);
  });
});

describe('library and Service Book', () => {
  it('waiter sees his and general documents, never drafts or host documents', async () => {
    const lib = await waiter.get(`/api/locations/${SENATOR}/library`);
    const got = lib.data.items.map((d: { id: string }) => d.id);
    expect(got).toEqual(expect.arrayContaining([ids.reg, ids.ext]));
    expect(got).not.toContain(ids.hostDoc);
    expect(lib.data.items.find((d: { id: string }) => d.id === ids.ext)).toMatchObject({ external: true, requiresAck: false });
    expect(lib.data.items.find((d: { id: string }) => d.id === ids.reg).acknowledgedAt).toBeTruthy();
    expect((await waiter.get(`/api/content/${ids.hostDoc}`)).status).toBe(404);
    expect((await waiter.get(`/api/content/${ids.draft}`)).status).toBe(404);
  });

  it('host sees the host SOP; external documents cannot be acknowledged', async () => {
    const lib = await host.get(`/api/locations/${SENATOR}/library`);
    expect(lib.data.items.map((d: { id: string }) => d.id)).toContain(ids.hostDoc);
    const got = await host.get(`/api/content/${ids.ext}`);
    expect((await host.post(`/api/content/${ids.ext}/ack`, { versionId: got.data.item.version.id, scrolledToEnd: true })).data.error).toBe('external_no_ack');
  });

  it('Service Book lists chapters with sections', async () => {
    const sb = await waiter.get(`/api/locations/${SENATOR}/service-book`);
    expect(sb.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.sb, section: 'Sala', status: 'new' })]));
  });
});

describe('search', () => {
  it('"zurek" finds "Żurek" in a lesson with a highlighted snippet', async () => {
    const res = await waiter.get(`/api/locations/${SENATOR}/search?q=zurek`);
    const hit = res.data.results.find((r: { id: string }) => r.id === ids.l1);
    expect(hit).toBeTruthy();
    const [a, b] = hit.snippet.marks[0];
    expect(hit.snippet.text.slice(a, b)).toBe('Żurek');
  });

  it('finds menu items and respects positions', async () => {
    const menu = await waiter.get(`/api/locations/${SENATOR}/search?q=hortus`);
    expect(menu.data.results.some((r: { type: string }) => r.type === 'menu_item')).toBe(true);
    expect((await waiter.get(`/api/locations/${SENATOR}/search?q=rezerwacji`)).data.results).toEqual([]);
    expect((await host.get(`/api/locations/${SENATOR}/search?q=rezerwacji`)).data.results.length).toBe(1);
  });

  it('empty or symbol-only query returns nothing', async () => {
    expect((await waiter.get(`/api/locations/${SENATOR}/search?q=%22%2A`)).data.results).toEqual([]);
  });
});

describe('isolation', () => {
  it('employee of another location cannot read content or the program here', async () => {
    expect((await empB.get(`/api/content/${ids.l1}`)).status).toBe(404);
    expect((await empB.get(`/api/locations/${SENATOR}/home`)).status).toBe(404);
    expect((await empB.get(`/api/locations/${SENATOR}/search?q=zurek`)).status).toBe(404);
  });

  it('nothing without a session', async () => {
    expect((await new Client().get(`/api/content/${ids.l1}`)).status).toBe(401);
    expect((await new Client().get(`/api/locations/${SENATOR}/home`)).status).toBe(401);
  });
});
