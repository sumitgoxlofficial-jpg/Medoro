# Repository audit (before MEDORO Distribution)

Audited at commit `6770154` (main). The repository is a mature, production-oriented Next.js 15 / React 19 / TypeScript /
Tailwind 4 / Prisma 6 / PostgreSQL 16 application for retail pharmacies, plus Medoro's own staff console (licence
server, HRMS, growth CRM). 920 source files, 79 migrations, 184 test files.

## What existed and was reused as-is

| Area | Existing implementation | How Distribution uses it |
|---|---|---|
| Tenancy | `Tenant` → `Branch` → `User`; every business table carries `tenantId`; all services filter by it | A distribution tenant is a `Tenant` with `product = "distribution"`; each **godown is a `Branch`** |
| Identity & sessions | Argon2id passwords, TOTP MFA (mandatory for owners), PIN sign-in on shared devices, lockout, sessions with idle timeout, invites | Unchanged. Distribution users sign in at `/signin`; `/app` hands distribution tenants to `/dist` |
| RBAC | `Role.permissions` + per-user grants/revokes, enforced in services via `authorize()` | Distribution roles/permissions are a separate list (`src/domain/distribution/perms.ts`) computed by `distCtxFrom()`; shared permission keys (`purchase`, `payments`, `reports`, `adjust`, `users`, `integrations`) keep their meaning so shared services enforce the same checks |
| Audit | Hash-chained, append-only `AuditEvent` (`writeAudit`) | Every distribution change writes an audit event |
| Sequences | Gap-free per-tenant counters (`nextSeq`) and GST document numbering (`gstDocNo`, ≤16 chars) | Invoice / credit note / order / pick / dispatch numbers |
| Catalogue & stock | `Medicine`, `Batch` (per branch, FEFO), `StockMovement` (append-only), `MedicineRack`, `Transfer`, stock adjustments | Product master, batch-wise stock per godown, racks, godown transfers, audited adjustments |
| Purchasing | `Supplier`, `PurchaseOrder`, `Grn`/`postGrn` (batch creation, landed cost, PTR/PTS/scheme/trade/cash discounts, ITC, totals check), `SupplierBill` | Purchase orders and GRNs are posted by the **same** service — no second purchase path |
| Supplier claims | `SupplierClaim` with raise → acknowledge → credit note → write-off; claims receivable account | Expiry/breakage claims are created as `SupplierClaim` rows so the shared acknowledgement/credit/reconciliation logic applies |
| Accounting | `Voucher`/`LedgerLine` (append-only, balanced), chart of accounts, trial balance, day book, reversals | Invoices, credit notes, receipts, cancellations post balanced vouchers to the same books |
| Receipts & cheques | `receiveFromCustomer`, cheque lifecycle (deposit/clear/bounce) through clearing accounts | Collections (office, salesman, delivery) post through it |
| Bank reconciliation | Statement import (CSV/XLSX/HTML-XLS), auto-match, manual match | Reused directly on `/dist/accounts?tab=bank` |
| GST returns | GSTR-1 / GSTR-3B builders (GSTN offline-tool JSON), HSN summary, ITC from ledgers | Distribution invoices are mapped to the same `GstDoc` shape and fed to the same builders |
| Forecast model | Weekday-aware demand model with an 80% range (`forecast-model.ts`) | Demand forecasting and reorder suggestions |
| Subscription & licensing | Ed25519-signed licences, trial/grace/read-only phases, plan entitlements | Same licence state and read-only lock; separate distribution plan table (`plans.ts`) |
| Backup / restore / deletion | Encrypted (AES-256-GCM) per-tenant backups, test-copy restore, account deletion; table classification computed from the live schema | New tables are covered automatically; the two platform tables of the chemist portal were classified explicitly |
| Security headers, CSRF, rate limits | Nonce CSP, origin checks, PostgreSQL-backed rate limits | Reused; portal sign-in/registration and distributor sign-up are rate-limited |
| Hindi | `t()` / `<T>` with per-area dictionaries and a coverage test | `src/lib/hi/distribution.ts` added; coverage test passes |

## What did not exist (and was built)

Wholesale billing on PTR/PTS ex-GST with free goods; schemes engine; chemist wholesale profiles (Form 20B/21B licences,
credit days, grace, territory, salesman, price tier); companies/principals with expiry-claim terms; customer order
workflow with approval, credit control and stock **reservation**; warehouse picking/packing; dispatch and proof of
delivery; bill-wise receivables and ageing; distribution MIS; distribution intelligence; a chemist ordering portal with
its own accounts and sessions; distributor sign-up; distribution plans.

## Guardrails found in the repository (all still green)

* Append-only triggers on posted tables; a security test lists them (extended with the six distribution ledgers).
* "Every public table has row-level security enabled" (`security.test.ts`, `hosting.test.ts`) → RLS enabled on all 24 new tables in the migration.
* "Every table is classified for backup/restore and RLS readiness" (`restore.test.ts`, `rls-readiness.test.ts`) → tenant tables are classified automatically; `DistChemistAccount` / `DistPortalSession` deliberately classified as platform data.
* Hindi coverage test → all marked distribution strings have Hindi lines.
* Drive-only hosting policy on Medoro's own hosted server (`PUBLIC_SIGNUP=1`): tenants must keep records in their Google Drive. Distribution cannot run Drive-only, so it is **off on that server unless `DIST_HOSTED=1`** (see DEPLOYMENT.md) — the policy was not silently overridden.

## Changes to existing files (all additive / opt-in)

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Tenant.product` (default `"pharmacy"`), new `Dist*` models |
| `prisma/migrations/20261214000000_distribution` | Additive only: no `DROP`, no column changes to existing tables except the new defaulted column |
| `src/domain/identity/service.ts` | `createPharmacy(..., { product })` option; pharmacy path unchanged |
| `src/app/app/layout.tsx` | Redirects a distribution tenant to `/dist` |
| `src/domain/system/restore.ts` | Two portal tables added to the platform list |
| `src/lib/hi/index.ts` | Registers the distribution dictionary first, so pharmacy wording always wins for shared lines |
| `playwright.config.ts` | New `dist` project |
| `tests/integration/{security,rls-readiness}.test.ts` | Extended lists |
