# MEDORO 2.0: enhancement status, audit and decisions

This document records what was inspected, what was built in this increment, what was **not** built, and the decisions that need an owner. It is written against the repository as it stands; nothing here describes behaviour that is not in the code.

## 1. Summary of this increment

| Module | Status | Where |
|---|---|---|
| 9 Integration Health Centre | **Built, tested** | `src/domain/system/health*.ts`, `/app/health`, migration `20261208000000_integration_health` |
| 2 Supplier Intelligence | **Built, tested** (extends existing supplier performance) | `src/domain/purchasing/supplier-score.ts`, `supplier-intel.ts`, `/app/intelligence/suppliers` |
| 10 Cloud architecture review | **Reviewed and documented; one decision needed** (section 4). No deployment change made | this file |
| 11 Security hardening | **Reviewed; not changed** (section 5). Two new read paths added to the tenant-isolation suite | this file |
| 1, 3, 4, 5, 6, 7, 8 | **Not built in this increment** (section 3 lists what already exists and the real gap) | n/a |

This is a first increment, not a completed 2.0. Seven of eleven modules are untouched beyond the audit below.

## 2. What was inspected first

- Stack confirmed: Next.js 15.5, React 19, TypeScript, Prisma 6.19, PostgreSQL 16, ~140 Prisma models, 60+ forward-only migrations, 158 test files / 955 tests passing before any change (baseline run: `pnpm lint`, `pnpm typecheck`, `pnpm test` all clean).
- All mutations are Next.js server actions wrapped by `run()` (`src/server/action.ts`); there is no public REST API for app features. "API documentation" therefore means the domain-service and server-action contracts in section 6.
- Permissions are the existing keys (`reports`, `integrations`, …) via `authorize(ctx, …)`; branch access is `ctx.branches`.

### Existing functionality relevant to each module (reused, not rebuilt)

| Module | Already in the repo | Real gap |
|---|---|---|
| 1 Central medicine catalogue | Per-pharmacy `Medicine` (name, generic, strength, form, manufacturer, pack, barcode, HSN, GST, schedule, `composition`/`saltKey`), `catalog.ts`, `salts.ts`, `hsn-codes.ts`, a catalogue counter migration | No cross-pharmacy (central) catalogue, global IDs, verification source/date, catalogue versions, duplicate detection across tenants, correction requests or sync. A central catalogue is a **platform-level** dataset and must not mix with tenant data; it needs its own schema and governance. |
| 2 Supplier intelligence | `supplierPerformance` (fill %, on-time %), `priceComparison`, `Supplier` credit/lead/return terms, landed cost on `GrnItem.costPaise` | **Built now**: scoring, ranking, recommendation with explanation, price history, branch scoping |
| 3 Customer intelligence | `Customer`, `ConsentRecord`, `WaOptOut`, loyalty, refill reminders, campaigns (`comms/crm.ts`), consent-aware sending | Segmentation, CLV, retention/lapsed reports, campaign performance reporting |
| 4 Profit intelligence | `reports/margins.ts` (item, category, supplier margins from batch cost), double-entry `Voucher`/`LedgerLine`, `slowStock`, expiry rows, discount anomalies | Branch-wise profit from ledger, free-goods analysis, leakage detection, a margin dashboard. Margins today use batch cost, not a full ledger/landed-cost reconciliation; that must be reconciled before it is called "profit". |
| 5 Recall | `Recall` + `inventory/recalls.ts`: manual verified notice entry, batch matching, quarantine with stock movements, supplier return, audit, `/app/recalls` | Manufacturer matching, affected-quantity report, disposal tracking, resolution report, notifications. **No automated government feed exists and none is claimed.** |
| 6 Compliance centre | `Tenant` DL/pharmacist fields, schedule on medicines, retention (`system/retention.ts`), expiry digest | Licence/registration tracking with expiry reminders, inspection reports, document storage UI, branch compliance status. All requirements must be configurable and reviewed by qualified Indian regulatory professionals. |
| 7 Forecasting | `intelligence/service.ts` (velocity forecast, reorder policy cover/safety, seasonal, draft POs, central buying) | Daily/weekly/monthly forecasts with confidence, forecast-accuracy tracking, stockout prediction. Existing output is a rule, not a statistical model, and should be labelled as such. |
| 8 Chain benchmarking | `ownerSnapshot` across branches, `centralBuying` | Branch comparison reports (growth, turnover, retention, employee performance), restricted to authorised branches |
| 9 Integration health | `/api/ready`, `backupHealth`, `drive-health`, `driveState`, `waStatus` | **Built now** |
| 10 Architecture | `DATA_OWNERSHIP.md`, `DRIVEDB_PLAN.md`, `BACKUP_AND_RECOVERY.md`, `ARCHITECTURE.md` | Decision needed (section 4) |
| 11 Security | See `SECURITY.md`: Argon2id, mandatory TOTP for Owner/Manager, hash-chained audit, append-only triggers, rate limits, CSP, two-tenant isolation suite | RLS policies, non-owner DB role (section 5) |

