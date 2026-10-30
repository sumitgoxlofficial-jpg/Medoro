# Security

## Identity
- Sign-in: mobile OTP (rate-limited, 6 digits, 5-minute expiry, 5 attempts), email plus password (Argon2id, at least 10 characters), or "Continue with Google" for owners and managers who have connected Google. Counter staff use pharmacy code + employee ID + PIN.
- MFA with TOTP is **required** for Owner and Manager and optional for others, whichever way they sign in (Google too). Enrolment issues 10 one-time recovery codes (80 bits each, stored as SHA-256 hashes, shown once; regenerate from Profile).
- Sessions: httpOnly, Secure, SameSite=Lax cookies. Server-side session table; `token_version` lets one action revoke every session. Owner and manager sessions end after `SESSION_IDLE_MINUTES` (default 120) without activity; counter sessions last the 12 h shift. Activity is recorded at most once a minute.
- Login lockout: 5 failures → 15-minute cooldown per account; 50 failures from one IP within a sliding 15-minute window → 15-minute IP throttle. "Attempts left" messages always count the account, never the shared shop IP. Proxy headers are only trusted on Vercel or with `TRUST_PROXY=1`.
- Code sends (SMS and email) are limited to 5 per phone/email and 20 per client IP per 15 minutes, checked before the account lookup.
- **No default credentials.** The setup wizard creates the owner, who always has a password; Google can be connected afterwards from Profile.

### Account recovery
- **Forgot password** (sign-in screen): email or mobile → a 6-digit code by email or SMS, single use, 15-minute expiry, 5 attempts, hashed at rest. The screen answers the same whether or not the account exists. A reset sets a new password, bumps `token_version` (every session and trusted PC is signed out) and is audited. Works for the owner.
- **Lost authenticator** (MFA step): a recovery code signs in once. Or, only when this sign-in started with the account **password**, a 6-digit code sent to the email (or mobile) on the account clears the authenticator so a new one is enrolled at once, signing out every other session. Sessions that started with Google or a mobile OTP can't use it (the code would go to the inbox or phone that sign-in already proved), and it is held back for 24 hours after a forgot-password reset or after any Google / mobile-OTP sign-in to the account, so someone who takes over an inbox or a SIM can't remove both factors; recovery codes and an owner/manager reset still work. Each session records its first factor (`password`, `google`, `otp`, `pin`).
- Google and mobile-OTP sign-ins always go to the MFA step for owners and managers. The only skip is a "trusted PC" cookie, which is issued only after a successful authenticator or recovery code, is HMAC-signed and bound to the user and their `token_version` (so a password or PIN change, a forgot-password reset, a two-step reset or a reset from Users voids it).
- **Reset two-step for someone else** (Users, needs the "users" permission): clears another user's authenticator and recovery codes and signs them out; they enrol again at next sign-in. Nobody can reset their own this way, and the owner's can only be reset by the owner (recovery code or email/SMS code).
- **Profile**: change your own password or PIN (current one required, 5 tries then a 15-minute lock; bumps `token_version`, so other devices and trusted PCs are signed out while this session stays in), connect or disconnect Google, regenerate recovery codes.
- Manager password and staff PIN resets from Users still use a 48-hour reset code entered on the join screen.

### Google sign-in
- OpenID Connect authorization code flow with PKCE (S256), `state` and `nonce`, all bound to the browser in a sealed, httpOnly, 10-minute cookie scoped to `/api/auth/google`. The code is exchanged server-side with the client secret and the exact redirect URI from the environment.
- The ID token is verified locally: RS256 signature against Google's JWKS (cached by `kid`, refreshed on rotation), issuer, audience, expiry, nonce and `email_verified`.
- Only an account that already connected this Google subject signs in, and it still goes through the MFA step. A first Google sign-in whose verified email matches exactly one active password account is never linked by email alone: the person must enter that account's password, which completes the link. Deactivated or locked accounts are refused. Link, unlink and sign-ins are audited.

