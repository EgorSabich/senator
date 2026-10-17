/**
 * 2026-10-17 (iteration 3): push notifications end to end, against a fake push service on localhost.
 * The test plays the browser: it makes the subscription keys and decrypts what arrives.
 */
// @ts-nocheck -- Node test (http server, Buffer); the app's tsconfig has no Node types
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateClient, BASE, Client, ownerClient, SENATOR } from './client';

const PORT = 8791;
const FAKE = `http://localhost:${PORT}`;
const DAY = 86400_000;
const enc = new TextEncoder();
const sql = (q: string) => execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/state-int --command "${q}"`, { stdio: 'pipe' });

interface Got {
  path: string;
  headers: Record<string, string>;
  msg: { title: string; body: string; url: string; tag?: string } | null;
}
const got: Got[] = [];
const devices = new Map<string, { priv: CryptoKey; pub: Uint8Array; auth: Uint8Array }>();

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url');
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
async function decrypt(path: string, body: Uint8Array) {
  const d = devices.get(path);
  if (!d) return null;
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, d.priv, 256));
  const ikm = await hkdf(d.auth, shared, Buffer.concat([enc.encode('WebPush: info\0'), d.pub, asPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const path = req.url ?? '';
    const msg = await decrypt(path, new Uint8Array(Buffer.concat(chunks))).catch(() => null);
    got.push({ path, headers: req.headers as Record<string, string>, msg });
    res.statusCode = path.startsWith('/gone') ? 410 : 201;
    res.end();
  });
});

async function subscribe(c: Client, path: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  devices.set(path, { priv: pair.privateKey, pub, auth });
  return c.post('/api/push/subscribe', { endpoint: FAKE + path, keys: { p256dh: b64(pub), auth: b64(auth) } });
}
/** messages that reached `path` (waits for background sends) */
async function arrived(path: string, title: string, min = 1) {
  for (let i = 0; i < 50; i++) {
    const list = got.filter((g) => g.path === path && g.msg?.title === title);
    if (list.length >= min) return list;
    await new Promise((r) => setTimeout(r, 100));
  }
  return got.filter((g) => g.path === path && g.msg?.title === title);
}
// async on purpose: the fake push service lives in this process and must keep answering
const cron = () => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`).then((r) => r.text());
const settle = () => new Promise((r) => setTimeout(r, 1500));

