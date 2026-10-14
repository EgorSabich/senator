# Testing

| Command | What it checks |
| --- | --- |
| `npm test` | Unit: Polish folding and search equivalence (żurek = zurek, łosoś = losos), login normalization, Polish sorting, anonymization cutoff, backup naming |
| `npm run typecheck` | TypeScript, whole repo |
| `./scripts/smoke-local.sh` | On local workerd: migrations, `/api/health`, SPA fallback, robots.txt, noindex headers, API 404, cron → anonymization (3 y old anonymized, 1 y old kept), cron → backup in R2, backup → SQL restore after deleting data |

## Stage 1 results (2026-10-14)

- Unit: 7/7 passed.
- Typecheck: clean.
- Smoke: all 6 checks passed.

Acceptance criteria from spec section L are added to these suites stage by stage.
