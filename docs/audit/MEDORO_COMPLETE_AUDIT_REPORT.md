# Medoro: complete audit report

Audit date: 20–21 November 2026 · Branch `claude/epic-maxwell-7g2m74` · Base commit `fcf9a9c`

This is the summary and the architecture document. Detailed evidence is in the other seven reports in this folder:

| Report | Contents |
|---|---|
| [MEDORO_PAGE_BY_PAGE_TEST_REPORT.md](MEDORO_PAGE_BY_PAGE_TEST_REPORT.md) | All 80 live public pages, desktop and phone, with load times, console errors, links and SEO |
| [MEDORO_FEATURE_TEST_REPORT.md](MEDORO_FEATURE_TEST_REPORT.md) | Every module: test case, expected, actual, status, defect, fix, retest |
| [MEDORO_SECURITY_AUDIT.md](MEDORO_SECURITY_AUDIT.md) | Tenant isolation (reads and writes), auth, endpoints, headers, secrets, dependencies |
| [MEDORO_PERFORMANCE_REPORT.md](MEDORO_PERFORMANCE_REPORT.md) | Live Web Vitals, query plans before/after, concurrency |
| [MEDORO_DATABASE_AUDIT.md](MEDORO_DATABASE_AUDIT.md) | Schema, constraints, indexes, triggers, migrations, transactions, stock and ledger invariants |
| [MEDORO_BUG_FIX_LOG.md](MEDORO_BUG_FIX_LOG.md) | Every defect: reproduction, root cause, fix, regression test, retest |
| [MEDORO_PRODUCTION_READINESS.md](MEDORO_PRODUCTION_READINESS.md) | Quality gate, blocked items, what is needed before declaring ready |
| [evidence/](evidence/README.md) | Raw test logs, live crawl data, query plans, screenshot |

## 1. How the audit was done

Everything below was run, not read off the code:

