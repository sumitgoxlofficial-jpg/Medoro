# Medoro

**Smarter Pharmacy. Simpler Business.** Pharmacy management for Indian medical stores and multi-branch chains: billing, batch inventory, expiry control, purchases, accounting, WhatsApp invoices and encrypted backups. The pharmacy's data stays on infrastructure the pharmacy controls.

> **Status:** every screen in the design handoff ([`design/`](design/HANDOFF.md)) is built. The app ships with **no demo data**: a fresh install opens the setup wizard, where you create your pharmacy, branches and owner account. Integrations that need outside accounts (WhatsApp Cloud API, Google Drive, SMS OTP, remote OCR, a local LLM) work once you add your own credentials in `.env` or in the app; until then the screens say they're not connected.

## Stack
Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind 4 · Prisma 6 · PostgreSQL 16 · Zod · Vitest · lucide-react.

## Run it locally
```bash
cp .env.example .env              # set DATABASE_URL and SESSION_SECRET (32+ random chars); never commit .env
pnpm install
pnpm prisma migrate deploy        # creates tables + append-only triggers
pnpm dev                          # http://localhost:3000 → setup wizard on first run
```
With Docker instead: `bash scripts/lan-setup.sh && docker compose --profile https up -d --build` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
Tests (unit + integration against a real PostgreSQL; uses `TEST_DATABASE_URL`, default `medoro_test` on localhost):
```bash
pnpm test
pnpm lint && pnpm typecheck
```

