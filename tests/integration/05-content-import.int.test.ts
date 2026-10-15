/**
 * Stage 5: import of prepared materials as drafts (spec E, D9) and bulk publish after review.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let waiter: Client;

const table = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kategoria' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Czas' }] }] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Zupy' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'do 15 minut' }] }] }] },
  ],
};
const item = (key: string, title: string, extra: Record<string, unknown> = {}) => ({
  importKey: key,
  kind: 'regulation',
  title,
  positions: ['waiter'],
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Treść: ${title}` }] }, table, { type: 'script' }] },
  ...extra,
});
const chunk = (items: unknown[]) => ({ format: 'senator-content-bundle', items });

beforeAll(async () => {
  owner = await ownerClient();
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Igor', lastName: 'Import', position: 'waiter' });
  waiter = await activateClient(w.data.login, w.data.tempSecret, '714052');
});

describe('content import', () => {
  it('employee cannot import', async () => {
    expect((await waiter.post(`/api/admin/locations/${SENATOR}/content/import`, chunk([item('reg:x', 'X')]))).status).toBe(403);
  });

  it('creates drafts with positions, mandatory reading and tables; nothing published', async () => {
    const res = await owner.post(`/api/admin/locations/${SENATOR}/content/import`, chunk([item('reg:podawanie', 'Regulamin podawania dań'), item('sop:test', 'SOP testowy', { kind: 'sop', requiresAck: false })]));
    expect(res.status).toBe(200);
    expect(res.data.created).toEqual(['Regulamin podawania dań', 'SOP testowy']);
    const list = await owner.get(`/api/admin/locations/${SENATOR}/content?kind=regulation`);
    const reg = list.data.items.find((i: { title: string }) => i.title === 'Regulamin podawania dań');
    expect(reg).toMatchObject({ status: 'draft', imported: true, requiresAck: true, positions: ['waiter'], versionNo: null });
    const detail = await owner.get(`/api/admin/content/${reg.id}`);
    expect(detail.data.draft.body.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'table']);
    expect((await waiter.get(`/api/locations/${SENATOR}/library`)).data.items.some((d: { title: string }) => d.title === 'Regulamin podawania dań')).toBe(false);
  });

  it('re-import skips existing items; chunk limit and format are checked', async () => {
    const again = await owner.post(`/api/admin/locations/${SENATOR}/content/import`, chunk([item('reg:podawanie', 'Regulamin podawania dań')]));
    expect(again.data).toMatchObject({ created: [], skipped: ['Regulamin podawania dań'] });
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import`, chunk([1, 2, 3, 4, 5].map((n) => item(`k${n}`, `T${n}`))))).data.error).toBe('bundle_invalid');
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import`, { format: 'x', items: [] })).data.error).toBe('bundle_invalid');
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import`, chunk([item('bad', 'Zły', { body: { type: 'p' } })]))).data.error).toBe('body_invalid');
  });

  it('bulk publish publishes imported drafts once; the waiter then sees the table', async () => {
    const list = await owner.get(`/api/admin/locations/${SENATOR}/content?kind=regulation`);
    const ids = list.data.items.filter((i: { imported: boolean; versionNo: number | null }) => i.imported && i.versionNo === null).map((i: { id: string }) => i.id);
    expect((await waiter.post(`/api/admin/locations/${SENATOR}/content/import/publish`, { ids })).status).toBe(403);
    const res = await owner.post(`/api/admin/locations/${SENATOR}/content/import/publish`, { ids });
    expect(res.data.published).toBe(ids.length);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/content/import/publish`, { ids })).data.published).toBe(0);
    const lib = await waiter.get(`/api/locations/${SENATOR}/library`);
    const reg = lib.data.items.find((d: { title: string }) => d.title === 'Regulamin podawania dań');
    expect(reg).toMatchObject({ requiresAck: true, status: 'new' });
    const got = await waiter.get(`/api/content/${reg.id}`);
    expect(got.data.item.version.body.content[1].type).toBe('table');
    const search = await waiter.get(`/api/locations/${SENATOR}/search?q=do 15 minut`);
    expect(search.data.results.some((r: { id: string }) => r.id === reg.id)).toBe(true);
  });
});
