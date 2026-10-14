/**
 * Stage 2 acceptance (spec section L: "Вход и доступ", "Права и изоляция").
 * Runs against local workerd started by scripts/test-integration.sh.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, Client } from './client';

const OWNER_LOGIN = process.env.OWNER_LOGIN ?? 'test.wlasciciel';
const OWNER_TEMP = process.env.OWNER_TEMP_PASSWORD ?? 'TymczasoweHaslo1';
const OWNER_PASSWORD = 'NoweHasloWlasciciela2026';
const SENATOR = 'loc_senator';

const owner = new Client();
let empA = { id: '', login: '', pin: '' };
let locB = '';
let empB = { id: '', login: '', pin: '' };
let managerA = { id: '', login: '', password: '' };

async function activate(login: string, temp: string, next: string) {
  const c = new Client();
  expect((await c.login(login, temp)).status).toBe(200);
  expect((await c.post('/api/auth/change-secret', { current: temp, next })).status).toBe(200);
  return c;
}

describe('owner first login', () => {
  it('must change the temporary password before anything else', async () => {
    expect((await owner.login(OWNER_LOGIN, OWNER_TEMP)).status).toBe(200);
    const me = await owner.get('/api/auth/me');
    expect(me.data.user.mustChangeSecret).toBe(true);
    expect((await owner.get('/api/admin/locations')).data.error).toBe('must_change_secret');
    expect((await owner.post('/api/auth/change-secret', { current: 'zle', next: OWNER_PASSWORD })).data.error).toBe('wrong_current_secret');
    expect((await owner.post('/api/auth/change-secret', { current: OWNER_TEMP, next: 'krotkie' })).data.error).toBe('password_too_short');
    expect((await owner.post('/api/auth/change-secret', { current: OWNER_TEMP, next: OWNER_PASSWORD })).status).toBe(200);
    expect((await owner.get('/api/admin/locations')).status).toBe(200);
  });

  it('sets a hardened session cookie', async () => {
    const c = new Client();
    await c.login(OWNER_LOGIN, OWNER_PASSWORD);
    expect(c.setCookieHeader).toMatch(/HttpOnly/i);
    expect(c.setCookieHeader).toMatch(/Secure/i);
    expect(c.setCookieHeader).toMatch(/SameSite=Lax/i);
  });
});

describe('employee accounts', () => {
  beforeAll(async () => {
    const res = await owner.post(`/api/admin/locations/${SENATOR}/employees`, {
      firstName: 'Anna',
      lastName: 'Kowalska',
      position: 'waiter',
      startDate: '2026-10-01',
    });
    expect(res.status).toBe(201);
    empA = { id: res.data.id, login: res.data.login, pin: res.data.tempSecret };
  });

  it('proposes login imie.nazwisko and a 6-digit temporary PIN', () => {
    expect(empA.login).toBe('anna.kowalska');
    expect(empA.pin).toMatch(/^\d{6}$/);
  });

  it('accepts the login without Polish letters / case', async () => {
    const c = new Client();
    expect((await c.login('ANNA.Kowalska', empA.pin)).status).toBe(200);
  });

  it('refuses simple PINs and makes the temporary PIN unusable', async () => {
    const c = new Client();
    await c.login(empA.login, empA.pin);
    expect((await c.post('/api/auth/change-secret', { current: empA.pin, next: '123456' })).data.error).toBe('pin_too_simple');
    expect((await c.post('/api/auth/change-secret', { current: empA.pin, next: '000000' })).data.error).toBe('pin_too_simple');
    expect((await c.post('/api/auth/change-secret', { current: empA.pin, next: '48291' })).data.error).toBe('pin_format');
    expect((await c.post('/api/auth/change-secret', { current: empA.pin, next: '482913' })).status).toBe(200);
    const old = empA.pin;
    empA.pin = '482913';
    expect((await new Client().login(empA.login, old)).data.error).toBe('invalid_credentials');
    expect((await new Client().login(empA.login, empA.pin)).status).toBe(200);
  });

  it('answers unknown login and wrong PIN with the same message', async () => {
    const a = await new Client().login('nie.istnieje', '482913');
    const b = await new Client().login(empA.login, '999888');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.data).toEqual(b.data);
    expect(a.data.error).toBe('invalid_credentials');
  });

  it('locks the account after 5 failures and the manager can unlock it', async () => {
    const c = new Client();
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) codes.push((await c.login(empA.login, '305718')).data.error);
    // 1 earlier failure (previous test) + 4 here = 5 → locked
    expect(codes.at(-1)).toBe('locked');
    expect((await c.login(empA.login, empA.pin)).data.error).toBe('locked');
    expect((await owner.post(`/api/admin/users/${empA.id}/unlock`)).status).toBe(200);
    expect((await c.login(empA.login, empA.pin)).status).toBe(200);
  });

  it('locks unknown logins the same way (no account enumeration)', async () => {
    const c = new Client();
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.login('ktos.obcy', '305718')).data.error);
    expect(codes.slice(0, 4)).toEqual(Array(4).fill('invalid_credentials'));
    expect(codes[4]).toBe('locked');
  });
});

describe('isolation between locations and manager permissions', () => {
  beforeAll(async () => {
    const loc = await owner.post('/api/admin/locations', { name: 'Senator Mokotów' });
    expect(loc.status).toBe(201);
    locB = loc.data.id;
    const e = await owner.post(`/api/admin/locations/${locB}/employees`, { firstName: 'Łukasz', lastName: 'Żółć', position: 'waiter' });
    empB = { id: e.data.id, login: e.data.login, pin: e.data.tempSecret };
    const m = await owner.post('/api/admin/managers', { firstName: 'Marek', lastName: 'Nowak', locationId: SENATOR });
    expect(m.status).toBe(201);
    managerA = { id: m.data.id, login: m.data.login, password: m.data.tempSecret };
    expect(m.data.permissions).toEqual(['employees.view', 'training.assign', 'results.view']);
  });

  it('folds Polish letters in proposed logins', () => {
    expect(empB.login).toBe('lukasz.zolc');
  });

  it('manager sees only his location', async () => {
    const m = await activate(managerA.login, managerA.password, 'HasloMenedzera2026');
    expect((await m.get(`/api/admin/locations/${SENATOR}/employees`)).status).toBe(200);
    const foreign = await m.get(`/api/admin/locations/${locB}/employees`);
    expect(foreign.status).toBe(404);
    const locs = await m.get('/api/admin/locations');
    expect(locs.data.locations.map((l: { id: string }) => l.id)).toEqual([SENATOR]);
    expect((await m.post(`/api/admin/users/${empB.id}/reset-secret`)).status).toBe(404);
  });

  it('manager without employees.manage cannot reset a PIN; with it he can', async () => {
    const m = new Client();
    await m.login(managerA.login, 'HasloMenedzera2026');
    expect((await m.post(`/api/admin/users/${empA.id}/reset-secret`)).status).toBe(403);
    expect(
      (await owner.put(`/api/admin/managers/${managerA.id}/permissions`, {
        locationId: SENATOR,
        permissions: ['employees.view', 'employees.manage', 'training.assign', 'results.view'],
      })).status,
    ).toBe(200);
    const reset = await m.post(`/api/admin/users/${empA.id}/reset-secret`);
    expect(reset.status).toBe(200);
    expect(reset.data.tempSecret).toMatch(/^\d{6}$/);
    empA.pin = reset.data.tempSecret;
    // A manager can never act on the owner or another manager.
    expect((await m.post(`/api/admin/users/${managerA.id}/deactivate`)).status).toBe(404);
  });

  it('manager cannot create locations, managers or read the audit log', async () => {
    const m = new Client();
    await m.login(managerA.login, 'HasloMenedzera2026');
    expect((await m.post('/api/admin/locations', { name: 'X' })).status).toBe(403);
    expect((await m.post('/api/admin/managers', { firstName: 'A', lastName: 'B', locationId: SENATOR })).status).toBe(403);
    expect((await m.get('/api/admin/audit')).status).toBe(403);
  });

  it('employee has no admin access and sees only his own location', async () => {
    const b = await activate(empB.login, empB.pin, '730418');
    expect((await b.get(`/api/admin/locations/${locB}/employees`)).status).toBe(403);
    expect((await b.get(`/api/admin/locations/${SENATOR}/employees`)).status).toBe(404);
    const me = await b.get('/api/auth/me');
    expect(me.data.locations.map((l: { id: string }) => l.id)).toEqual([locB]);
    expect(me.data.locations[0].permissions).toEqual([]);
  });
});

describe('deactivation', () => {
  it('ends every session at once and blocks login', async () => {
    const c = await activate(empA.login, empA.pin, '615203');
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await owner.post(`/api/admin/users/${empA.id}/deactivate`)).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await new Client().login(empA.login, '615203')).data.error).toBe('invalid_credentials');
    const list = await owner.get(`/api/admin/locations/${SENATOR}/employees`);
    expect(list.data.employees.find((e: { id: string }) => e.id === empA.id).status).toBe('inactive');
  });
});

describe('request protection', () => {
  it('rejects state-changing requests without our Origin (CSRF)', async () => {
    expect((await new Client().post('/api/auth/login', { login: 'a', secret: 'b' }, { origin: null })).data.error).toBe('bad_origin');
    expect((await new Client().post('/api/auth/login', { login: 'a', secret: 'b' }, { origin: 'https://evil.example' })).data.error).toBe('bad_origin');
  });

  it('requires a session for admin API', async () => {
    expect((await new Client().get(`/api/admin/locations/${SENATOR}/employees`)).status).toBe(401);
  });

  it('limits failed logins per IP', async () => {
    const c = new Client('10.255.255.1');
    let last = '';
    for (let i = 0; i < 21; i++) last = (await c.login(`brute${i}`, '305718')).data.error;
    expect(last).toBe('too_many_attempts');
  });

  it('logs admin actions without secrets', async () => {
    const audit = await owner.get('/api/admin/audit?limit=200');
    const actions = audit.data.entries.map((e: { action: string }) => e.action);
    for (const a of ['user.create', 'manager.create', 'manager.permissions', 'user.reset_secret', 'user.unlock', 'user.deactivate', 'location.create']) {
      expect(actions).toContain(a);
    }
    const text = JSON.stringify(audit.data);
    expect(text).not.toMatch(/tempSecret|secret_hash|482913|615203|HasloMenedzera/);
  });

  it('serves the base URL', () => {
    expect(BASE).toMatch(/^http/);
  });
});
