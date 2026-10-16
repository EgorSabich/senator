/**
 * D40: the terminal shows whose PIN it is before saving (preview → slider → punch); optional small photo per punch,
 * visible only to people who manage time; wrong PINs in the preview count towards the terminal pause.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, getRaw, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let waiter: Client;
let n = 0;
/** Business date as the server counts it (Warsaw time, day starts at 06:00). */
const bd = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(ms - 6 * 3600_000));
const cid = () => `conf-${Date.now()}-${n++}`;
const jpeg = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 200 }, (_, i) => i % 256), 0xff, 0xd9));

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon bar' });
  term = new Client();
  expect((await term.login(t.data.login, t.data.tempSecret)).status).toBe(200);
  const w = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Celina', lastName: 'Suwak', position: 'bartender' });
  waiter = await activateClient(w.data.login, w.data.tempSecret, '925173');
});

describe('preview and confirm', () => {
  it('preview names the person and saves nothing; punch after it starts the shift; then the preview says "out"', async () => {
    const p1 = await term.post('/api/terminal/preview', { pin: '925173' });
    expect(p1.data).toMatchObject({ outcome: 'in', name: 'Celina S.' });
    // nothing saved by the preview
    expect((await term.post('/api/terminal/preview', { pin: '925173' })).data.outcome).toBe('in');
    const r = await term.post('/api/terminal/punch', { pin: '925173', clientId: cid() });
    expect(r.data.outcome).toBe('in');
    expect((await term.post('/api/terminal/preview', { pin: '925173' })).data.outcome).toBe('duplicate');
    expect((await term.post('/api/terminal/preview', { pin: '000000' })).data.outcome).toBe('unknown_pin');
    expect((await waiter.post('/api/terminal/preview', { pin: '925173' })).status).toBe(403);
  });

  it('wrong PINs in the preview pause the terminal', async () => {
    const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon test pauzy' });
    const tc = new Client();
    await tc.login(t.data.login, t.data.tempSecret);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await tc.post('/api/terminal/preview', { pin: `11111${i}` })).status;
    expect(last).toBe(429);
  });
});

describe('punch photo', () => {
  it('stored only when the location asks for it; manager sees it, the employee does not', async () => {
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { punchPhoto: 'tak' })).data.error).toBe('setting_invalid');
    expect((await term.get('/api/terminal/status')).data.photo).toBe(false);
    // off: a photo sent anyway is ignored (offline punch from 3 h ago)
    const d = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Dawid', lastName: 'Foto', position: 'bartender' });
    await activateClient(d.data.login, d.data.tempSecret, '936284');
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ewa', lastName: 'Foto', position: 'bartender' });
    await activateClient(e.data.login, e.data.tempSecret, '947395');
    const now = Date.now();
    expect((await term.post('/api/terminal/punch', { pin: '936284', clientId: cid(), photo: jpeg, offline: true, at: now - 3 * 3600_000 })).data.outcome).toBe('in');

    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { punchPhoto: true })).status).toBe(200);
    expect((await term.get('/api/terminal/status')).data.photo).toBe(true);
    expect((await waiter.get(`/api/locations/${SENATOR}/info`)).data.location.punchPhoto).toBe(true);
    // not a JPEG: the punch is saved, without a photo
    expect((await term.post('/api/terminal/punch', { pin: '936284', clientId: cid(), photo: 'data:image/jpeg;base64,aGVsbG8=' })).data.outcome).toBe('out');
    // offline punch keeps its photo too
    expect((await term.post('/api/terminal/punch', { pin: '947395', clientId: cid(), photo: jpeg, offline: true, at: now - 2 * 3600_000 })).data.outcome).toBe('in');
    expect((await term.post('/api/terminal/punch', { pin: '947395', clientId: cid(), photo: jpeg })).data.outcome).toBe('out');

    const photos = async (person: string, at: number) => {
      const log = await owner.get(`/api/admin/locations/${SENATOR}/time/punches?date=${bd(at)}`);
      return log.data.punches.filter((p: { person: string | null }) => p.person === person) as { id: string; hasPhoto: number; at: number }[];
    };
    const dawid = [...(await photos('Dawid Foto', now - 3 * 3600_000)), ...(await photos('Dawid Foto', now))];
    expect(new Set(dawid.map((p) => p.id)).size).toBe(2);
    expect(dawid.every((p) => !p.hasPhoto)).toBe(true);
    const ewa = [...(await photos('Ewa Foto', now - 2 * 3600_000)), ...(await photos('Ewa Foto', now))];
    const ewaUnique = [...new Map(ewa.map((p) => [p.id, p])).values()];
    expect(ewaUnique.length).toBe(2);
    expect(ewaUnique.every((p) => Boolean(p.hasPhoto))).toBe(true);
    const withPhoto = ewaUnique[0]!;
    const img = await getRaw(owner, `/api/admin/time/punches/${withPhoto.id}/photo`);
    expect(img.status).toBe(200);
    expect(img.type).toBe('image/jpeg');
    expect(img.bytes[0]).toBe(0xff);
    expect((await getRaw(waiter, `/api/admin/time/punches/${withPhoto.id}/photo`)).status).toBe(403);
    expect((await owner.req('PUT', `/api/admin/locations/${SENATOR}/settings`, { punchPhoto: false })).status).toBe(200);
  });
});
