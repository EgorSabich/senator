# Security

| Measure | Status |
| --- | --- |
| HTTPS only (Cloudflare), HSTS | Stage 1 — header set |
| noindex: `X-Robots-Tag` on API and static files, `robots.txt` Disallow all, `<meta robots>` | Stage 1 — verified by smoke test |
| `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Stage 1 |
| API responses `Cache-Control: no-store` | Stage 1 |
| Secrets only in Cloudflare variables, `.dev.vars` git-ignored | Stage 1 |
| Nightly backup to separate R2 bucket, 30-day retention, tested restore | Stage 1 — verified locally |
| Permanent deletion (D34): only deactivated / archived records, typed confirmation, one D1 batch, audit entry without personal data; backups keep the data until they expire (30 days) | 0.5.1 — tested (06-delete, UI walkthrough) |
| Anonymization 2 years after deactivation; login attempts deleted after 90 days | Stage 1 — verified locally |
| Login + 6-digit PIN (staff) / 10+ char password (managers, owner) | Stage 2 — done |
| Hash: HMAC-SHA256 with server secret `AUTH_SECRET`, then PBKDF2-SHA256 100 000 iterations, per-user salt | Stage 2 — done |
| PIN rules: no repeats, no runs (123456, 654321, wrap-around), no frequent PINs; checked on server and client | Stage 2 — done |
| Temporary PIN/password from admin, must be changed at first login; all other API calls answer `must_change_secret` until then | Stage 2 — done |
| One error for unknown login and wrong PIN; same lock behaviour for unknown logins (no account enumeration); constant-cost hashing | Stage 2 — done |
| Lockout after 5 failures: 15 min, doubling on repeat locks (max 24 h); manager/owner can unlock | Stage 2 — done |
| IP limit: 20 failed logins / 15 min; IPs stored only as HMAC | Stage 2 — done |
| Session: random 256-bit token, only SHA-256 stored; cookie HttpOnly + Secure + SameSite=Lax; 30 days (staff), 7 days (managers/owner), sliding | Stage 2 — done |
| Password/PIN change or reset, deactivation → other sessions revoked immediately | Stage 2 — done |
| CSRF: every non-GET API call must carry our own Origin | Stage 2 — done |
| Access layer: location + permission checked on every request; foreign locations/users answer 404 | Stage 2 — done |
| Managers can never act on the owner or other managers | Stage 2 — done |
| Audit log of admin actions, never containing secrets | Stage 2 — done |
| Private photos via authenticated route | Stage 3 |
| Punch photos (D40): off by default, camera allowed only for the app origin (`camera=(self)`), 240 px JPEG, private R2, readable only with `time.manage`, deleted after 60 days and with the person; staff informed in Konto | 0.6.4 |

Known accepted risk: someone who knows a login can lock that account for 15 minutes (no data is revealed; a manager can unlock).

Noindex is not protection: real protection is authentication and server-side checks.
