# Senator Academy

Internal training platform for Senator restaurant staff (Warsaw). UI is Polish only.
Stack: Cloudflare Workers (Hono API + React/Vite), D1, R2.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:5173
npm test               # unit tests
./scripts/smoke-local.sh   # health, headers, backup + restore, anonymization on local workerd
```

Docs: [overview](docs/PROJECT_OVERVIEW.md) · [requirements](docs/REQUIREMENTS.md) · [architecture](docs/ARCHITECTURE.md) ·
[data model](docs/DATA_MODEL.md) · [security](docs/SECURITY.md) · [deployment](docs/DEPLOYMENT.md) ·
[testing](docs/TESTING.md) · [changelog](docs/CHANGELOG.md)
