export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: 'production' | 'staging' | 'development';
}
