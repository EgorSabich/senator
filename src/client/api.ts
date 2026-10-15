export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiFailure(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiFailure(res.status, data.error ?? 'generic');
  return data as T;
}

export interface Me {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    login: string;
    role: 'owner' | 'manager' | 'employee' | 'terminal';
    secretKind: 'pin' | 'password';
    mustChangeSecret: boolean;
  };
  locations: { id: string; name: string; permissions: string[] }[];
}
