/**
 * PINs set before the time clock (no terminal link yet) work on the terminal and get linked on first use;
 * two people sharing an old PIN both have to choose a new one.
 */
// @ts-ignore -- tests run in Node; the app's tsconfig has no Node types
import { execSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { activateClient, Client, ownerClient, SENATOR } from './client';

let owner: Client;
let term: Client;
let n = 0;
const cid = () => `legacy-${Date.now()}-${n++}`;
/** Simulates data from before D35: the PIN works for signing in, but has no terminal link. */
const unlink = (ids: string[]) =>
  execSync(
    `npx wrangler d1 execute DB --local --persist-to .wrangler/state-int --command "UPDATE users SET pin_lookup = NULL WHERE id IN (${ids.map((i) => `'${i}'`).join(',')})"`,
    { stdio: 'pipe' },
  );

beforeAll(async () => {
  owner = await ownerClient();
  const t = await owner.post(`/api/admin/locations/${SENATOR}/terminals`, { name: 'Telefon legacy' });
  term = new Client();
  await term.login(t.data.login, t.data.tempSecret);
});

describe('old PINs', () => {
  it('an old PIN works on the terminal and is linked', async () => {
    const e = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Stara', lastName: 'Pinezka', position: 'waiter' });
    await activateClient(e.data.login, e.data.tempSecret, '864213');
    unlink([e.data.id]);
    const p = await term.post('/api/terminal/preview', { pin: '864213' });
    expect(p.data).toMatchObject({ outcome: 'in', name: 'Stara P.' });
    expect((await term.post('/api/terminal/punch', { pin: '864213', clientId: cid() })).data.outcome).toBe('in');
  });

  it('two people with the same old PIN: nobody is clocked, both must choose a new PIN', async () => {
    const a = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ala', lastName: 'Dubel', position: 'waiter' });
    await activateClient(a.data.login, a.data.tempSecret, '753159');
    unlink([a.data.id]);
    const b = await owner.post(`/api/admin/locations/${SENATOR}/employees`, { firstName: 'Ola', lastName: 'Dubel', position: 'waiter' });
    const bc = await activateClient(b.data.login, b.data.tempSecret, '864279');
    // set the same PIN by hand in the old way (before PINs were unique): copy Ala's hash
    execSync(
      `npx wrangler d1 execute DB --local --persist-to .wrangler/state-int --command "UPDATE users SET pin_lookup = NULL, secret_hash = (SELECT secret_hash FROM users WHERE id = '${a.data.id}'), secret_salt = (SELECT secret_salt FROM users WHERE id = '${a.data.id}') WHERE id = '${b.data.id}'"`,
      { stdio: 'pipe' },
    );
    expect((await term.post('/api/terminal/preview', { pin: '753159' })).data.outcome).toBe('unknown_pin');
    expect((await bc.get('/api/auth/me')).data.user.mustChangeSecret).toBe(true);
  });
});
