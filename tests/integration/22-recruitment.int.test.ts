/**
 * 2026-10-17 (iteration 3, step 4): Rekrutacja — candidates by division, phone format, comments, CV, hire,
 * ICS subscription, RODO deletion.
 */
// @ts-nocheck -- Node test (child_process); the app's tsconfig has no Node types
import { execSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER_ROLES, PERMISSIONS, DIVISION_SCOPE_PREFIX, ROLE_PREFIX } from '../../src/shared/constants';
import { BASE, Client, ownerClient, SENATOR } from './client';

const sql = (q: string) => execSync(`npx wrangler d1 execute DB --local --persist-to .wrangler/state-int --command "${q}"`, { stdio: 'pipe' });
let owner: Client;
let chef: Client;
let cookCand = '';
let waiterCand = '';
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function leader(first: string, role: keyof typeof MANAGER_ROLES) {
  const x = MANAGER_ROLES[role];
  const permissions = [...(x.permissions === 'all' ? PERMISSIONS : x.permissions), ...x.divisions.map((d) => DIVISION_SCOPE_PREFIX + d), ROLE_PREFIX + role];
  const m = await owner.post('/api/admin/managers', { firstName: first, lastName: 'Rekrutacja', locationId: SENATOR, permissions });
  const c = new Client();
  await c.login(m.data.login, m.data.tempSecret);
  await c.post('/api/auth/change-secret', { current: m.data.tempSecret, next: `${first}Haslo2026!r` });
  return c;
}
async function putCv(c: Client, id: string, body: Uint8Array, type: string) {
  const res = await fetch(`${BASE}/api/admin/candidates/${id}/cv`, {
    method: 'PUT',
    headers: { Cookie: c.cookie, Origin: BASE, 'Content-Type': type, 'X-File-Name': encodeURIComponent('CV Ewa Kot.pdf'), 'CF-Connecting-IP': c.ip },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

beforeAll(async () => {
  owner = await ownerClient();
  chef = await leader('Teodor', 'head_chef');
});

describe('Rekrutacja', () => {
  it('owner adds candidates; the phone is normalised; a date moves the stage', async () => {
    const bad = await owner.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'X', position: 'waiter', phone: '12' });
    expect(bad.data.error).toBe('phone_invalid');
    const w = await owner.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'Ewa Kot', position: 'waiter', phone: '601 234-567', email: 'Ewa.Kot@Example.pl' });
    expect(w.status).toBe(201);
    expect(w.data.candidate).toMatchObject({ phone: '+48601234567', email: 'ewa.kot@example.pl', stage: 'new', division: 'waiter' });
    waiterCand = w.data.candidate.id;
    const k = await owner.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'Piotr Zając', position: 'kitchen', phone: '+380 67 123 4567', interviewAt: '2026-11-03T14:00' });
    expect(k.data.candidate.stage).toBe('interview');
    expect(k.data.candidate.phone).toBe('+380671234567');
    cookCand = k.data.candidate.id;
    const u = await owner.put(`/api/admin/candidates/${cookCand}`, { trialAt: '2026-11-05T16:00' });
    expect(u.data.candidate.stage).toBe('trial');
    expect((await owner.put(`/api/admin/candidates/${cookCand}`, { trialAt: '2026-13-05T16:00' })).data.error).toBe('date_invalid');
  });

  it('a head chef sees only kitchen candidates and cannot add a waiter', async () => {
    const list = await chef.get(`/api/admin/locations/${SENATOR}/candidates`);
    const ids = list.data.candidates.map((c: { id: string }) => c.id);
    expect(ids).toContain(cookCand);
    expect(ids).not.toContain(waiterCand);
    expect(list.data.divisions).toEqual(['kitchen']);
    expect((await chef.get(`/api/admin/candidates/${waiterCand}`)).status).toBe(404);
    expect((await chef.post(`/api/admin/locations/${SENATOR}/candidates`, { name: 'A B', position: 'waiter' })).data.error).toBe('outside_divisions');
    expect((await chef.put(`/api/admin/candidates/${cookCand}`, { position: 'waiter' })).data.error).toBe('outside_divisions');
  });

  it('comments: anyone with access adds; only the author (or the owner) removes', async () => {
    const a = await chef.post(`/api/admin/candidates/${cookCand}/comments`, { body: 'Dobre doświadczenie w kuchni włoskiej.' });
    expect(a.status).toBe(201);
    expect(a.data.comment.authorName).toBe('Teodor Rekrutacja');
    const b = await owner.post(`/api/admin/candidates/${cookCand}/comments`, { body: 'Dzień próbny w czwartek.' });
    expect((await chef.req('DELETE', `/api/admin/candidates/${cookCand}/comments/${b.data.comment.id}`)).status).toBe(403);
    expect((await owner.req('DELETE', `/api/admin/candidates/${cookCand}/comments/${a.data.comment.id}`)).status).toBe(200);
    const one = await owner.get(`/api/admin/candidates/${cookCand}`);
    expect(one.data.comments).toHaveLength(1);
    expect((await owner.get(`/api/admin/locations/${SENATOR}/candidates`)).data.candidates.find((c: { id: string }) => c.id === cookCand).comments).toBe(1);
  });

  it('CV: only PDF or an image, served only to people with access', async () => {
    expect((await putCv(owner, waiterCand, new TextEncoder().encode('hello'), 'application/pdf')).data.error).toBe('cv_type');
    expect((await putCv(owner, waiterCand, PDF, 'text/html')).data.error).toBe('cv_type');
    const ok = await putCv(owner, waiterCand, PDF, 'application/pdf');
    expect(ok.data.cv).toEqual({ name: 'CV Ewa Kot.pdf', type: 'application/pdf' });
    const got = await fetch(`${BASE}/api/admin/candidates/${waiterCand}/cv`, { headers: { Cookie: owner.cookie } });
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(got.headers.get('content-disposition')).toMatch(/^inline/);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PDF);
    expect((await fetch(`${BASE}/api/admin/candidates/${waiterCand}/cv`, { headers: { Cookie: chef.cookie } })).status).toBe(404);
    expect((await fetch(`${BASE}/api/admin/candidates/${waiterCand}/cv`)).status).toBe(401);
  });

  it('„Utwórz konto”: an employee with the candidate position, the CV is removed', async () => {
    await owner.put(`/api/admin/candidates/${waiterCand}`, { stage: 'hired' });
    const h = await owner.post(`/api/admin/candidates/${waiterCand}/hire`, { startDate: '2026-11-01' });
    expect(h.status).toBe(201);
    expect(h.data).toMatchObject({ secretKind: 'pin', name: 'Ewa Kot' });
    expect(h.data.tempSecret).toMatch(/^\d{6}$/);
    const emp = (await owner.get(`/api/admin/locations/${SENATOR}/employees`)).data.employees.find((e: { id: string }) => e.id === h.data.id);
    expect(emp).toBeTruthy();
    const c = (await owner.get(`/api/admin/candidates/${waiterCand}`)).data.candidate;
    expect(c).toMatchObject({ stage: 'hired', hiredUserId: h.data.id, cv: null });
    expect((await owner.post(`/api/admin/candidates/${waiterCand}/hire`, {})).data.error).toBe('already_hired');
    const login = new Client();
    expect((await login.login(h.data.login, h.data.tempSecret)).status).toBe(200);
  });

  it('ICS subscription: secret link, own divisions only, revocable', async () => {
    const f = await chef.post('/api/admin/recruitment/feed');
    expect(f.data.url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/);
    const path = new URL(f.data.url).pathname;
    const ics = await (await fetch(BASE + path)).text();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Rozmowa · Piotr Zając (Kuchnia)');
    expect(ics).toContain('SUMMARY:Dzień próbny · Piotr Zając (Kuchnia)');
    expect(ics).toContain('DTSTART:20261103T130000Z'); // 14:00 Warsaw (CET)
    expect(ics).not.toContain('+380');
    expect(ics).not.toContain('Ewa Kot');
    expect((await chef.get('/api/admin/recruitment/feed')).data.feed.lastUsedAt).toBeTruthy();
    const again = await chef.post('/api/admin/recruitment/feed');
    expect((await fetch(BASE + path)).status).toBe(404);
    await chef.req('DELETE', '/api/admin/recruitment/feed');
    expect((await fetch(BASE + new URL(again.data.url).pathname)).status).toBe(404);
    expect((await fetch(`${BASE}/api/calendar/zzz.ics`)).status).toBe(404);
  });

  it('RODO: deleted 6 months after the last change; „Zachowaj” restarts the period', async () => {
    const old = Date.now() - 200 * 86400_000;
    sql(`UPDATE candidates SET updated_at = ${old} WHERE id IN ('${cookCand}', '${waiterCand}')`);
    expect((await owner.post(`/api/admin/candidates/${cookCand}/keep`)).data.deleteAt).toBeGreaterThan(Date.now() + 180 * 86400_000);
    await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=30+1+*+*+*`);
    for (let i = 0; i < 40 && (await owner.get(`/api/admin/candidates/${waiterCand}`)).status !== 404; i++) await new Promise((r) => setTimeout(r, 250));
    expect((await owner.get(`/api/admin/candidates/${waiterCand}`)).status).toBe(404);
    expect((await owner.get(`/api/admin/candidates/${cookCand}`)).status).toBe(200);
  });

  it('employees without the permission see nothing', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Olga', lastName: 'Zwykła', position: 'waiter' });
    const c = new Client();
    await c.login(e.data.login, e.data.tempSecret);
    await c.post('/api/auth/change-secret', { current: e.data.tempSecret, next: '927461' });
    expect([403, 404]).toContain((await c.get(`/api/admin/locations/${SENATOR}/candidates`)).status);
    expect([403, 404]).toContain((await c.get(`/api/admin/candidates/${cookCand}`)).status);
  });
});
