/**
 * 2026-10-17 (iteration 2): Wiedza tabs. The Service Book is for waiters (and runners); leaders add their own books.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX, type ManagerRole } from '../../src/shared/constants';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let barLead: Client;
let waiter: Client;
let runner: Client;
let barman: Client;
let sbPage = '';
const perms = (r: ManagerRole) => {
  const x = MANAGER_ROLES[r];
  return [...(x.permissions === 'all' ? PERMISSIONS : x.permissions), ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + r];
};
const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
async function person(first: string, position: string, pin: string) {
  const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: first, lastName: 'Wiedza', position });
  return activateClient(e.data.login, e.data.tempSecret, pin);
}

beforeAll(async () => {
  owner = await ownerClient();
  const m = await owner.post('/api/admin/managers', { firstName: 'Bartosz', lastName: 'Bar', locationId: SENATOR, permissions: perms('head_bartender') });
  barLead = new Client();
  await barLead.login(m.data.login, m.data.tempSecret);
  await barLead.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'BartoszHaslo2026!x' });
  waiter = await person('Wiktor', 'waiter', '613947');
  runner = await person('Rafał', 'waiter_assistant', '624058');
  barman = await person('Bogdan', 'bartender', '635169');
  sbPage = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'service_book', title: 'Podawanie wody' })).data.id;
  await owner.put(`/api/admin/content/${sbPage}`, { body: doc('Woda z prawej strony.') });
  await owner.post(`/api/admin/content/${sbPage}/publish`, {});
});

describe('Service Book only for waiters', () => {
  it('waiter and runner see it, a bartender does not', async () => {
    const w = await waiter.get(`/api/locations/${SENATOR}/service-book`);
    expect(w.data.tabs.map((t: { title: string }) => t.title)).toContain('Service Book');
    expect(w.data.items.some((i: { id: string }) => i.id === sbPage)).toBe(true);
    expect((await runner.get(`/api/locations/${SENATOR}/service-book`)).data.items.some((i: { id: string }) => i.id === sbPage)).toBe(true);
    const b = await barman.get(`/api/locations/${SENATOR}/service-book`);
    expect(b.data.tabs).toEqual([]);
    expect(b.data.items).toEqual([]);
    expect((await barman.get(`/api/content/${sbPage}`)).status).toBe(404);
    const r = await waiter.get(`/api/content/${sbPage}`);
    expect(r.data.item.tabTitle).toBe('Service Book');
  });
});

describe('own books', () => {
  it('a bar leader adds Bar Book for the bar; pages go in; only the bar sees it', async () => {
    expect((await barLead.post(`/api/admin/locations/${SENATOR}/knowledge-tabs`, { title: 'Sala Book', positions: ['waiter'] })).data.error).toBe('outside_divisions');
    expect((await barLead.post(`/api/admin/locations/${SENATOR}/knowledge-tabs`, { title: 'Dla wszystkich', positions: [] })).data.error).toBe('outside_divisions');
    const tab = await barLead.post(`/api/admin/locations/${SENATOR}/knowledge-tabs`, { title: 'Bar Book', positions: ['bartender'] });
    expect(tab.status).toBe(201);
    const tabs = (await barLead.get(`/api/admin/locations/${SENATOR}/knowledge-tabs`)).data.tabs;
    expect(tabs.find((t: { id: string }) => t.id === 'kt_service_book')).toBeUndefined(); // not the bar's
    expect(tabs.find((t: { id: string }) => t.id === tab.data.id)).toMatchObject({ editable: true, pages: 0 });
    // leaders cannot change the shared Service Book
    expect((await barLead.req('PUT', '/api/admin/knowledge-tabs/kt_service_book', { title: 'X' })).status).toBe(403);

    const page = (await barLead.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'service_book', title: 'Negroni krok po kroku', tabId: tab.data.id })).data.id;
    expect((await barLead.get(`/api/admin/content/${page}`)).data.item).toMatchObject({ tabId: tab.data.id, editable: true });
    await barLead.put(`/api/admin/content/${page}`, { body: doc('Gin, Campari, wermut.') });
    expect((await barLead.post(`/api/admin/content/${page}/publish`, {})).status).toBe(200);

    const b = await barman.get(`/api/locations/${SENATOR}/service-book`);
    expect(b.data.tabs.map((t: { title: string }) => t.title)).toEqual(['Bar Book']);
    expect(b.data.items.map((i: { tabId: string }) => i.tabId)).toEqual([tab.data.id]);
    const w = await waiter.get(`/api/locations/${SENATOR}/service-book`);
    expect(w.data.tabs.map((t: { title: string }) => t.title)).not.toContain('Bar Book');
    expect((await waiter.get(`/api/content/${page}`)).status).toBe(404);
    expect((await barman.get(`/api/content/${page}`)).data.item.tabTitle).toBe('Bar Book');

    // not empty → stays; rename works
    expect((await barLead.req('DELETE', `/api/admin/knowledge-tabs/${tab.data.id}`)).data.error).toBe('tab_not_empty');
    expect((await barLead.req('PUT', `/api/admin/knowledge-tabs/${tab.data.id}`, { title: 'Bar Book Senator' })).status).toBe(200);
    // the owner moves the page back to the Service Book; the empty tab can go
    expect((await owner.put(`/api/admin/content/${page}`, { tabId: 'kt_service_book' })).status).toBe(200);
    expect((await owner.put(`/api/admin/content/${page}`, { tabId: 'kt_nope' })).data.error).toBe('tab_invalid');
    expect((await barLead.req('DELETE', `/api/admin/knowledge-tabs/${tab.data.id}`)).status).toBe(200);
    expect((await owner.req('DELETE', '/api/admin/knowledge-tabs/kt_service_book')).data.error).toBe('tab_builtin');
  });
});
