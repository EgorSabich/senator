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

### Stage 3

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/admin/managers` | owner |
| GET / POST | `/api/admin/locations/:locId/content` | `content.edit` (shared: owner) |
| GET / PUT | `/api/admin/content/:id` | `content.edit` in its location (shared: owner) |
| GET | `/api/admin/content/:id/versions/:versionId` | same |
| POST | `/api/admin/content/:id/{publish,discard-draft,archive,restore}` | same |
| POST / DELETE | `/api/admin/content/:id/attachment` | same |
| POST | `/api/admin/locations/:locId/media` (`?shared=1`) | `content.edit` or `menu.edit` (shared: owner) |
| GET | `/media/<key>` | signed in + access to the key's location |

### Stage 4 — menu

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/admin/locations/:locId/menu` | `menu.edit` or `allergens.confirm` |
| POST | `/api/admin/locations/:locId/menu/categories`, PUT `/api/admin/menu/categories/:id` | `menu.edit` |
| PUT | `/api/admin/locations/:locId/menu/sections/:section` (note above the list) | `menu.edit` |
| POST | `/api/admin/locations/:locId/menu/items` | `menu.edit` |
| GET | `/api/admin/menu/items/:id`, `/api/admin/menu/items/:id/versions/:versionId` | `menu.edit` or `allergens.confirm` |
| PUT | `/api/admin/menu/items/:id` (texts, ingredients, category + change level → new version) | `menu.edit` |
| PUT | `/api/admin/menu/items/:id/allergens` (all 14 allergens + 4 diets; saves and confirms; status change = significant version) | `allergens.confirm` |
| POST / DELETE | `/api/admin/menu/items/:id/photo`; POST `/archive`, `/restore` | `menu.edit` |
| POST | `/api/admin/locations/:locId/menu/import` (bundle chunk, max 8 items; existing `import_key` skipped) | `menu.edit` |
| GET | `/api/locations/:locId/menu`, `/api/menu/items/:id` — staff view: active items, only confirmed "contains" allergens and confirmed "yes" diets | any signed-in user of the location |

Menu import: `scripts/menu/build_menu_bundle.py` turns the source sheets into one JSON bundle (texts as they are, photos from the bar sheet resized to 1600 px, list of data issues). The owner uploads it in Panel → Menu → Import z pliku; the panel sends it in chunks of 8 items so one request stays far below D1 per-request limits. The bundle holds restaurant data — it is never committed (the repository is public).

Error bodies: `{ "error": "<code>" }`; the client maps codes to Polish (`src/client/i18n/pl.ts → errors`).
