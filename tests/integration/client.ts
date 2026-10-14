/** Minimal HTTP client with a cookie jar for integration tests against local workerd. */
export const BASE = process.env.ACADEMY_URL ?? 'http://localhost:8799';

export class Client {
  cookie = '';
  setCookieHeader = '';
  constructor(public ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {}

  async req(method: string, path: string, body?: unknown, opts: { origin?: string | null } = {}) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': this.ip };
    if (opts.origin !== null) headers.Origin = opts.origin ?? BASE;
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) {
      this.setCookieHeader = set;
      const m = /sa_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `sa_session=${m[1]}` : '';
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { status: res.status, data };
  }
  get(path: string) {
    return this.req('GET', path);
  }
  post(path: string, body?: unknown, opts?: { origin?: string | null }) {
    return this.req('POST', path, body ?? {}, opts);
  }
  put(path: string, body?: unknown) {
    return this.req('PUT', path, body ?? {});
  }
  async login(login: string, secret: string) {
    return this.post('/api/auth/login', { login, secret });
  }
}

export const OWNER_LOGIN = process.env.OWNER_LOGIN ?? 'test.wlasciciel';
export const OWNER_TEMP = process.env.OWNER_TEMP_PASSWORD ?? 'TymczasoweHaslo1';
export const OWNER_PASSWORD = 'NoweHasloWlasciciela2026';
export const SENATOR = 'loc_senator';

/** Signed-in owner, whichever test file runs first. */
export async function ownerClient(): Promise<Client> {
  const c = new Client();
  if ((await c.login(OWNER_LOGIN, OWNER_PASSWORD)).status === 200) return c;
  await c.login(OWNER_LOGIN, OWNER_TEMP);
  await c.post('/api/auth/change-secret', { current: OWNER_TEMP, next: OWNER_PASSWORD });
  return c;
}

/** Creates a user via the admin API, activates it with `next` and returns a signed-in client. */
export async function activateClient(login: string, temp: string, next: string): Promise<Client> {
  const c = new Client();
  await c.login(login, temp);
  await c.post('/api/auth/change-secret', { current: temp, next });
  return c;
}

export async function upload(c: Client, path: string, file: Blob, name: string) {
  const form = new FormData();
  form.append('file', file, name);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Origin: BASE, Cookie: c.cookie, 'CF-Connecting-IP': c.ip },
    body: form,
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> };
}

export async function getRaw(c: Client | null, path: string) {
  const res = await fetch(BASE + path, { headers: c ? { Cookie: c.cookie, 'CF-Connecting-IP': c.ip } : {} });
  return { status: res.status, type: res.headers.get('content-type'), bytes: new Uint8Array(await res.arrayBuffer()) };
}
