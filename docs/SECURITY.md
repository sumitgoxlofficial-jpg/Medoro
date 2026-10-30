# Security

## Identity
- Sign-in: mobile OTP (rate-limited, 6 digits, 5-minute expiry, 5 attempts) or email plus password (Argon2id, at least 10 characters, breach-list check).
- MFA with TOTP is **required** for Owner and Manager and optional for others. There are recovery codes.
- Sessions: httpOnly, Secure, SameSite=Lax cookies. Server-side session table; `token_version` lets one action revoke every session. Idle timeout 12 h on counters, 2 h for admin screens.
- Login lockout: 5 failures → 15-minute cooldown per account; 50 failures from one IP → 15-minute IP throttle. Proxy headers are only trusted on Vercel or with `TRUST_PROXY=1`.
- **No default credentials.** The setup wizard creates the owner.

## Authorisation
- Permission keys (sale, disc, credit, refund, adjust, purchase, payments, reports, users, integrations, aiAct), assigned per role and overridable per user.
- Every service call runs through `authorize(ctx, perm)`, and every query carries the caller's `tenantId` (and branch where relevant) from the server-side session, never from the client.

## Tenant isolation
- **Enforced in the service layer.** The app connects to PostgreSQL as one role (the table owner) and scopes each query by `tenantId`.
- **Tested automatically.** `tests/integration/tenant-isolation.test.ts` creates two pharmacies with the same kinds of records (suppliers, customers, medicines, batches, sales, vouchers, held carts) and calls every list, report and export read path as each one (48 readers, including all ten CSV reports and the full data export), failing if the output contains any primary key owned by the other pharmacy (collected from every table with a `tenantId` column) or its marker names. By-id reads (medicine, invoice, returnable lines, held cart, party statements) given the other pharmacy's ids must refuse or return nothing. Add new read services to that list.
- **Row-level security, truthfully.** RLS is enabled on every table with **no policies** and no grants for Supabase's `anon`/`authenticated` roles (`lock_data_api` migration). That closes hosted REST/GraphQL data APIs, but the app's owner role bypasses RLS, so RLS is *not* a second tenant boundary inside the app.
- **Why not per-tenant RLS policies yet.** Policies keyed on `current_setting('app.tenant_id')` would need the app to run as a non-owner role and set the tenant on every connection inside every transaction. Several paths are legitimately cross-tenant (sign-in before the tenant is known, the scheduler and backups across pharmacies, the staff console, setup, metrics), and services use interactive transactions with advisory locks; wrapping each query through a Prisma extension changes their transaction semantics. Until those paths get an explicit "system" role, the isolation suite above is the guard.

## Input & output
- Zod validation at every boundary. Prisma uses parameterised queries.
- CSRF: session cookies are `SameSite=Lax`. Every mutation in the app is a Next.js server action, and Next.js rejects server-action requests whose `Origin` doesn't match the `Host`/`X-Forwarded-Host` (extra hosts via `ALLOWED_ORIGINS`). Cookie-authenticated `POST` route handlers (`/api/offline/sync`) also check `Origin` and `Sec-Fetch-Site` (`src/server/csrf.ts`) and answer 403 to other sites. Webhooks (`/api/wa/webhook`: Meta signature), cron (`/api/cron/tick`: HMAC/`CRON_SECRET`) and `/api/seed-demo` (`SETUP_TOKEN`) authenticate themselves and take no cookies.
- XSS: React escaping and a per-request nonce CSP set in `src/middleware.ts`: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no inline scripts without the nonce, no `eval` outside development), `object-src 'none'`, `base-uri 'self'`, `form-action 'self' https://accounts.google.com` (Drive sign-in), `connect-src 'self'` (WhatsApp/Meta Graph and Google APIs are only called from the server), `frame-ancestors 'none'` (scanned-invoice previews under `/api/documents/` allow `'self'`). Inline `style` attributes are allowed (`style-src 'unsafe-inline'`). Every page renders per request so Next.js can stamp the nonce.
- Headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera for barcode scanning only), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, and HSTS (2 years) on HTTPS requests (`DISABLE_HSTS=1` to turn off while testing certificates).
- Concurrent edits: medicines, suppliers and customers carry a `version`; a save based on an older version is refused with "Someone else changed this …".
- Rate limiting (`src/server/ratelimit.ts`, PostgreSQL fixed windows, atomic across app servers), per user: AI questions 30/10 min, hand-sent WhatsApp messages 60/10 min, campaign starts 5/h, full exports 3/h, report and statement CSVs 60/10 min, backup downloads 10/h, document downloads 300/10 min. Over the limit, actions show "Too many … Try again in N minutes" and downloads answer 429 with `Retry-After`. Sign-in has its own lockout (above); `otpSend`/`forgot` rules are ready for the sign-in screens.

## Data protection
- TLS 1.2+ everywhere, including app-to-DB.
- At rest: full-disk encryption recommended on the DB host. Integration tokens are encrypted with libsodium sealed boxes under a host key held in the OS keystore.
- Backups: AES-256-GCM with a random data key per backup, wrapped by the customer key (see BACKUP_AND_RECOVERY.md).
- Logs: `src/server/log.ts` writes JSON lines and replaces values under sensitive keys (password, token, secret, otp, code, authorization, cookie, phone, mobile, email, keys, signatures) with `[redacted]` at any depth. Server code logs ids and counts, not invoice contents. `/api/ready` and `/api/metrics` never include connection strings or secret values.

## Audit
Append-only `audit_events`, hash-chained (each row stores the SHA-256 of the previous one). It covers auth, permission changes, discounts, voids, refunds, adjustments, exports, AI confirmations and integration changes.

## Supply chain & CI
Lockfile pinned (`--frozen-lockfile`). CI (`.github/workflows/ci.yml`): lint, typecheck, unit and integration tests against PostgreSQL 16, production build, gitleaks, `pnpm audit --audit-level=high`, a CycloneDX SBOM for the app and the desktop shell uploaded as the `sbom-cyclonedx` artifact, and a Docker job that builds the image, boots the compose stack and waits for `/api/ready`. CodeQL (`codeql.yml`, javascript-typescript, security-extended) runs on pushes, PRs and weekly. Dependabot (`.github/dependabot.yml`) watches npm (root and `desktop/`), Cargo (`desktop/src-tauri`), GitHub Actions and the Docker base image. Desktop release builds are signed when the signing secrets are configured.

## Incident response
1. Detect (alerts, anomaly review, user report) → 2. Contain (revoke sessions and tokens, disable the integration) → 3. Assess scope from audit events → 4. Notify the owner, and CERT-In within 6 hours where applicable, after legal review → 5. Recover from a verified backup → 6. Post-mortem.

## Threat model highlights
| Threat | Control |
|---|---|
| Cross-tenant read | Tenant-scoped services + two-tenant isolation test suite (RLS only blocks hosted data APIs) |
| Cashier discount or void fraud | Permission caps, manager approval, anomaly rules |
| Stolen counter PC | Session revoke, device deregistration, MFA for privileged roles |
| AI prompt injection via OCR | Data-as-quotes, tool allow-list, confirmation for writes |
| Backup theft | Client-side encryption, key never stored with backups |
| Token leakage | Server vault, never sent to the client, rotation |
