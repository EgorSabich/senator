# Project overview

**Senator Academy** — closed web app (PWA) for onboarding and training waiters of Senator, a premium restaurant in central Warsaw.

- Users (MVP): waiters (~20), shift managers (2–3), owner. One location; multi-location ready.
- Modules (MVP): login (login + 6-digit PIN), waiter home, training program, Service Book, library "Regulaminy i SOP" with read confirmation, menu catalog (kitchen + bar), tests, analytics, admin panel.
- Out of MVP: time tracking, host training, wine list, allergen tests, video.
- Approved spec: Claude Docs "Senator Academy — спецификация MVP" (Russian). Decision register D1–D27: `docs/REQUIREMENTS.md`.

## Status

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: project, Cloudflare config, schema, migrations, backups, docs | Done — production live on https://senator-academy.egor-sabich.workers.dev (2026-10-15), Workers Builds from `main`, migrations applied by `npm run deploy:cf` |
| 2 | Users & access | Done — 19/19 integration tests |
| 3 | Admin panel & content | Done — 34/34 integration, UI walkthrough |
| 4 | Menu catalog & import | Done — 55/55 integration, real import 81 items |
| 5 | Academy for waiters | Done — 73/73 integration; 66 materials ready as drafts (owner review) |
| 6 | Tests | Next |
| 7 | Analytics & assignments | — |
| 8 | Quality & launch | — |
