/**
 * 2026-10-17: Panel → Powiadomienia. Settings per division, terminal pushes, one checklist reminder,
 * own notifications; leaders only for their divisions. Fake push service on localhost (as test 21).
 */
// @ts-nocheck -- Node test (http server, Buffer); the app's tsconfig has no Node types
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';
import { activateClient, BASE, Client, ownerClient, SENATOR } from './client';

const PORT = 8792;
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
let chef: Client;
let term: Client;
let daria: Client;
let emil: Client;
let n = 0;
const cid = () => `ntf-${Date.now()}-${n++}`;
const count = (path: string, title: string) => got.filter((g) => g.path === path && g.msg?.title === title).length;
const li = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const doc = { type: 'doc', content: [{ type: 'bulletList', content: [li('Stoliki nakryte'), li('Karty menu czyste')] }] };
const ADMIN = `/api/admin/locations/${SENATOR}/notifications`;
let listId = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(PORT, r));
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon powiadomienia' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
  const mk = async (firstName: string, position: string, pin: string) => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName, lastName: 'Ntf', position });
    return activateClient(e.data.login, e.data.tempSecret, pin);
  };
  daria = await mk('Daria', 'waiter', '715284');
  emil = await mk('Emil', 'waiter', '826395');
  await mk('Filip', 'waiter', '937406');
  await subscribe(daria, '/daria');
  await subscribe(emil, '/emil');
  const x = MANAGER_ROLES.head_chef;
  const m = await owner.post('/api/admin/managers', {
    firstName: 'Kuba',
    lastName: 'Ntf',
    locationId: SENATOR,
    permissions: [...x.permissions, ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + 'head_chef'],
  });
  chef = new Client();
  await chef.login(m.data.login, m.data.tempSecret);
  await chef.post('/api/auth/change-secret', { current: m.data.tempSecret, next: 'KubaHaslo2026!x' });
  listId = (await owner.post(`/api/admin/locations/${SENATOR}/content`, { kind: 'checklist', title: 'Sala — otwarcie zmiany' })).data.id;
  await owner.put(`/api/admin/content/${listId}`, { body: doc, positions: ['waiter'] });
  await owner.post(`/api/admin/content/${listId}/publish`, {});
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('settings', () => {
  it('owner sees every division with defaults; the opening list is chosen by its name', async () => {
    const r = await owner.get(ADMIN);
    expect(r.status).toBe(200);
    expect(r.data.divisions).toEqual(expect.arrayContaining(['waiter', 'kitchen', 'host', 'bartender', 'call_center']));
    expect(r.data.rules.waiter.tomorrow_shift).toMatchObject({ enabled: true, timeMin: 1080 });
    expect(r.data.rules.waiter.checklist_open).toMatchObject({ enabled: true, minutes: 30, auto: true });
    expect(r.data.rules.waiter.checklist_open.listIds).toContain(listId);
    expect(r.data.rules.waiter.checklist_close.listIds).not.toContain(listId);
  });

  it('a head chef sets only the kitchen; employees have no access', async () => {
    const r = await chef.get(ADMIN);
    expect(r.data.divisions).toEqual(['kitchen']);
    expect(Object.keys(r.data.rules)).toEqual(['kitchen']);
    expect((await chef.put(`${ADMIN}/rules`, { division: 'waiter', kind: 'clock_in', enabled: false })).status).toBe(403);
    expect((await chef.put(`${ADMIN}/rules`, { division: 'kitchen', kind: 'tomorrow_shift', timeMin: 1110 })).status).toBe(200);
    expect((await chef.get(ADMIN)).data.rules.kitchen.tomorrow_shift.timeMin).toBe(1110);
    expect((await chef.put(`${ADMIN}/rules`, { division: 'kitchen', kind: 'tomorrow_shift', timeMin: 1111 })).data.error).toBe('invalid_time');
    expect((await chef.put(`${ADMIN}/rules`, { division: 'kitchen', kind: 'clock_in', minutes: 10 })).status).toBe(400);
    expect((await daria.get(ADMIN)).status).toBe(403);
  });
});

