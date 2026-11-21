# Medoro: security audit

Scope: the repository at `fcf9a9c` plus this audit's changes, the production site `https://medoro.in` (non-destructive requests only) and a local production build. No brute force or write traffic was sent to production.

## Summary
| Area | Result |
|---|---|
| Tenant isolation, reads (existing suite: ~70 list/report paths, 6 by-id reads, both directions) | PASS |
| Tenant isolation, **writes** (new: 34 id-taking mutations and create paths with foreign ids, both directions, victim rows fingerprinted byte for byte, scan for rows linking both tenants, own-id control) | PASS: 33 refused by tenant checks, 1 correctly scoped (idempotency keys are per tenant), 0 victim rows changed, 0 cross-linked rows |
| Authentication: Argon2id, TOTP for owners/managers, lockout after 5 failures, recovery codes, trusted PC (E2E 02, INT lockout/auth) | PASS |
| Authorization: role and per-user permissions enforced on the server; "View as" only narrows (E2E 09, INT admin/ai) | PASS |
| Unauthenticated access to sensitive endpoints on production (23 probes) | PASS: all refused or harmless (table below) |
| Webhook verification: Razorpay HMAC; WhatsApp HMAC, never with an empty secret; cron HMAC/Bearer | PASS |
| Security headers on production: per-request nonce CSP with `strict-dynamic`, HSTS 2 years, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`, `nosniff` | PASS |
| Secrets in the repository (regex scan of all tracked files: AWS, Razorpay live, Google API, private keys, Slack, GitHub, Meta tokens, DB URLs with passwords) | PASS: none found; no `.env`/`.pem`/`.key` tracked |
| Dependencies (`pnpm audit`) | PASS: 0 high/critical; 1 moderate (minimatch ReDoS, dev-only via eslint) |
| AI safety: clinical questions refused before any model sees them | **FAIL → FIXED** (BUG-02): 18 of 20 got through; now 20/20 |
| Row-level security in PostgreSQL | NOT ENABLED (built and tested, `src/server/rls.ts`); isolation relies on the service layer. Recommendation below |

No critical or high vulnerability was found in the paths tested.

## 1. Tenant isolation (IDOR)
The app connects as one database role and scopes every query by `tenantId` in the service layer; RLS is not enabled. A static scan found 322 lookups by bare `id`, too many to clear by reading, so this was tested dynamically.

**Existing suite** (`tests/integration/tenant-isolation.test.ts`): two pharmacies with the same kinds of records; ~70 list/report readers and 6 by-id readers must never return the other pharmacy's marker or any of its primary keys. Passes.

**New suite** (`tests/integration/tenant-writes.test.ts`): pharmacy A calls these with pharmacy B's ids (and the reverse):
`voidSale, processReturn, updateMedicine, setBranchRack, adjustStock, writeOff, returnToSupplier, setQuarantine, requestTransfer (B's batch; A's batch into B's branch), saveSupplier, saveCustomer, paySupplier, receiveFromCustomer, commitSale (B's batch; B's customer; B's idempotency key), takeHeld, createPo (B's supplier; B's medicine), setPoStatus place/cancel, reverseVoucher, updateDoctor, createEstimate (B's medicine), setEstimateStatus, updateMember, issueReset, resetTwoStep, setUserPermission, togglePermission, saveBranch, addCounter, eraseCustomer, readSaleRx`.

Checks: (1) every row of every tenant-owned table of B is byte-for-byte unchanged (`row_to_json` fingerprint); (2) no row anywhere in the database contains ids of both pharmacies; (3) control: the same calls on A's own ids succeed or are refused by a named business rule, proving the probe input is valid. A negative control (a deliberate cross-tenant update) made the test fail, proving the detector works.

Result: refusals are "not found" from the tenant check for 33 calls; `commitSale` with B's idempotency key creates A's own new sale (keys are unique per tenant, so B's sale is not replayed to A; correct). `readSaleRx` returns null.

## 2. Production endpoint probes (unauthenticated, 20 Nov 2026)
| Request | Response | Verdict |
|---|---|---|
| GET /api/metrics | 404 | Hidden without `METRICS_TOKEN` |
| GET/POST /api/cron/tick | 403 | HMAC/Bearer required |
| POST /api/seed-demo | 404 "disabled" | Off in production |
| GET /api/export, /api/events, /api/statements/... | 401 | Session required |
| GET /api/backups/{id}, /api/billing/invoice/{id} | 403 | Refused |
| GET /api/documents/{id} | 404 | Refused |
| GET/POST /api/offline/snapshot, /sync | 401 | Session required |
| POST /api/razorpay/webhook (unsigned) | 401 "bad signature" | Verified |
| POST /api/wa/webhook `{}` | 200 "ok", nothing processed | Safe: payloads for a connected account need a valid HMAC; an empty app secret is never accepted (`src/domain/comms/whatsapp.ts:333`) |
| GET /api/wa/webhook (no verify token) | 403 | Verified |
| POST /api/license/checkin | 401 | Licence required |
| POST /api/setup/restore (no file) | 400 "Choose the backup file" | Reaches input validation in sign-up mode, but `noServerRestore()` refuses every restore on Vercel, and restore can only create a new pharmacy whose id, code and owner email are all unused (`src/domain/system/recovery.ts:113-124, 146`) |
| GET /app, /dist, /setup, /print/... | 307 → /signin | Session required |
| GET /staff | 307 → /staff/login | Separate staff auth |

## 3. Findings and recommendations
| Id | Severity | Finding | Status |
|---|---|---|---|
| SEC-1 (BUG-02) | HIGH (patient safety) | AI rule gate let dosage/frequency/patient/symptom questions through ("How many tablets of Dolo 650 can an adult take in a day?", "Is Pan-D safe with Dolo?", "बुखार के लिए कौन सी दवा दें?"). With a local or remote model configured they would reach the model, whose only guard was a system prompt. | FIXED: `isClinical()` in `src/domain/ai/planner.ts`; refusals are decided before any model call (`src/domain/ai/service.ts:170`); test `src/domain/ai/clinical-refusal.test.ts` |
| SEC-2 | MEDIUM (defence in depth) | RLS not enabled: one missed `tenantId` filter in a future change would leak data. The write and read suites now guard the main paths. | OPEN: recommendation: enable the RLS kit for hosted multi-tenant deployments (plan in `docs/MEDORO_2.md` §5), or at least run `tenant-isolation` and `tenant-writes` in CI (they already run with `pnpm test`) |
| SEC-3 (BUG-04) | LOW (accessibility) | Partner join email input's accessible name included the "Send code" button text | FIXED |
| SEC-4 | LOW | Tour page CSP blocks the prototype's inline handlers (console noise); the tour is sandboxed in an opaque origin with no cookies | FIXED (BUG-09): the template no longer has inline handlers; the CSP was not loosened |
| SEC-5 | LOW | 1 moderate dev-only advisory (minimatch via eslint) | FIXED: `pnpm audit` reports 0 advisories after the Next.js 16 / eslint-config-next 16 upgrade |
| SEC-6 | INFO | `/api/wa/webhook` answers 200 to unsigned payloads that match no account. Correct for Meta; listed so nobody "fixes" it into retries | – |

## 4. Areas reviewed and not changed
- **Sessions:** token-version revocation and step-up for sensitive actions are covered by INT auth-recovery and console-stepup; idle timeout is configured by `SESSION_IDLE_MINUTES`.
- **CSRF:** Origin checks on server actions and cookie-authenticated API posts (`src/server/csrf.ts`, unit tested).
- **Logging:** JSON logs with key-based redaction (`src/server/log.ts`, unit tested in `log.test.ts`). The individual log call sites were not all reviewed (NOT TESTED beyond the unit tests).
- **Audit trail:** hash-chained, append-only trigger, chain verification (E2E 09).
- **File uploads:** prescription attachments are restricted to a MIME allow-list (`ALLOWED` in `src/domain/sales/rx.ts`); size limits and other upload paths (imports, bank statements, backups) were not separately probed.

## 5. Not tested
- Live OAuth flows (Google, LinkedIn), live WhatsApp/Meta, live Razorpay: BLOCKED (credentials).
- A DAST scan (OWASP ZAP) and authenticated fuzzing of all 322 server actions: NOT TESTED in this pass.
- The production database itself (roles, grants, network exposure): NOT TESTED; no database access was used.