## Authorisation
- Permission keys (sale, disc, credit, refund, adjust, purchase, payments, reports, users, integrations, aiAct), assigned per role and overridable per user: the owner or a user manager can allow or withhold single permissions for one person on top of their role (Users → shield icon). Effective permissions = role ∪ grants − revokes, computed on every request; only the owner can grant `users` or `integrations`; the owner's own permissions are locked; every change is audited. "View as" still only narrows.
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

## Sign-in providers
Each provider is optional. Unconfigured ones are hidden: no Google button without the Google client, no "Mobile OTP" or SMS recovery without `OTP_PROVIDER`, no email recovery without `MAIL_PROVIDER`. At startup in production, a half-configured provider or a `console` provider stops the server with a message naming the missing variable. Provider failures show "Couldn't send the code, try again" and log only the provider and HTTP status, never the code or a token.

### Google (sign-in and Drive backups)
One OAuth client serves both. In the [Google Cloud console](https://console.cloud.google.com/):
1. Create or pick a project. **APIs & Services → Library**: enable **Google Drive API** (for backups; sign-in needs no API).
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience): user type **External**, app name "Medoro – <pharmacy>", support email, your domain under **Authorised domains**, developer contact. **Data access/Scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file`. While the app is in **Testing**, add the owner's and managers' Google accounts as test users; **Publish** it for general use (`drive.file` is not a restricted scope).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorised redirect URIs** add both, exactly (scheme, host, no trailing slash):
   - `https://<your host>/api/auth/google/callback` (sign-in)
   - `https://<your host>/api/integrations/google/callback` (Drive backups)
   No JavaScript origins are needed: the code is exchanged on the server.
4. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APP_URL=https://<your host>` (the sign-in redirect defaults to `${APP_URL}/api/auth/google/callback`; set `GOOGLE_LOGIN_REDIRECT_URI` only if it differs) and `GOOGLE_OAUTH_REDIRECT_URI` for Drive. Restart.
5. Each owner/manager connects Google once: **Profile → Google sign-in → Connect Google**, or click "Continue with Google" on the sign-in screen and confirm with their Medoro password.

### SMS (`OTP_PROVIDER`)
Indian numbers are sent in E.164 (`+91XXXXXXXXXX`).
- **msg91** (recommended in India): in MSG91, register your sender ID and an OTP template on the DLT portal, then create a **Flow** template using that DLT template whose text contains `##otp##` (optionally `##minutes##`), e.g. "##otp## is your Medoro code. It expires in ##minutes## minutes. -MEDORO". Set `OTP_PROVIDER=msg91`, `OTP_API_KEY` (MSG91 → API → Auth key), `OTP_TEMPLATE_ID` (the Flow template id) and optionally `OTP_SENDER`. Medoro calls `POST https://control.msg91.com/api/v5/flow`.
- **twilio**: set `OTP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (an SMS-capable number in E.164, or a Messaging Service SID starting `MG`). For India, Twilio also needs DLT registration of the sender and template. Medoro calls the Messages API with its own code (Twilio Verify is not used, so codes stay hashed in your database).
- **http**: your own gateway. Set `OTP_PROVIDER=http`, `OTP_HTTP_URL` (HTTPS) and `OTP_HTTP_TOKEN`. Medoro sends `POST {"phone":"+91…","code":"123456","purpose":"signin|invite|reset|mfa-reset","text":"…"}` with `Authorization: Bearer <token>`; answer 2xx once the SMS is accepted.
- **console**: development only; prints codes to the server log. Refused when `NODE_ENV=production`.

### Email (`MAIL_PROVIDER`)
Set `MAIL_FROM` (e.g. `Medoro <no-reply@pharmacy.example.in>`) on a domain verified with the provider (SPF and DKIM records), then one of:
- **resend**: `RESEND_API_KEY` (Resend → API Keys, "Sending access").
- **sendgrid**: `SENDGRID_API_KEY` with "Mail Send" permission; verify the sender domain under Sender Authentication.
- **http** (alias **smtp-http**): your own relay, e.g. a small service in front of your SMTP server. `MAIL_HTTP_URL` (HTTPS) receives `POST {"from","to","subject","text"}` with `Authorization: Bearer <MAIL_HTTP_TOKEN>`.
- **console**: development only; prints messages to the server log.