describe('terminal and checklist', () => {
  it('clock-in push right away; an old offline punch gets none', async () => {
    const at = Date.now() - 5 * 60_000;
    expect((await term.post('/api/terminal/punch', { pin: '715284', clientId: cid(), offline: true, at })).data.outcome).toBe('in');
    const [m] = await arrived('/daria', 'Wejście');
    expect(m.msg.body).toMatch(/^Zarejestrowano wejście o \d\d:\d\d\. Dobrej zmiany!$/);
    expect((await term.post('/api/terminal/punch', { pin: '937406', clientId: cid(), offline: true, at: Date.now() - 40 * 60_000 })).data.outcome).toBe('in');
    await settle();
    expect(got.filter((g) => g.msg?.title === 'Wejście')).toHaveLength(1);
  });

  it('the opening checklist reminder comes once', async () => {
    await cron();
    const [m] = await arrived('/daria', 'Lista kontrolna');
    expect(m.msg.body).toBe('Wypełnij listę „Sala — otwarcie zmiany”.');
    expect(m.msg.url).toBe(`/listy/${listId}`);
    await cron();
    await settle();
    expect(count('/daria', 'Lista kontrolna')).toBe(1);
  });

  it('clock-out push with the time worked; switched off for the division → nothing', async () => {
    expect((await term.post('/api/terminal/punch', { pin: '715284', clientId: cid() })).data.outcome).toBe('out');
    const [m] = await arrived('/daria', 'Wyjście');
    expect(m.msg.body).toMatch(/^Zarejestrowano wyjście o \d\d:\d\d\. Dziś: 0 h 0[45] min\. Dziękujemy za zmianę!$/);
    expect((await owner.put(`${ADMIN}/rules`, { division: 'waiter', kind: 'clock_in', enabled: false })).status).toBe(200);
    expect((await term.post('/api/terminal/punch', { pin: '826395', clientId: cid() })).data.outcome).toBe('in');
    await settle();
    expect(count('/emil', 'Wejście')).toBe(0);
    await owner.put(`${ADMIN}/rules`, { division: 'waiter', kind: 'clock_in', enabled: true });
  });

  it('a list ticked off → no reminder', async () => {
    const v = await emil.get(`/api/checklists/${listId}/today`);
    expect(v.data.items).toHaveLength(2);
    for (const it of v.data.items) await emil.post(`/api/checklists/${listId}/marks`, { key: it.key });
    await cron();
    await settle();
    expect(count('/emil', 'Lista kontrolna')).toBe(0);
  });
});

describe('own notifications', () => {
  it('validated; a leader cannot write to other divisions', async () => {
    expect((await owner.post(`${ADMIN}/custom`, { title: 'X', body: '', divisions: ['waiter'], trigger: 'weekly', timeMin: 600 })).data.error).toBe('body_required');
    expect((await owner.post(`${ADMIN}/custom`, { title: 'X', body: 'Y', divisions: [], trigger: 'weekly', timeMin: 600 })).data.error).toBe('divisions_required');
    expect((await owner.post(`${ADMIN}/custom`, { title: 'X', body: 'Y', divisions: ['waiter'], trigger: 'once', atMs: Date.now() - 3600_000 })).data.error).toBe('time_past');
    expect((await chef.post(`${ADMIN}/custom`, { title: 'X', body: 'Y', divisions: ['waiter'], trigger: 'weekly', timeMin: 600 })).status).toBe(403);
  });

  it('weekly to the whole division, once a day; after clock-in to people on shift', async () => {
    const a = await owner.post(`${ADMIN}/custom`, { title: 'Odprawa', body: 'O 16:45 krótka odprawa przy barze.', divisions: ['waiter'], audience: 'division', trigger: 'weekly', timeMin: 600, days: 0 });
    expect(a.status).toBe(201);
    const b = await owner.post(`${ADMIN}/custom`, { title: 'Woda na stoły', body: 'Sprawdź karafki.', divisions: ['waiter'], trigger: 'after_clock_in', minutes: 0, url: '/menu' });
    expect(b.status).toBe(201);
    await cron();
    await arrived('/daria', 'Odprawa');
    const [w] = await arrived('/emil', 'Woda na stoły');
    expect(w.msg).toMatchObject({ body: 'Sprawdź karafki.', url: '/menu' });
    await cron();
    await settle();
    expect(count('/daria', 'Odprawa')).toBe(1);
    expect(count('/emil', 'Odprawa')).toBe(1);
    expect(count('/emil', 'Woda na stoły')).toBe(1);
    expect(count('/daria', 'Woda na stoły')).toBe(0); // Daria left
    // listed for the owner, invisible to the head chef
    const list = (await owner.get(ADMIN)).data.custom;
    expect(list.find((x) => x.id === a.data.id)).toMatchObject({ trigger: 'weekly', audience: 'division', editable: true });
    expect((await chef.get(ADMIN)).data.custom).toHaveLength(0);
    expect((await chef.req('DELETE', `/api/admin/notifications/custom/${a.data.id}`)).status).toBe(404);
    // switched off → nothing more
    expect((await owner.put(`/api/admin/notifications/custom/${b.data.id}`, { title: 'Woda na stoły', body: 'Sprawdź karafki.', divisions: ['waiter'], trigger: 'after_clock_in', minutes: 0, enabled: false })).status).toBe(200);
    expect((await owner.req('DELETE', `/api/admin/notifications/custom/${a.data.id}`)).status).toBe(200);
    expect((await owner.get(ADMIN)).data.custom.map((x) => x.enabled)).toEqual([false]);
  });

  it('„Wyślij próbne do mnie” goes to the signed-in person', async () => {
    const r = await owner.post(`${ADMIN}/test`, { title: 'Próba', body: 'Tekst' });
    expect(r.data).toMatchObject({ devices: 0 });
  });
});