const warsaw = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(ms));
function monday(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const plus = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

let owner: Client;
let anna: Client;
let annaId = '';
let borysId = '';
let cezaryId = '';
let cezary: Client;
const far = monday(plus(warsaw(Date.now()), 77)); // a week no other test touches

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(PORT, r));
  owner = await ownerClient();
  const mk = async (firstName: string, position: string, pin: string) => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName, lastName: 'Push', position });
    return { id: e.data.id as string, c: await activateClient(e.data.login, e.data.tempSecret, pin) };
  };
  ({ id: annaId, c: anna } = await mk('Anna', 'waiter', '739152'));
  ({ id: borysId } = await mk('Borys', 'waiter', '628403'));
  ({ id: cezaryId, c: cezary } = await mk('Cezary', 'host', '517294'));
  // Cezary's Grafik is locked: a host document overdue
  const doc = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'regulation', title: 'Standard powitania gościa' })).data.id;
  await owner.put(`/api/admin/content/${doc}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Witamy w ciągu 10 sekund.' }] }] }, positions: ['host'] });
  await owner.post(`/api/admin/content/${doc}/publish`, {});
  const back = Date.now() - 10 * DAY;
  sql(`UPDATE users SET first_login_at = ${back} WHERE id = '${cezaryId}'`);
  sql(`UPDATE content_versions SET created_at = ${back} WHERE content_item_id = '${doc}'`);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('push notifications', () => {
  it('the key is public; a subscription needs a valid endpoint and keys', async () => {
    const k = await anna.get('/api/push/key');
    expect(k.data.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await anna.post('/api/push/subscribe', { endpoint: 'http://example.com/x', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } })).status).toBe(400);
    expect((await anna.post('/api/push/subscribe', { endpoint: `${FAKE}/x`, keys: { p256dh: 'short', auth: 'b'.repeat(22) } })).status).toBe(400);
    expect((await new Client().post('/api/push/subscribe', {})).status).toBe(401);
    expect((await subscribe(anna, '/anna')).status).toBe(200);
    expect((await subscribe(cezary, '/cezary')).status).toBe(200);
  });

  it('„Wyślij próbne” reaches the device, encrypted, with VAPID', async () => {
    const r = await anna.post('/api/push/test');
    expect(r.data).toMatchObject({ devices: 1, delivered: 1 });
    const [m] = await arrived('/anna', 'Próba');
    expect(m.headers['content-encoding']).toBe('aes128gcm');
    expect(m.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(m.msg.body).toContain('działają');
  });

  it('publish preview: who changed, who has notifications on, who is locked', async () => {
    for (const [userId, date] of [
      [annaId, far],
      [borysId, plus(far, 1)],
      [cezaryId, plus(far, 2)],
    ])
      expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId, date, start: '16:00', end: '23:00' })).status).toBe(201);
    const p = await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish-preview`, { week: far });
    expect(p.status).toBe(200);
    const mine = p.data.people.filter((x: { id: string }) => [annaId, borysId, cezaryId].includes(x.id));
    expect(mine).toHaveLength(3);
    expect(mine.find((x: { id: string }) => x.id === annaId)).toMatchObject({ added: 1, push: true, locked: false, name: 'Anna Push' });
    expect(mine.find((x: { id: string }) => x.id === borysId)).toMatchObject({ push: false, locked: false });
    expect(mine.find((x: { id: string }) => x.id === cezaryId)).toMatchObject({ push: false, locked: true });
    expect(p.data.pushReady).toBe(true);
  });

  it('„Opublikuj i powiadom”: only changed people, never a locked Grafik', async () => {
    const r = await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: far, notify: true });
    expect(r.data.notified).toBe(true);
    const [m] = await arrived('/anna', 'Grafik');
    expect(m.msg.body).toMatch(/^Nowy grafik na \d+( \S+)?–\d+ \S+\. Masz 1 zmianę\.$/);
    expect(m.msg.url).toBe('/grafik');
    await settle();
    expect(got.filter((g) => g.path === '/cezary' && g.msg?.title === 'Grafik')).toHaveLength(0);
  });

  it('„Opublikuj bez powiadomienia”: nothing is sent; a later notified change says what changed', async () => {
    const plan = await owner.get(`/api/admin/locations/${SENATOR}/schedule?week=${far}`);
    const shift = plan.data.shifts.find((s: { userId: string }) => s.userId === annaId);
    await owner.put(`/api/admin/schedule/shifts/${shift.id}`, { start: '17:00', end: '23:00' });
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: far, notify: false })).data.notified).toBe(false);
    await settle();
    expect(got.filter((g) => g.path === '/anna' && g.msg?.title === 'Grafik')).toHaveLength(1);
    await owner.put(`/api/admin/schedule/shifts/${shift.id}`, { start: '18:00', end: '23:00' });
    await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: far, notify: true });
    const list = await arrived('/anna', 'Grafik', 2);
    expect(list[1].msg.body).toMatch(/^Zmiany w grafiku na .+ Masz 1 zmianę\. \S+ \d+\.\d\d 17:00–23:00 zmieniona\.$/);
  });

  it('18:00 reminder about tomorrow’s shift, once', async () => {
    const tomorrow = plus(warsaw(Date.now()), 1);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: annaId, date: tomorrow, start: '12:00', end: '20:00' })).status).toBe(201);
    expect((await owner.post(`/api/admin/locations/${SENATOR}/schedule/shifts`, { userId: cezaryId, date: tomorrow, start: '12:00', end: '20:00' })).status).toBe(201);
    await owner.post(`/api/admin/locations/${SENATOR}/schedule/publish`, { week: monday(tomorrow), notify: false });
    await cron();
    const [m] = await arrived('/anna', 'Jutro zmiana');
    expect(m.msg.body).toMatch(/12:00–20:00 · Kelnerzy$/);
    await cron();
    await settle();
    expect(got.filter((g) => g.path === '/anna' && g.msg?.title === 'Jutro zmiana')).toHaveLength(1);
    expect(got.filter((g) => g.path === '/cezary' && g.msg?.title === 'Jutro zmiana')).toHaveLength(0);
  });

  it('a new mandatory document reaches the people who must read it', async () => {
    const id = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'sop', title: 'Rozliczenie z gościem' })).data.id;
    await owner.put(`/api/admin/content/${id}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rachunek podajemy w etui.' }] }] }, positions: ['waiter'] });
    expect((await owner.post(`/api/admin/content/${id}/publish`, {})).status).toBe(200);
    const [m] = await arrived('/anna', 'Dokument do przeczytania');
    expect(m.msg.body).toMatch(/^„Rozliczenie z gościem” — nowy dokument\. Masz \d+ dni\.$/);
    expect(m.msg.url).toBe(`/m/${id}`);
    await settle();
    expect(got.filter((g) => g.path === '/cezary' && g.msg?.title === 'Dokument do przeczytania')).toHaveLength(0);
    // a clarification is not announced
    await owner.put(`/api/admin/content/${id}`, { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rachunek podajemy zawsze w etui.' }] }] } });
    await owner.post(`/api/admin/content/${id}/publish`, { changeLevel: 'clarification' });
    await settle();
    expect(got.filter((g) => g.path === '/anna' && g.msg?.title === 'Dokument do przeczytania')).toHaveLength(1);
  });

  it('a device the push service forgot (410) is removed; logout switches the device off', async () => {
    await subscribe(anna, '/gone-anna');
    expect((await anna.post('/api/push/test')).data).toMatchObject({ devices: 2, delivered: 1 });
    expect((await anna.post('/api/push/test')).data).toMatchObject({ devices: 1, delivered: 1 });
    expect((await anna.post('/api/push/unsubscribe', { endpoint: `${FAKE}/anna` })).status).toBe(200);
    expect((await anna.post('/api/push/test')).data).toMatchObject({ devices: 0 });
  });
});
