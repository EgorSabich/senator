# Testing

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript, whole repo |
| `npm test` | Unit: Polish folding and search equivalence, login normalization, Polish sorting, PIN/password rules, anonymization cutoff, backup naming |
| `npm run test:smoke` | Local workerd: migrations, `/api/health`, SPA fallback, robots.txt, noindex headers, API 404, cron → anonymization, cron → backup in R2, backup → SQL restore |
| `npm run test:int` | Local workerd, fresh DB + test owner: spec section L "Вход и доступ" and "Права и изоляция" (19 tests) |
| `npm run test:all` | All of the above |

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

## Results

| Date | Stage | Unit | Smoke | Integration |
| --- | --- | --- | --- | --- |
| 2026-10-14 | 1 | 7/7 | 6/6 | — |
| 2026-10-14 | 2 | 11/11 | 6/6 | 19/19 |
