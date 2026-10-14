# Architecture

One Cloudflare Worker serves the API and the static React app.

```
browser (PWA, Polish UI)
   │  HTTPS, session cookie (stage 2)
   ▼
Cloudflare Worker  ──  Hono: /api/*  (auth + permission checks on every request)
   │                └─ static assets: dist/client (SPA fallback)
   ├── D1  "DB"       SQLite, Western Europe — all data
   ├── R2  "PHOTOS"   private; served only via /media/* after auth (stage 3)
   └── R2  "BACKUPS"  nightly NDJSON export (30 days)
Cron 01:30 UTC → nightly backup + anonymization (D19) + login-attempt cleanup
```

| Concern | Choice |
| --- | --- |
| Language | TypeScript everywhere (`src/shared` used by both sides) |
| API | Hono 4 (`src/worker`) |
| UI | React 19 + Vite 8 via `@cloudflare/vite-plugin` (`src/client`) |
| DB access | Drizzle ORM; SQL migrations in `migrations/`, applied with wrangler |
| Search | FTS5 table `search_index`; text folded with `foldPolish` (FTS5 does not fold "ł") |
| Sorting | `Intl.Collator('pl')` (`comparePl`) |
| UI strings | `src/client/i18n/pl.ts` only |
| Environments | production (top level of `wrangler.jsonc`), staging (`CLOUDFLARE_ENV=staging`), local (workerd via Vite / wrangler dev) |

## Rules

- Every API handler that touches location data goes through the access layer (stage 2) — never query by id alone.
- Correct test answers never leave the server before an attempt is submitted.
- Nothing is hard-deleted except by the anonymization job and backup pruning.

## API (stage 2)

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/login`, `/api/auth/logout`, `/api/auth/change-secret` | anyone / signed in |
| GET | `/api/auth/me` | signed in |
| GET / POST | `/api/admin/locations` | accessible list / owner |
| GET / POST | `/api/admin/locations/:locId/employees` | `employees.view` / `employees.manage` |
| POST | `/api/admin/users/:id/{reset-secret,unlock,logout-all,deactivate,reactivate}` | `employees.manage` in a shared location, or owner |
| POST, PUT | `/api/admin/managers`, `/api/admin/managers/:id/permissions` | owner |
| GET | `/api/admin/audit` | owner |

Error bodies: `{ "error": "<code>" }`; the client maps codes to Polish (`src/client/i18n/pl.ts → errors`).
