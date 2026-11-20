# Medoro: production readiness

**Verdict: NOT YET SIGNED OFF.** The core product that could be tested here works and holds up under concurrency, isolation and accounting checks. Sign-off needs the blocked integration checks below run with test credentials, a short real-device pass, and a decision on the two open defects. Nothing here was deployed; no production data or configuration was changed.

## Quality gate (from the audit brief)
| Gate | Status | Evidence |
|---|---|---|
| All accessible pages tested | PASS | 80 live public pages × 2 viewports; every owner-navigation screen opened in e2e spec 15 |
| All implemented features tested | PARTIAL | 24 modules; integrations needing outside accounts are BLOCKED (below) |
| All critical bugs fixed | PASS | No critical defect found; the one HIGH (AI clinical refusal) is fixed |
| No critical security vulnerabilities outstanding | PASS | Tenant isolation for reads and writes, auth, webhooks, headers, secrets, dependencies (security audit) |
| Financial calculations verified | PASS | GST vs an independent formula; trial balance and ledger lines balance; CSV reports download |
| Stock calculations verified | PASS | Conservation (qty = Σ movements), FEFO, no oversell under 25-way contention, returns once |
| Authentication and permissions verified | PASS | e2e 02 and 09, integration suites |
| Offline synchronization verified | PASS (browser) / NOT TESTED (real devices) | e2e 13, 20, 21; integration `offline.test.ts` |
| Backup restoration verified | PASS (fake Drive) / BLOCKED (real Google Drive) | e2e 11, 19, 25; integration backup/restore |
| Subscription lifecycle verified | PARTIAL | Trial → banner → grace → read-only (e2e 17), plan limits (integration); real Razorpay payment BLOCKED |
| All regression tests passed | PARTIAL | Vitest 1,189/1,189; e2e 72 passed + 3 that pass with the email sink; live-update spec 30/30 after the BUG-08 fix; spec 31's supplier link fails ~1 in 3 (BUG-10, open, also without the fix). Bug log: final regression run |
| Production deployment configuration reviewed | PASS | `vercel.json` (bom1, cron), `scripts/vercel-build.sh` (migrations on production only, previews isolated), startup refuses pending migrations, `/api/ready` ok on production |

## Open issues
| Id | Severity | Issue | Recommended action |
|---|---|---|---|
| BUG-10 | MEDIUM | A link click occasionally doesn't navigate (~1 in 3 on Intelligence → Supplier intelligence; the second click works). Same router symptom that BUG-08 worked around | Reproduce in a minimal Next.js app; try the current Next.js release |
| SEC-2 / DB-3 | MEDIUM | RLS not enabled; isolation depends on the service layer | Enable the existing RLS kit for hosted multi-tenant servers |
| DB-2 | LOW | Few foreign keys (55/198 tables) | Orphan check on production, then add FKs `NOT VALID` → `VALIDATE` |
| BUG-09 | LOW | Tour CSP console noise | Fix the prototype runtime's inline handlers |
| SEC-5 | LOW | 1 moderate dev-only advisory | Routine dependency update |
| SEO | LOW | `/partners`, `/legal` lack a canonical URL; `/signin` has no H1 | Small markup changes |

## BLOCKED: what is needed to finish
| Integration | What to provide | What to run |
|---|---|---|
| WhatsApp Cloud API | Meta app (`WA_APP_ID`, `WA_APP_SECRET`, `WA_CONFIG_ID`), a WABA test number and an authorised recipient | Connect in WhatsApp settings; send an invoice; watch sent → delivered → read via the signed webhook; send STOP; revoke the token and confirm the "disconnected" state |
| Google Drive backup | Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID/SECRET`, redirect URI) and a test Google account | Connect; daily backup; verify; restore a test copy; expire/revoke the token; disconnect; confirm on Google's consent screen that only `drive.file` and `drive.appdata` are requested (the only Drive scopes in the code: files the app created, plus its hidden app folder, never the user's other files) |
| Razorpay | Test keys `rzp_test_…`, webhook secret, webhook pointed at a test deployment | Pay a plan (success), cancel in Checkout, failing card, duplicate webhook delivery, upgrade/downgrade, cancellation |
| SMS OTP | MSG91/Twilio test credentials with DLT templates | Mobile OTP sign-in and SMS fallback |
| E-invoice / e-way bill | NIC sandbox or GSP credentials (`EINVOICE_*`) | IRN generation, cancel within 24 h, e-way bill |
| Local / remote AI model | Ollama endpoint or OpenAI-compatible endpoint | AI answers through a model (rule mode was tested) |
| Devices and browsers | Windows 10/11 PCs, an Android phone, an iPhone, Safari/Firefox/Edge | Billing, printing (thermal/A4), offline billing and install as an app |
| Desktop app | Rust toolchain or the "Desktop app" GitHub workflow | Build installers and open a server URL |

## Changes made by this audit (branch `claude/epic-maxwell-7g2m74`)
Code: `src/domain/ai/planner.ts` (clinical refusal), `src/app/globals.css` (dialog containment), `src/app/(auth)/distributor-signup/page.tsx` (sign-up dead end), `src/app/staff/login/form.tsx` (accessible name), `src/app/portal/(public)/register/page.tsx` (links), `prisma/schema.prisma` + migration `20261215000000_hot_path_indexes` (indexes), `README.md` (trial length).
Tests: `tests/integration/tenant-writes.test.ts`, `tests/integration/audit-stress.test.ts`, `src/domain/ai/clinical-refusal.test.ts`, `src/data/internal-links.test.ts`, `e2e/33-signup-email.spec.ts`.
Deploying: merge, and Vercel's production build applies the index migration (additive only).