## What works now
| Area | Notes |
|---|---|
| Website & legal | Marketing site at `/` (product, AI, data ownership, pricing, FAQ) and `/legal` (about, help, privacy, terms, refunds, cookies, DPDP, grievance). Legal text is a draft for lawyer review |
| First-run setup | Pharmacy (GSTIN/drug licence checks), owner account, where PostgreSQL runs (this server, shop LAN or hosted, checked against `DATABASE_URL`) with a connection test, branches & counters, team invite codes, backup recovery kit (key generated in the browser, sealed on the server) |
| Sign-in | Email + password (Argon2id), TOTP two-step verification (required for owners/managers, "trust this PC" for 30 days), lockout after 5 failures. Mobile OTP when `OTP_PROVIDER` is set. Counter staff: pharmacy code + employee ID + PIN + counter |
| Live multi-device sync | A sale, stock receipt or voucher on one device shows up on every other open screen within about a second (Postgres NOTIFY → one listener per app server → server-sent events → screen refresh, keeping carts and forms). The header pill shows Live / Connecting / Offline |
| Install & offline billing | Installable app (manifest, icons, service worker) in Chrome/Edge or on Android. A manager turns on offline billing per counter in Sync & offline: the counter keeps the price list and a reserved share of each batch (split between offline counters, one share left for online ones). If the server can't be reached, Medoro opens offline billing: cash/UPI/card bills with provisional receipts, kept on the device. On reconnect they post automatically with their original time and a real invoice number; the server rechecks stock, prices and permissions, and anything that no longer fits becomes a conflict a manager posts from current stock or closes with a note. Needs HTTPS (browsers only run service workers on secure sites or localhost) |
| Desktop app (`desktop/`) | Tauri app for Windows, macOS and Linux that opens your Medoro server in its own window (it stores only the server address). Installers are built by the "Desktop app" GitHub workflow; tag `desktop-vX.Y.Z` to draft a release |
| App shell | Permission-filtered nav with live badges, branch switcher, EN/हिंदी, "View as" role preview (narrows only), sessions & revoke |
| Dashboard | KPIs, 14-day sales, collections, insights, low stock, expiring batches, branch performance, backup status, activity |
| Billing (POS) | FEFO batches, Rx prescriber rule, discount caps, split payments, credit limits, held carts, idempotent commit, thermal/A4 invoices, WhatsApp send |
| Returns & shift | Returns against invoices (restock or damaged), credit notes, refund modes, shift open/close with cash difference posted |
| Data import | Medicines with opening stock, suppliers and customers from Excel (.xlsx) or CSV. Every row is checked first with a reason for each problem; nothing is saved until all rows pass; re-running a file skips what's already there |
| Inventory | Batches, receive stock (opening stock posts to Inventory against Opening balance equity), per-batch actions (stock adjustment +/− with reason, write-off, return to supplier, transfer request, quarantine/release), a Transfers tab to approve/receive/reject/cancel inter-branch transfers, movement ledger, stock count, recalls with one-click supplier return, expiry prevention |
| Stock intelligence | Reorder forecast and draft POs, seasonal planner (after 12 months of sales), supplier price comparison, slow stock, anomaly review |
| Purchases | POs (place, cancel or close short with a reason), supplier invoice review with a queue of uploaded invoices to open or discard (manual entry; remote OCR optional), GRN with totals check, IGST for out-of-state suppliers |
| Suppliers & customers | Balances, payments, ledger statements for any date range (screen, print, CSV), delivery accuracy from POs vs GRNs, credit limits |
| Accounting & reports | P&L, day book, account ledger with running balance, trial balance, expenses, reversals (never edits), GST summary with CGST/SGST/IGST, ten CSV reports for your CA |
| WhatsApp & messaging | Your own Meta Cloud API credentials, invoice template sends with delivery status, signed webhook, STOP opt-outs, refill reminders and consent-gated campaigns |
| Backup & restore | Encrypted backups (AES-256-GCM, recovery-kit key), verification, Google Drive upload, daily schedule with retries. Full restore: loads into a test copy first, shows backup vs live, takes a safety backup, then swaps in one transaction after the owner types the pharmacy code |
| Users & branches | Roles matrix, invites, PIN/password resets, branch management, transfers overview, audit trail with chain verification |
| Sync, subscription, privacy | Devices, offline counters and bills, plan status, full data export, customer erasure, strict mode |
| Support access | The owner gives Medoro support a single-use link (1, 2 or 4 hours) from Privacy & data. It signs in a dedicated "Medoro support" user that can look but not change or download anything (enforced on the server), shows a banner, is audited, and can be ended at any time |
| AI assistant | Drawer (Ask AI / Ctrl+J) that answers from registered tools over the same services, with the same permissions; English and Hinglish; refuses clinical questions; drafts POs only after a single-use 5-minute confirmation. Rule-based by default; set `LOCAL_LLM_URL` + `LOCAL_LLM_MODEL` to plan with a local Ollama model |
| Deployment & operations | `docker compose` stack (PostgreSQL 16, one-shot migrate job, app with healthchecks, optional HTTPS proxy), shop-LAN helper (`scripts/lan-setup.sh`/`.ps1`: local CA + certificate, `.env` with random secrets, URLs), `/api/health`, `/api/ready` (DB, migrations, settings), Prometheus `/api/metrics` behind `METRICS_TOKEN`, JSON logs with redaction, refuses to start with pending migrations. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Security hardening | Per-request nonce CSP and security headers, Origin checks on server actions and cookie-authenticated API posts, PostgreSQL-backed rate limits (AI, WhatsApp sends, campaigns, exports, reports, documents), version checks on medicine/supplier/customer edits, two-tenant isolation test suite, CodeQL, Dependabot and a CycloneDX SBOM in CI. See [docs/SECURITY.md](docs/SECURITY.md) |
| Staff console (`/staff`) | For Medoro's own team: sign-up with super admin approval (first admin from `STAFF_BOOTSTRAP_EMAIL`), password + mandatory authenticator, invites and resets, sales pipeline with discount approvals, logged sales with commission locked at the day's rate, payment verification creating customer accounts, encrypted payout bank details, payout runs with TDS, customers with health score and notes, support tickets with SLA, internal notes, escalation and remote-access requests. Staff tables are separate and never touch pharmacy data |

Built into the core: money in integer paise with GST back-calculated from MRP, FEFO batch allocation, a hash-chained audit trail, and database triggers that make stock movements, vouchers, sales and audit rows append-only.

## Layout
| Path | Purpose |
|---|---|
| `src/app/(auth)` | Setup wizard, sign-in, MFA, employee login |
| `src/app/app` | The signed-in app (one folder per screen) |
| `src/domain/*` | Business rules and services, shared by the UI, API routes and the AI assistant |
| `src/staff`, `src/app/staff` | Medoro staff console (control plane): its own auth, tables and services |
| `src/app/page.tsx`, `src/app/legal` | Marketing website and legal pages |
| `src/server` | DB client, sessions, audit, sequences, secret sealing |
| `src/lib` | Money, dates, i18n, navigation |
| `prisma/` | Schema and migrations |
| `tests/integration` | Service tests against PostgreSQL |
| `design/` | The original clickable prototype, assets and handoff notes (reference only) |
| `docs/` | Architecture, security, privacy, data ownership, AI, WhatsApp, testing, deployment, backup |

## Not claimed
Medoro does not claim GST, drug-law or DPDP compliance, or any official government integration. Have qualified professionals review it before launch.
