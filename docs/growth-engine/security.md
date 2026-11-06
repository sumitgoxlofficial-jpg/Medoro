# Security

| Area | Implementation |
|---|---|
| Authentication | Existing staff sessions: Argon2id passwords, mandatory TOTP, 10-hour sessions, revocation on deactivation; httpOnly, SameSite=Strict cookie scoped to `/staff` |
| Authorisation | Growth role + permission checked in every service (`need`), lead visibility through `leadScope`; pages redirect, actions and API return errors. Tests cover sales/manager/analyst boundaries |
| Data isolation | No foreign keys or queries to pharmacy tables (static test), Growth tables excluded from pharmacy backup/restore, RLS on every table |
| Input validation | Zod schemas on every action and endpoint; phone/email/website/state/PIN normalisation; enum checks |
| SQL injection | Prisma queries; the few raw queries use tagged templates (parameters) |
| XSS | React escaping; no `dangerouslySetInnerHTML`; unsubscribe page escapes parameters to `[A-Za-z0-9._-]`; existing per-request nonce CSP |
| CSRF | Server actions: Next.js Origin check; JSON API: `rejectCrossSite` (Origin / Sec-Fetch-Site) on every non-GET; tested |
| SSRF | Website checks: http(s) on 80/443 only, no credentials in URLs, DNS resolved and every address checked against private, loopback, link-local, CGNAT and metadata ranges; the connection is pinned to the checked address (no second lookup, so no DNS rebinding) while TLS still verifies the hostname; redirects re-checked (max 3), 8 s timeout, 512 KB cap |
| Webhooks | Meta: HMAC-SHA256 with the app secret, constant-time compare; email events: HMAC with `GROWTH_EMAIL_WEBHOOK_SECRET`; unsubscribe: per-lead HMAC token, POST to act (link scanners can't unsubscribe) |
| Rate limits | API 600/10 min/person; dial launches 150/h; messages 60/10 min; exports 5/h; AI drafts 30/10 min |
| Secrets | WhatsApp token, app secret and verify token sealed with `HOST_KEY` (AES-256-GCM) in `IntegrationConnection`; never sent to the browser except the verify token admins must paste into Meta; never logged |
| CSV | Exports and error reports use the existing formula-injection guard (`'` prefix for `= + - @`) |
| Uploads | `.csv`/`.xlsx` only, 10 MB and 10,000 rows, parsed in memory by the existing parser, never stored as files; pending rows cleared after import |
| Audit | Append-only audit log and lead timeline (database triggers) |
| Idempotency | Call reports (`reportKey`), jobs (`idempotencyKey`), webhook messages (provider id), imports (progress counter per row), campaign sends (claimed before sending) |

## Findings during this work

* Fixed before merge: in-file duplicate rows were queued for insert with no record (caught by tests).
* Hardened after CodeQL flagged the PR: confirmation codes use `crypto.randomInt`; website checks connect to the vetted IP.
* The staff cookie path (`/staff`) is why the API is under `/staff/api/growth`; widening it was rejected.
* Self-approval of campaigns by a sole super admin is allowed but audited as such; add a second admin for four-eyes.
* Platform Drive for exports/backups is not implemented (no platform Drive credentials exist in Medoro today).
