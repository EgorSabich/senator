/** 2026-10-17: imported Wiedza pages can name their tab („Host Book”) — created once, reused after. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, ownerClient, SENATOR } from './client';

let owner: Client;
const page = (key: string, title: string) => ({
  importKey: key,
  kind: 'service_book',
  title,
  positions: ['host', 'call_center'],
  tab: { title: 'Host Book', positions: ['host', 'call_center'] },
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] },
});

beforeAll(async () => {
  owner = await ownerClient();
});

describe('import into a Wiedza tab', () => {
  it('creates the tab once and puts the pages in it', async () => {
    const a = await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'senator-content-bundle', items: [page('hb-1', 'Rola hosta'), page('hb-2', 'Skrypty')] });
    expect(a.data.created).toHaveLength(2);
    const b = await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'senator-content-bundle', items: [page('hb-3', 'FAQ')] });
    expect(b.data.created).toHaveLength(1);
    const tabs = (await owner.get(`/api/admin/locations/${SENATOR}/knowledge-tabs`)).data.tabs.filter((t: { title: string }) => t.title === 'Host Book');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].positions).toEqual(['host', 'call_center']);
    const list = (await owner.get(`/api/admin/locations/${SENATOR}/content`)).data.items.filter((i: { title: string }) => ['Rola hosta', 'Skrypty', 'FAQ'].includes(i.title));
    expect(list.map((i: { tabId: string }) => i.tabId)).toEqual([tabs[0].id, tabs[0].id, tabs[0].id]);
  });
});
