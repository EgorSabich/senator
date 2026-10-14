# Security

| Measure | Status |
| --- | --- |
| HTTPS only (Cloudflare), HSTS | Stage 1 — header set |
| noindex: `X-Robots-Tag` on API and static files, `robots.txt` Disallow all, `<meta robots>` | Stage 1 — verified by smoke test |
| `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Stage 1 |
| API responses `Cache-Control: no-store` | Stage 1 |
| Secrets only in Cloudflare variables, `.dev.vars` git-ignored | Stage 1 |
| Nightly backup to separate R2 bucket, 30-day retention, tested restore | Stage 1 — verified locally |
| Anonymization 2 years after deactivation; login attempts deleted after 90 days | Stage 1 — verified locally |
| Login + PIN (PBKDF2, salt), lockout 5 attempts / 15 min, IP limit 20 / 15 min | Stage 2 |
| Session cookie HttpOnly/Secure/SameSite=Lax, hashed token, 30 / 7 days | Stage 2 |
| CSRF: Origin check on state-changing requests | Stage 2 |
| Permission + location check on every request; isolation tests | Stage 2 |
| Audit log of admin actions | Stage 2–3 |
| Private photos via authenticated route | Stage 3 |

Noindex is not protection: real protection is authentication and server-side checks.
