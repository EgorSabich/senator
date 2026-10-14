# Testing

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript, whole repo |
| `npm test` | Unit: Polish folding and search equivalence, login normalization, Polish sorting, PIN/password rules, anonymization cutoff, backup naming |
| `npm run test:smoke` | Local workerd: migrations, `/api/health`, SPA fallback, robots.txt, noindex headers, API 404, cron → anonymization, cron → backup in R2, backup → SQL restore |
| `npm run test:int` | Local workerd, fresh DB + test owner: spec section L "Вход и доступ" and "Права и изоляция" (19 tests) |
| `npm run test:all` | All of the above |
| `scripts/ui-server.sh` + `MENU_BUNDLE=… python3 tests/ui/menu_walkthrough.py` | Menu: real bundle import (81 items, 25 photos), edit with change level, allergen confirmation, bar photos, phone layout without horizontal scroll |
| `scripts/ui-server.sh` + `python3 tests/ui/panel_walkthrough.py` | Headless Chromium walkthrough of the panel (desktop 1280 px + phone 390 px), screenshots to `$SHOTS_DIR` |

## Stage 2 acceptance (spec L) → test

| Criterion | Test |
| --- | --- |
| Same message for unknown login and wrong PIN | `answers unknown login and wrong PIN with the same message` |
| 5 failures lock 15 min; manager unlocks | `locks the account after 5 failures…`, `locks unknown logins the same way` |
| Temporary PIN unusable after first login; 123456 / 000000 refused | `refuses simple PINs and makes the temporary PIN unusable` |
| Deactivated user loses every session at once | `ends every session at once and blocks login` |
| Employee cannot reach other results / admin API | `employee has no admin access…` |
| Manager without permission is refused; with it allowed | `manager without employees.manage…` |
| Second location invisible to first location's manager | `manager sees only his location` |
| Cookie flags, CSRF, IP limit, audit without secrets | `sets a hardened session cookie`, `request protection` suite |

## Stage 4 acceptance (spec L "Меню и поиск", K stage 4) → test

| Criterion | Test |
| --- | --- |
| Unconfirmed allergens hidden from waiters; confirmed visible right away | `imported allergens are hidden from waiters`, `after confirmation the waiter sees "contains" right away…` |
| Only `allergens.confirm` confirms; all 14 required | `manager without allergens.confirm cannot confirm`, `incomplete allergen list is refused` |
| Import complete, no duplicates on re-import | `imports items…`, `a second import skips existing items` + UI walkthrough (32 kitchen + 49 bar, 25 photos) |
| Photo not reachable without login / from another location | `photo upload checks the type; photo needs a session` |
| Archived items hidden from waiters, kept in history | `archived items disappear for waiters…` |
| Every edit = version with change level | `every edit needs a change level…` |
| "zurek" finds "żurek" | index is written with Polish folding on import/edit; search screen and its test come in stage 5 |

## Results

| Date | Stage | Unit | Smoke | Integration |
| --- | --- | --- | --- | --- |
| 2026-10-14 | 1 | 7/7 | 6/6 | — |
| 2026-10-14 | 2 | 11/11 | 6/6 | 19/19 |
| 2026-10-14 | 3 | 17/17 | 6/6 | 34/34 (+ UI walkthrough: no page errors) |
| 2026-10-14 | 4 | 17/17 | 6/6 | 55/55 (+ menu UI walkthrough with the real bundle: no page errors) |
