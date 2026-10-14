export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: 'production' | 'staging' | 'development';
  /** Server-side pepper for PIN/password hashing and IP hashing. Set with `wrangler secret put AUTH_SECRET`. */
  AUTH_SECRET: string;
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  login: string;
  role: 'owner' | 'manager' | 'employee';
  secretKind: 'pin' | 'password';
  mustChangeSecret: boolean;
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
