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
