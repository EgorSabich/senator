export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: 'production' | 'staging' | 'development';
  /** Server-side pepper for PIN/password hashing and IP hashing. Set with `wrangler secret put AUTH_SECRET`. */
  AUTH_SECRET: string;
  /** Web Push (2026-10-17), set by the owner in Cloudflare secrets; without them notifications are off. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  role: 'owner' | 'manager' | 'employee' | 'terminal';
  secretKind: 'pin' | 'password';
  mustChangeSecret: boolean;
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