## 3. Not built, and why

These are explicitly **outstanding**. None has a screen, endpoint or table in this increment, and nothing in the UI pretends otherwise.
Modules 1, 3, 4, 5 (extensions), 6, 7 (extensions) and 8 each need schema design, domain rules and review that deserve their own increment. Two need an input only the owner can give: the authoritative source and governance for the central catalogue (Module 1), and Indian regulatory review of compliance rules (Module 6). Recalls must keep using verified, manually entered notices until a real data source is connected.

## 4. Module 10: transactional data ownership (decision needed)

### What the code does today

| Mode | Transactional source of truth | Role of Google Drive | Role of local SQLite |
|---|---|---|---|
| **Hosted SaaS** (`PUBLIC_SIGNUP=1`, `serverBackupsOff`) | **The pharmacy's counters (DriveDB, SQLite) with encrypted copies in the owner's Google Drive.** Medoro's PostgreSQL holds only the control plane: accounts, sessions, subscription, payments, device list, integration tokens, two short-lived inboxes. The server refuses business writes for these pharmacies (`Ctx.moved`). | Primary durable store of business data | Working copy on each device; synced through Drive |
| **Self-hosted / customer cloud / LAN** | **PostgreSQL**, the only transactional store | Optional encrypted backups | Offline queue only (`OfflineOp`, reserved stock quota) |
| Pharmacy not yet moved (legacy rows on Medoro's copy) | PostgreSQL, **read-only** until moved | n/a | n/a |

Within each mode there is exactly one authoritative store, so nothing is being silently combined *per pharmacy*. The mixing risk is at the **platform** level: the default hosted mode is Drive/SQLite, which contradicts the requirement for "a single authoritative transactional database" and means **every server-side module (Suppliers, Customers, Profit, Forecasting, Benchmarking, Health) has no data to analyse for hosted pharmacies**: their bills, stock and purchases are not on the server. The new supplier-intelligence screen will show empty history for such a pharmacy; it does not guess.

### Why I did not change it

Your instruction forbids changing the deployment model without a documented migration plan, and a move of hosted pharmacies from Drive/SQLite to a server database is a data-migration and a privacy-promise change (`DATA_OWNERSHIP.md` says Medoro keeps no pharmacy records). It is a product decision, not an implementation detail.

### The decision

Pick one for the **default hosted SaaS**:

- **A. Keep Drive/SQLite as the hosted source of truth** (today). Then server-side intelligence must run on-device (the `src/drivedb/*` modules already mirror services such as purchase tools and insights), or on aggregates the device chooses to send. Modules 2-8 would need a DriveDB port each.
- **B. Make PostgreSQL the single authoritative transactional store for hosted SaaS**, tenant-isolated, with Drive as an optional encrypted backup and SQLite only as an offline queue that is reconciled into PostgreSQL (the `OfflineOp` model already exists for this). This matches your Module 10 requirement and lets every server module work. It requires a migration plan for hosted Drive-mode pharmacies, a revised privacy statement, and the RLS work in section 5.

My recommendation is **B** for Modules 2-8 to be useful, **after** an explicit migration plan. Until you choose, I will not touch the mode.

Conflict resolution that already exists and is kept: optimistic `version` on master data; offline operations carry a ULID, device id and base version, are re-validated on sync and become `conflict` rows for manual resolution. Backup and recovery (`docs/BACKUP_AND_RECOVERY.md`) is unchanged: AES-256-GCM, test restore, optional Drive upload.

## 5. Module 11: security review (nothing weakened)

Reviewed `SECURITY.md` against the requirement list.

| Requirement | State |
|---|---|
| MFA | Exists: TOTP mandatory for Owner/Manager |
| Append-only accounting, immutable stock movements | Exist: triggers (`staff_append_only`, posted tables). Not re-verified here beyond the passing existing tests |
| Audit integrity | Hash chain exists (`lib/audit-hash.ts`); no verification screen or job was added |
| Branch-level permissions | `ctx.branches` filters; the new supplier-intelligence service rejects a branch the user cannot access (tested) |
| Non-owner DB role, transaction-scoped tenant context, tenant-aware RLS | **Not implemented.** The app connects as the table owner, which bypasses RLS; `SECURITY.md` already says so. `lock_data_api` only closes hosted REST/GraphQL. A correct change needs an explicit "system" role for the legitimately cross-tenant paths (sign-in, scheduler, backups, staff console) and a transaction wrapper that sets `app.tenant_id`; it changes transaction semantics across services and must be done as its own migration with the isolation suite as the gate. I did not attempt it as part of a broad pass. |
| Data export controls, backup restore validation | Exist (audited exports, `testRestore`) |
| System-service authorization | Not changed |

Added in this increment: both new read services (`supplierIntel`, `healthOverview`) are in `tests/integration/tenant-isolation.test.ts`, which fails if either leaks any id or marker name of another pharmacy. The new tables have RLS enabled like the rest.

## 6. API and contracts

There is no REST surface for these features. Contracts:

**Integration Health (`src/domain/system/health.ts`)**, permission `integrations`
- `healthOverview(ctx): HealthRow[]`: one row per integration `{ key, label, state, reason, detail, lastTestAt, lastSuccessAt, lastError, lastErrorAt, action }`.
- `runHealthTest(ctx, key)`: explicit test for `gdrive | whatsapp | ocr | ai`; stores the outcome in `IntegrationHealth`, audits it, rate-limited (12 per 10 minutes per user). Throws for live keys.
- `recordHeartbeat(ok, error?)`: called by `/api/cron/tick` after every scheduler run into `SystemHeartbeat`.
- Server action `testAction(key)` in `src/app/app/health/actions.ts`.

State rules (`health-state.ts`, unit-tested including an exhaustive "Active never without a passing test" property):
`not_configured` → nothing set up; `connected` → set up, no passing test; `tested` → a test passed but no real use after it, or the pass is older than 24 h; `active` → fresh passing test **and** real use since; `error` → last test or last real run failed. Active is derived on every read and never stored.

What counts as a genuine test, per integration:

| Integration | Test | Real-use evidence for Active |
|---|---|---|
| Database | live `SELECT` on `_prisma_migrations` | the request itself |
| Backups | newest non-running manifest is `verified` | verified backup within 48 h |
| Google Drive | explicit: Drive `about` API call with the stored token | Drive backup in last 8 days |
| WhatsApp | explicit: Meta template read, or linked-phone ready | delivered/read message in 30 days |
| WhatsApp delivery | last final message statuses (no explicit test) | latest not failed; ≥3 failures and ≥half of the last 20 → Error with last code |
| Razorpay webhooks | a webhook-confirmed payment (the only proof) | payment confirmed within 90 days; otherwise "Connected" |
| OCR | explicit: **reachability** of the engine only (HEAD, auth errors fail) | a scanned invoice reached review/approved in 30 days |
| AI | explicit: **reachability** of the model server (`/models` or `/api/tags`) | an AI question in 30 days |
| Background jobs | scheduler heartbeat | run OK within 15 min (26 h on Vercel cron) |
| Offline sync | latest posted/resolved offline operation; conflicts older than 1 day → Error | sync within 7 days |

Limits stated plainly: OCR and AI tests prove reachability and credentials, not output quality. Razorpay cannot be tested on demand without sending a real payment, so it reads "Connected" until one is confirmed. "Retry" for live checks re-reads the facts; it cannot repair them.

**Supplier Intelligence (`src/domain/purchasing/supplier-intel.ts`)**, permission `reports`
- `supplierIntel(ctx, branchId|null)`: ranking, per-medicine recommendations with explanation, branch-wise top three. A branch outside `ctx.branches` is refused.
- `priceHistory(ctx, medicineId, branchId|null)`: landed cost per supplier over time.
- Scoring (`supplier-score.ts`): price 40%, fulfilment 20%, delivery 20%, credit 10%, expiry-return policy 10%; missing factors are dropped and the rest re-scaled; confidence is low with fewer than two orders. Landed cost is `GrnItem.costPaise` (documented in `PURCHASING.md`); lines without it are excluded and counted on screen. Credit is scored separately, not netted into cost.
- `supplierPerformance` gained an optional `branchIds` argument; existing callers are unchanged.

## 7. Deployment

1. Deploy the new app build and run `pnpm prisma migrate deploy`. Migration `20261208000000_integration_health` only **creates** two tables (`IntegrationHealth`, `SystemHeartbeat`) and enables RLS on them. It alters no existing table and rewrites no data.
2. No new environment variables.
3. The scheduler writes its heartbeat on the next tick; until then "Background jobs" reads Not configured.

## 8. Rollback

- Migrations are forward-only. To roll back, redeploy the previous app build. The two new tables are unused by older builds and can stay. Older builds also ignore the new nav entry and routes.
- To remove the tables after rolling back (only if wanted), run manually, never from a migration:
  `DROP TABLE "IntegrationHealth"; DROP TABLE "SystemHeartbeat";` The data is a cache of test outcomes and heartbeats; no business data is lost.
- Restoring a backup taken before the migration works; the tables are simply absent until `migrate deploy` is run again.

## 9. Verification (actual results, this environment)

Run on PostgreSQL 16, Node 22, against the code as committed:

| Gate | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | **986 passed, 0 failed, 162 files** (baseline before changes: 955 / 158; +31 tests: health state, scoring, health integration, supplier integration, tenant-isolation readers) |
| `pnpm build` | succeeds |
| `pnpm test:e2e` | **Only the 11 spec files CI runs were executed (27 tests, all passed)**, including new `e2e/31-medoro2.spec.ts`. The other ~20 specs (drive/device/AI/live etc.) were not run: per `docs/TEST_PLAN.md` they need extra setup. So "all e2e passes" is **not** claimed. |

Problems found and fixed by these runs (kept for honesty):
1. The restore tests failed (19 tests) because the two new tables were unclassified for backup/restore. Fixed: `IntegrationHealth` is kept as-is on restore, `SystemHeartbeat` is global.
2. The site-crawl e2e caught a React hydration mismatch in the health screen (locale-dependent timestamps). Fixed with fixed-format IST.
3. My own spec clicked before hydration; fixed with a wait.

Not verified: the Google Drive, WhatsApp, OCR and AI **explicit tests were exercised only with injected failures and stubs**. No live Google, Meta, OCR or AI service was available, so those paths have not been run against the real services. In this environment nothing external is configured, so every outside integration correctly reads "Not configured".

## 10. Outstanding work

Modules 1, 3, 4, 5 (extensions), 6, 7 (extensions) and 8 are not built. Module 10 needs the owner's decision (section 4). Module 11's RLS / non-owner role / audit-verification work is not done (section 5). This increment is **not** a production-readiness claim.
