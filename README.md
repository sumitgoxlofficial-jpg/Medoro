# Medoro

**Smarter Pharmacy. Simpler Business.** Pharmacy management for Indian medical stores and multi-branch chains: billing, batch inventory, expiry control, purchases, accounting, WhatsApp invoices and encrypted backups. The pharmacy's data stays on infrastructure the pharmacy controls.

> **Status:** being built screen by screen from the design handoff in [`design/`](design/HANDOFF.md). The app ships with **no demo data**: a fresh install opens the setup wizard, where you create your pharmacy, branches and owner account. External integrations (WhatsApp, Google Drive, SMS OTP, OCR) are not connected yet.

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
| First-run setup | Pharmacy (GSTIN/drug licence checks), owner account, database check, branches & counters, team invite codes, backup recovery kit (key generated in the browser, sealed on the server) |
| Sign-in | Email + password (Argon2id), TOTP two-step verification (required for owners/managers, "trust this PC" for 30 days), lockout after 5 failures. Mobile OTP when `OTP_PROVIDER` is set |
| Counter staff | Pharmacy code + employee ID + 4-digit PIN + counter; invite-code self sign-up |
| App shell | Sidebar with permission-filtered nav and live badges, branch switcher, EN/हिंदी, "View as" role preview (narrows permissions only), sessions & revoke |
| Dashboard | KPIs, 14-day sales, collections, insights, low stock, expiring batches, branch performance, backup status, activity — all computed from the database |

Built into the core: money in integer paise with GST back-calculated from MRP, FEFO batch allocation, a hash-chained audit trail, and database triggers that make stock movements, vouchers, sales and audit rows append-only.

## Layout
| Path | Purpose |
|---|---|
| `src/app/(auth)` | Setup wizard, sign-in, MFA, employee login |
| `src/app/app` | The signed-in app (one folder per screen) |
| `src/domain/*` | Business rules and services, shared by UI, API and (later) the AI assistant |
| `src/server` | DB client, sessions, audit, sequences, secret sealing |
| `src/lib` | Money, dates, i18n, navigation |
| `prisma/` | Schema and migrations |
| `tests/integration` | Service tests against PostgreSQL |
| `design/` | The original clickable prototype, assets and handoff notes (reference only) |
| `docs/` | Architecture, security, privacy, data ownership, AI, WhatsApp, testing, deployment, backup |

## Not claimed
Medoro does not claim GST, drug-law or DPDP compliance, or any official government integration. Have qualified professionals review it before launch.