- **Unit + integration:** the full Vitest suite against a real PostgreSQL 16 (no mocks for the database), before and after the fixes.
- **End-to-end:** the full Playwright suite (not only CI's subset) against a production build (`next build` + `next start`), real browser, freshly migrated database. Run twice per environment: once like CI (no email), once with email delivered to a local HTTPS mail sink.
- **Live website:** a Playwright crawler over `https://medoro.in` (sitemap plus every internal link found), at 1366×800 and 375×740, recording HTTP status, console errors, failed requests, broken images, horizontal overflow, title/description/H1/canonical and accessibility basics. All 85 links found were requested.
- **Live security probes:** unauthenticated requests to 23 sensitive endpoints on `medoro.in` (no brute force, no writes).
- **Live performance:** Web Vitals (TTFB, FCP, LCP, CLS) for six pages, desktop and Pixel 7, median of three loads.
- **New tests written for this audit** (all kept in the repository and passing):
  - `tests/integration/tenant-writes.test.ts`: 34 mutations called with another pharmacy's ids, in both directions, with a byte-for-byte fingerprint of the victim's rows and a scan for rows linking both pharmacies; plus a control proving the probes are valid input.
  - `tests/integration/audit-stress.test.ts`: 25 concurrent sales on 10 units, opposite lock orders, stock-vs-movement conservation, concurrent returns, GST against an independent calculation, trial balance.
  - `src/domain/ai/clinical-refusal.test.ts`: 20 clinical questions (English, Hinglish, Hindi) refused; 33 business questions answered.
  - `src/data/internal-links.test.ts`: every static internal link in the source resolves to a real route or file.
  - `e2e/33-signup-email.spec.ts`: email-confirmed sign-up (the production path) and the setup-token path.
- **Query plans:** `EXPLAIN ANALYZE` on 400,000–600,000 synthetic rows before and after the index migration.

What could not be run is listed as BLOCKED with the reason; nothing was marked PASS from reading code alone.

## 2. Applications discovered

All of them are one Next.js 15 codebase on one PostgreSQL database, verified in the code (not assumed from the website):

| # | Application | Entry | What it is | Tested |
|---|---|---|---|---|
| 1 | Public website | `/`, `/legal`, `/features/*`, `/blog/*`, `/pharmacy-software-in-*`, `/tools/*`, `/careers`, `/partners`, `/start`, `/trial` | Marketing, pricing, legal, SEO landing pages, free tools, careers, trial sign-up | Live crawl (80 pages) + e2e spec 15 |
| 2 | Pharmacy owner/admin app | `/app/*` (42 screens) | Dashboard, POS, inventory, purchases, accounts, GST, parties, users, backup, privacy, AI | e2e specs 02–14, 17, 31 + integration suite |
| 3 | Pharmacy staff / counter sign-in | `/signin?view=employee` → `/app` with a role | Same app; counter staff sign in with pharmacy code + employee ID + PIN + counter; roles narrow the menus and the server actions | e2e 02 (cashier, accountant), 09 (roles, View as), integration permission tests |
| 4 | Device / Drive-mode counter and offline PWA | `/app/device-pos`, `/device`, `/offline`, service worker | Counter that keeps its own SQLite (WASM) database synced through the pharmacy's Google Drive; offline billing | e2e 13, 17-device, 18–28, 32 (fake Drive) |
| 5 | Medoro Distribution ERP | `/dist/*` (33 screens), `/distributor-signup` | Wholesale ERP for distributors | e2e `dist/distribution.dist.ts` + integration `dist-*` |
| 6 | Chemist portal | `/portal/*` (7 screens) | Chemists order from distributors | e2e dist spec (register → connect → order) |
| 7 | Medoro staff console + licence server | `/staff/*` (40 screens), `/api/license/*` | Medoro's own sales, partners, payouts, tickets, licences, growth/prospecting | e2e 16, 29 + integration |
| 8 | Medoro HRMS | `/staff/employee`, `/staff/hrms/*` | Medoro's own employees: attendance, leave, payroll | e2e 30 + integration `hrms-*` |
| 9 | Desktop app | `desktop/` (Tauri) | A window that opens a Medoro server URL; stores only the address | Not built here (needs the Rust toolchain; built by the "Desktop app" GitHub workflow): NOT TESTED |
| – | Backend + database | `src/domain`, `src/server`, `src/staff`, 41 API routes, 322 server actions, PostgreSQL | Shared by all of the above | Integration suite + DB audit |

There is no separate "super-admin of pharmacies" UI: Medoro's platform administration is the staff console (7), which by design has no access to pharmacy records.

## 3. Architecture

```
Browser / PWA / Tauri ──HTTPS──▶ Next.js 15 (App Router, React 19)
                                   ├─ 167 pages (server components)          src/app
                                   ├─ 322 server actions (Origin-checked)     src/app/**/actions.ts
                                   ├─ 41 API route handlers                   src/app/api
                                   ├─ Domain services (Zod contracts)         src/domain/* (22.5k lines)
                                   ├─ Staff console / licence / HRMS          src/staff
                                   ├─ Device database (SQLite WASM, Drive)    src/drivedb
                                   └─ Scheduler (/api/cron/tick, HMAC/Bearer)
                                          │ Prisma 6 (+ raw SQL for locks/reports)
                                   PostgreSQL 16: 198 tables, 462 indexes, 55 FKs, 64 triggers
                                          │ LISTEN/NOTIFY → SSE /api/events (live screens)
Outbound (opt-in): Meta WhatsApp Cloud API · Google Drive/OAuth · Razorpay · MSG91/Twilio · Resend/SendGrid ·
                   NIC IRP / GSP · Ollama / OpenAI-compatible AI · Medoro licence server (Ed25519-signed licences)
```

- **Hosting (production):** Vercel, region `bom1` (Mumbai), daily cron at 21:30 UTC; database migrations run in the Vercel build over `DIRECT_URL` (production only; previews migrate only a database marked `PREVIEW_DATABASE=1`). The app refuses to start with pending migrations (observed during this audit).
- **Money:** integer paise (BIGINT). GST is back-calculated from MRP-inclusive prices per line; CGST/SGST are split once on the bill's total tax.
- **Tenant isolation:** every query is scoped by `tenantId` in the service layer. Row-level security is built and tested (`src/server/rls.ts`) but **not enabled** in production.
- **Immutability:** append-only triggers on sales, payments, ledger lines, GRNs, audit events and the distribution documents.
- **Concurrency:** sale commit in one transaction with `SELECT … FOR UPDATE` on batches and the invoice sequence row; idempotency key per tenant.

Full module and route inventory: section 5.

## 4. Results in numbers

| Measure | Result |
|---|---|
| Pages discovered (page routes in code) | 167 (+ dynamic instances: blog, careers, compare, features, locations) |
| Live public pages crawled and tested | 80 (78 HTTP 200; 2 were broken link targets) at 2 viewports = 160 page loads; 85 links requested |
| Applications discovered | 9 (+ backend/database) |
| Modules tested | 24 (see feature report) |
| Unit + integration tests | Before: 1,177 in 185 files, all pass. After: 1,189 in 189 files, all pass |
| End-to-end tests (browser) | 75 in the full suite (73 + 2 new): 72 pass in the CI configuration, the other 3 pass with email configured; plus 10 repetitions of the live-update spec (7/10) |
| Live security probes | 23 endpoints, all refused or safe |
| Bugs found | 9 defects (1 HIGH, 4 MEDIUM, 4 LOW) + 1 test-coverage gap (see bug log) |
| Bugs fixed and retested | 7 fixed and retested, gap closed with a new spec; 2 open (1 MEDIUM, 1 LOW), each documented with evidence |
| Critical/high security vulnerabilities found | 0 in the code paths tested; the AI clinical-refusal gap (HIGH, patient safety) is fixed |

## 5. Inventory

### Routes
- Website: 33 page files (dynamic: `blog/[slug]`, `careers/[slug]`, `compare/[slug]`, `features/[slug]`, `solutions/[niche]`, `pharmacy-software-in/[location]`).
- Auth: `/setup`, `/signin`, `/signin/mfa`, `/signup`, `/distributor-signup`, `/pay`.
- Pharmacy app `/app`: accounts, attendance, backup, bank, cheques, compliance, count, deliveries, device-pos, doctors, estimates, expiry, health, help, intelligence (benchmark, customers, forecast, profit, suppliers), inventory (+catalogue), lab, messaging, money, orders, owner (+reports), parties (+statements), plan, pos, privacy, purchases, recalls (+report), returns, sync, users, whatsapp.
- Distribution `/dist`: 33 screens. Portal `/portal`: 7. Staff console `/staff`: 40 (incl. 22 growth screens). Print: invoice, credit note, estimate, PO, statement, labels.
- API (41): auth/google, backups, billing invoice, careers/linkedin, compliance documents, cron tick, dist gst/report, documents, drivedb, events (SSE), export, growth email/unsubscribe/whatsapp webhook, gst, health, Google integrations, licence checkin/register/ticket, metrics, offline snapshot/sync, order/sale prescriptions, Razorpay pay/webhook, ready, report-mail unsubscribe, reports, seed-demo, setup restore, SMS inbound, statements, WhatsApp invoice link and webhook.

### Database
198 tables (197 Prisma models + migrations table), 14 enums, 80 migrations (79 existing + 1 added by this audit). Detail in the database audit.

### Third-party integrations (real code paths, each off until credentials are set)
WhatsApp Cloud API (Embedded Signup, signed webhooks) and a built-in WhatsApp Web link (Baileys); Google OAuth sign-in, Google Drive (backups and device databases), Google Calendar (HRMS); Razorpay (subscriptions, customer payment links, payouts); MSG91 / Twilio / HTTP SMS and OTP; Resend / SendGrid / HTTP email; NIC IRP or GSP e-invoice and e-way bill; Ollama or OpenAI-compatible AI; remote OCR; OpenStreetMap (growth discovery); LinkedIn (careers).

### Placeholder / not-claimed functionality found
- Bank APIs, Account Aggregator, PhonePe/Paytm/BharatPe are listed in the app with an explicit "partner onboarding required / not supported" status (honest, not simulated).
- Legal text is marked as a draft for lawyer review (README).
- The homepage "live tour" is a sandboxed copy of the design prototype with sample data (stated on the page).
- No dummy success responses were found for payments, WhatsApp or Drive: without credentials the screens say "not connected", and the integration-health screen never shows Active for an untested service (e2e 31 checks this).

## 6. Final regression results

On the final code: lint and typecheck clean; **Vitest 1,189/1,189 passed**; production build succeeded; **Playwright 72 passed / 2 skipped / 1 failed** in the CI configuration, where the failure and skips need the email sink and pass with it; live-update spec 7/10 (BUG-08, open). Details: [bug log, final regression run](MEDORO_BUG_FIX_LOG.md#final-regression-run).

## 7. Production readiness verdict

**Not yet "100%" ready, and this report does not claim it.** The core pharmacy flows that could be tested here (billing, stock, purchases, accounts, GST, returns, users/roles, offline billing, backup/restore with a fake Drive, tenant isolation, concurrency) pass. Three things stand between this and a production sign-off:

1. **Integrations that need real credentials were not exercised end to end** (WhatsApp Cloud API with a test number, Google Drive OAuth, Razorpay test mode, SMS OTP, e-invoice sandbox): BLOCKED, see the readiness report for exactly what is needed.
2. **Device and browser matrix:** only Chromium (desktop and phone emulation) was available; Windows 10/11, real Android/iPhone, Safari, Firefox and Edge were not tested.
3. **Two open defects:** the live dashboard occasionally misses one update (Medium, evidence in the bug log) and the tour's CSP console noise (Low).

Recommended before launch: run the blocked integration checks with test credentials, a short real-device pass, and decide on enabling RLS (defence in depth for multi-tenant hosting).
