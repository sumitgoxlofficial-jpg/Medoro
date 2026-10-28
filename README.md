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
Tests (unit + integration against a real PostgreSQL; uses `TEST_DATABASE_URL`, default `medoro_test` on localhost):
```bash
pnpm test
pnpm lint && pnpm typecheck
```

## What works now
| Area | Notes |
|---|---|
| Website & legal | Marketing site at `/` (product, AI, data ownership, pricing, FAQ) and `/legal` (about, help, privacy, terms, refunds, cookies, DPDP, grievance). Legal text is a draft for lawyer review |
| First-run setup | Pharmacy (GSTIN/drug licence checks), owner account, database check, branches & counters, team invite codes, backup recovery kit (key generated in the browser, sealed on the server) |
| Sign-in | Email + password (Argon2id), TOTP two-step verification (required for owners/managers, "trust this PC" for 30 days), lockout after 5 failures. Mobile OTP when `OTP_PROVIDER` is set. Counter staff: pharmacy code + employee ID + PIN + counter |
| Live multi-device sync | A sale, stock receipt or voucher on one device shows up on every other open screen within about a second (Postgres NOTIFY → one listener per app server → server-sent events → screen refresh, keeping carts and forms). The header pill shows Live / Connecting / Offline |
| App shell | Permission-filtered nav with live badges, branch switcher, EN/हिंदी, "View as" role preview (narrows only), sessions & revoke |
| Dashboard | KPIs, 14-day sales, collections, insights, low stock, expiring batches, branch performance, backup status, activity |
| Billing (POS) | FEFO batches, Rx prescriber rule, discount caps, split payments, credit limits, held carts, idempotent commit, thermal/A4 invoices, WhatsApp send |
| Returns & shift | Returns against invoices (restock or damaged), credit notes, refund modes, shift open/close with cash difference posted |
| Data import | Medicines with opening stock, suppliers and customers from Excel (.xlsx) or CSV. Every row is checked first with a reason for each problem; nothing is saved until all rows pass; re-running a file skips what's already there |
| Inventory | Batches, receive stock, quarantine, return to supplier, write-off, transfers between branches, movement ledger, stock count, recalls, expiry prevention |
| Stock intelligence | Reorder forecast and draft POs, seasonal planner (after 12 months of sales), supplier price comparison, slow stock, anomaly review |
| Purchases | POs, supplier invoice review (manual entry; remote OCR optional), GRN with totals check |
| Suppliers & customers | Balances, payments, statements, credit limits |
| Accounting & reports | P&L, day book, expenses, reversals (never edits), nine CSV reports for your CA |
| WhatsApp & messaging | Your own Meta Cloud API credentials, invoice template sends with delivery status, signed webhook, STOP opt-outs, refill reminders and consent-gated campaigns |
| Backup & restore | Encrypted backups (AES-256-GCM, recovery-kit key), verification, Google Drive upload, daily schedule with retries. Full restore: loads into a test copy first, shows backup vs live, takes a safety backup, then swaps in one transaction after the owner types the pharmacy code |
| Users & branches | Roles matrix, invites, PIN/password resets, branch management, transfers approval, audit trail with chain verification |
| Sync, subscription, privacy | Devices and offline queue, plan status, full data export, customer erasure, strict mode |
| Support access | The owner gives Medoro support a single-use link (1, 2 or 4 hours) from Privacy & data. It signs in a dedicated "Medoro support" user that can look but not change or download anything (enforced on the server), shows a banner, is audited, and can be ended at any time |
| AI assistant | Drawer (Ask AI / Ctrl+J) that answers from registered tools over the same services, with the same permissions; English and Hinglish; refuses clinical questions; drafts POs only after a single-use 5-minute confirmation. Rule-based by default; set `LOCAL_LLM_URL` + `LOCAL_LLM_MODEL` to plan with a local Ollama model |
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
