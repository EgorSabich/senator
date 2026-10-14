/**
 * Stage 3: content with versions, permissions on content, photos and files (spec D, E, L "Обучение и контент").
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, getRaw, ownerClient, SENATOR, upload } from './client';

let owner: Client;
let manager: Client;
let managerId = '';
let locB = '';
let empB: Client;

// 1×1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

const body = (text: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Serwis stołu' }] },
    { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'callout', attrs: { variant: 'important' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Maksymalnie 2 talerze.' }] }] },
  ],
});

beforeAll(async () => {
  owner = await ownerClient();
  const m = await owner.post('/api/admin/managers', { firstName: 'Ewa', lastName: 'Treść', locationId: SENATOR });
  managerId = m.data.id;
  manager = await activateClient(m.data.login, m.data.tempSecret, 'HasloEwyTresc2026');
  const locs = await owner.get('/api/admin/locations');
  locB = locs.data.locations.find((l: { id: string }) => l.id !== SENATOR)?.id;
  const e = await owner.post(`/api/admin/locations/${locB}/employees`, { firstName: 'Ola', lastName: 'Bok', position: 'waiter' });
  empB = await activateClient(e.data.login, e.data.tempSecret, '730419');
});

describe('content permissions', () => {
  it('manager without content.edit cannot list or create content', async () => {
    expect((await manager.get(`/api/admin/locations/${SENATOR}/content`)).status).toBe(403);
    expect((await manager.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title: 'X' })).status).toBe(403);
  });

  it('employee cannot reach content admin', async () => {
    expect((await empB.get(`/api/admin/locations/${locB}/content`)).status).toBe(403);
  });
});

describe('versions', () => {
  let id = '';

  it('creates a draft and sanitizes the body', async () => {
    const res = await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'lesson', title: 'Serwis stołu', section: 'Standardy serwisu' });
    expect(res.status).toBe(201);
    id = res.data.id;
    const dirty = body('Talerz zabieramy od razu.');
    (dirty.content as unknown[]).push({ type: 'script', content: [{ type: 'text', text: 'alert(1)' }] });
    expect((await owner.put(`/api/admin/content/${id}`, { body: dirty })).status).toBe(200);
    const got = await owner.get(`/api/admin/content/${id}`);
    expect(got.data.item.status).toBe('draft');
    expect(JSON.stringify(got.data.draft.body)).not.toMatch(/script|alert/);
  });

  it('first publication becomes version 1 (significant)', async () => {
    const res = await owner.post(`/api/admin/content/${id}/publish`, {});
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ versionNo: 1, changeLevel: 'significant' });
    const got = await owner.get(`/api/admin/content/${id}`);
    expect(got.data.item.status).toBe('published');
    expect(got.data.draft).toBeNull();
    expect(got.data.current.versionNo).toBe(1);
  });

  it('later publications require a change level and keep history', async () => {
    expect((await owner.post(`/api/admin/content/${id}/publish`, {})).data.error).toBe('no_draft');
    await owner.put(`/api/admin/content/${id}`, { body: body('Talerz zabieramy od razu, gdy gość skończył.') });
    expect((await owner.post(`/api/admin/content/${id}/publish`, {})).data.error).toBe('change_level_required');
    const v2 = await owner.post(`/api/admin/content/${id}/publish`, { changeLevel: 'cosmetic', changeNote: 'Poprawka stylu' });
    expect(v2.data).toMatchObject({ versionNo: 2, changeLevel: 'cosmetic' });

    await owner.put(`/api/admin/content/${id}`, { body: body('Talerz zabieramy od razu, gdy gość skończył.') });
    expect((await owner.post(`/api/admin/content/${id}/publish`, { changeLevel: 'cosmetic' })).data.error).toBe('no_changes');
    expect((await owner.post(`/api/admin/content/${id}/discard-draft`)).status).toBe(200);

    const got = await owner.get(`/api/admin/content/${id}`);
    expect(got.data.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    expect(got.data.versions[0]).toMatchObject({ changeLevel: 'cosmetic', changeNote: 'Poprawka stylu', authorLastName: 'Właściciel' });
    const v1 = await owner.get(`/api/admin/content/${id}/versions/${got.data.versions[1].id}`);
    expect(v1.data.version.bodyText).toContain('Talerz zabieramy od razu.');
    expect(v1.data.version.bodyText).toContain('Maksymalnie 2 talerze.');
  });

  it('audit records the publication and level', async () => {
    const audit = await owner.get('/api/admin/audit?limit=50');
    const pub = audit.data.entries.filter((e: { action: string }) => e.action === 'content.publish');
    expect(pub.length).toBeGreaterThanOrEqual(2);
    expect(pub[0].afterJson).toContain('"changeLevel":"cosmetic"');
  });

  it('archives and restores', async () => {
    expect((await owner.post(`/api/admin/content/${id}/archive`)).status).toBe(200);
    expect((await owner.post(`/api/admin/content/${id}/restore`)).data.status).toBe('published');
  });
});

describe('documents, shared content and manager rights', () => {
  let sharedId = '';
  let docId = '';

  it('owner creates a shared regulation visible to every location', async () => {
    const res = await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Regulamin pracy', shared: true });
    sharedId = res.data.id;
    const list = await owner.get(`/api/admin/locations/${locB}/content?kind=regulation`);
    const item = list.data.items.find((i: { id: string }) => i.id === sharedId);
    expect(item).toMatchObject({ shared: true, requiresAck: true });
  });

  it('manager with content.edit works in his location only and cannot touch shared content', async () => {
    await owner.put(`/api/admin/managers/${managerId}/permissions`, { locationId: SENATOR, permissions: ['content.edit'] });
    const res = await manager.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'sop', title: 'SOP otwarcia zmiany' });
    expect(res.status).toBe(201);
    docId = res.data.id;
    expect((await manager.put(`/api/admin/content/${docId}`, { positions: ['waiter'], requiresAck: true })).status).toBe(200);
    expect((await manager.put(`/api/admin/content/${docId}`, { positions: ['chef'] })).data.error).toBe('positions_invalid');
    expect((await manager.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'sop', title: 'X', shared: true })).status).toBe(403);
    expect((await manager.put(`/api/admin/content/${sharedId}`, { title: 'Zmiana' })).status).toBe(403);
    expect((await manager.get(`/api/admin/locations/${locB}/content`)).status).toBe(404);
  });

  it('external link must be https', async () => {
    expect((await manager.put(`/api/admin/content/${docId}`, { externalUrl: 'javascript:alert(1)' })).data.error).toBe('external_url_invalid');
    expect((await manager.put(`/api/admin/content/${docId}`, { externalUrl: 'https://docs.google.com/document/d/x' })).status).toBe(200);
  });

  it('keeps an original PDF attachment, readable only with access', async () => {
    const res = await upload(manager, `/api/admin/content/${docId}/attachment`, new Blob([PDF], { type: 'application/pdf' }), 'SOP otwarcia.pdf');
    expect(res.status).toBe(201);
    const src: string = res.data.attachment.src;
    expect((await getRaw(owner, src)).status).toBe(200);
    expect((await getRaw(empB, src)).status).toBe(404);
    expect((await getRaw(null, src)).status).toBe(401);
  });
});

describe('photos', () => {
  let src = '';

  it('accepts a real image and serves it only after login and with location access', async () => {
    const res = await upload(owner, `/api/admin/locations/${SENATOR}/media`, new Blob([PNG], { type: 'image/png' }), 'talerz.png');
    expect(res.status).toBe(201);
    src = res.data.src;
    expect(src).toMatch(/^\/media\/loc\/loc_senator\/img\/.+\.png$/);
    const ok = await getRaw(owner, src);
    expect(ok.status).toBe(200);
    expect(ok.type).toBe('image/png');
    expect(ok.bytes.length).toBe(PNG.length);
    expect((await getRaw(null, src)).status).toBe(401);
    expect((await getRaw(empB, src)).status).toBe(404);
  });

  it('rejects files pretending to be images', async () => {
    const fake = new Blob([new TextEncoder().encode('<script>alert(1)</script>')], { type: 'image/png' });
    expect((await upload(owner, `/api/admin/locations/${SENATOR}/media`, fake, 'x.png')).data.error).toBe('image_type');
    const svg = new Blob([new TextEncoder().encode('<svg/>')], { type: 'image/svg+xml' });
    expect((await upload(owner, `/api/admin/locations/${SENATOR}/media`, svg, 'x.svg')).data.error).toBe('image_type');
  });

  it('accepts images in the lesson body only from our own media', async () => {
    const res = await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'service_book', title: 'Nakrycie stołu' });
    const id = res.data.id;
    await owner.put(`/api/admin/content/${id}`, {
      body: { type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'Nakrycie' } }, { type: 'image', attrs: { src: 'https://evil.example/a.png' } }] },
    });
    const got = await owner.get(`/api/admin/content/${id}`);
    expect(got.data.draft.body.content).toEqual([{ type: 'image', attrs: { src, alt: 'Nakrycie' } }]);
  });

  it('rejects unknown media paths', async () => {
    expect((await getRaw(owner, '/media/loc/loc_senator/img/..%2F..%2Fsecret.png')).status).toBe(404);
    expect((await getRaw(owner, '/media/loc/loc_senator/img/a.svg')).status).toBe(404);
    expect((await getRaw(owner, '/media/loc/loc_senator/img/nope.png')).status).toBe(404);
  });
});
