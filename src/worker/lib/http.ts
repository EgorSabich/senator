import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** API errors carry a stable code; the client maps codes to Polish messages. */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(status, { message: code });
  }
}

export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');
export const unauthorized = () => new ApiError(401, 'unauthorized');
export const badRequest = (code = 'invalid_input', details?: Record<string, unknown>) => new ApiError(400, code, details);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest('invalid_json');
  }
}

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}
