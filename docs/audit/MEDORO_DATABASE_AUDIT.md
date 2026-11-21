# Medoro: database and backend audit

PostgreSQL 16, Prisma 6.19. Inspected on a database migrated from `prisma/migrations` (the same migrations Vercel applies in production); the production database itself was not accessed.

## 1. Inventory
| Item | Count |
|---|---|
| Tables | 198 (197 Prisma models + `_prisma_migrations`) |
| Enums | 14 |
| Migrations | 80 (79 existing + `20261215000000_hot_path_indexes` from this audit) |
| Indexes | 462, of which 321 unique (incl. primary keys) |
| Foreign keys | 55 |
| Triggers (non-internal) | 64: append-only guards and live-change `NOTIFY` triggers |

**Schema vs migrations drift:** `prisma migrate diff --from-migrations … --to-schema-datamodel …` against a shadow database produced only the four indexes added by this audit, so there was **no drift** before the change.

**Startup guard:** the app refused to start against a database with one pending migration ("Medoro refused to start: 1 pending … migration(s)"), observed during this audit. Production builds migrate in `scripts/vercel-build.sh` and preview builds never touch the production database.

## 2. Integrity rules verified by tests
| Rule | Evidence | Result |
|---|---|---|
| Money in integer paise (BIGINT) | Schema; GST test against an independent formula (5 mixed carts, 12%/5%, discounts) | PASS |
| Ledger balanced: Σ debit = Σ credit across all `LedgerLine` rows and in the trial balance | `audit-stress.test.ts` | PASS |
| Stock conservation: each batch's `qtyAvailable` = Σ of its `StockMovement.qty` | `audit-stress.test.ts` (SQL over all batches) | PASS |
| No oversell under contention (`SELECT … FOR UPDATE` on batches) | 25 concurrent sales on 10 units | PASS |
| No deadlock with opposite lock orders | 16 concurrent carts | PASS |
| Invoice sequence per branch and fiscal year, gapless under contention and rollback | `audit-stress.test.ts`, `sales.test.ts` | PASS |
| Idempotent sale commit (unique key per tenant) | `sales.test.ts`, `tenant-writes.test.ts` | PASS |
| Returns can't exceed what was sold, even concurrently | `audit-stress.test.ts` (4 concurrent returns → 1) | PASS |
| Append-only: sales, payments, ledger lines, GRNs, audit events, consent records, distribution invoices/returns/collections | 64 triggers listed below; trigger definitions (`prisma/sql/append_only.sql`, migration `20261213000000_immutable_records`); `void.test.ts` checks voids add rows instead of editing | PASS |
| Tenant isolation, reads and writes | `tenant-isolation.test.ts`, `tenant-writes.test.ts` | PASS (service layer) |
| Optimistic versions on master data | INT catalog/parties | PASS |

Append-only triggers present: `AuditEvent, CatalogueChange, ComplianceDocument, ComplianceReminder, ConsentRecord, DeliveryEvent, DistCollection, DistInvoice, DistInvoiceCancel, DistInvoiceLine, DistReturn, DistReturnLine, EInvoice, ForecastSnapshot, Grn, GrnItem, GrowthAuditLog, LeadActivity, LeadAssignmentHistory, LeadEvidence, LeadLog, LedgerLine, LoyaltyLedger, Payment, RecallDisposal` and more (sales, stock movements, vouchers per `prisma/sql/append_only.sql` and the immutable-records migration). Live `NOTIFY` triggers on `Batch, Branch, Campaign, Counter, Customer, DeliveryOrder, Grn, HeldCart, Integration, Invite, Medicine, PurchaseOrder, Recall, Sale, Voucher, …`.

## 3. Findings
| Id | Severity | Finding | Status |
|---|---|---|---|
| DB-1 (BUG-06) | MEDIUM | No index for the open-shift lookup taken on **every sale commit**, the WhatsApp status webhook lookup by `wamid`, per-invoice message lookups, or offline-conflict counts. Measured 24–38 ms sequential scans at 400k–600k rows, growing with every pharmacy's data | FIXED: migration `20261215000000_hot_path_indexes`; after: 0.02–0.06 ms index scans |
| DB-2 | LOW | Only 55 foreign keys for 198 tables: most `tenantId`, `branchId` and many reference columns (e.g. `Shift.branchId`, `WaMessage.invoiceId`, `StockMovement.batchId`) have no FK, so orphans are prevented only by application code | OPEN: recommendation: add FKs (with `NOT VALID` then `VALIDATE`) for `tenantId → Tenant` and the main parent links, after an orphan check on production |
| DB-3 | MEDIUM | Row-level security is built (`src/server/rls.ts`, `rls-readiness.test.ts`) but not enabled | OPEN: see the security audit (SEC-2) |
| DB-4 | LOW | 18 more tenant tables have no tenant-leading index (`AiConfirmation, BackupManifest, BankStatement, Campaign, ComplianceReminder, Counter, DeliveryEvent, Device, DistInvoiceCancel, DistRack, HeldCart, Invite, Recall, RestoreRun, ScanDocument, StockCount, SupportGrant, SupplierBill`) | OPEN: small per pharmacy; index if hosted volume grows |

## 4. Backup and recovery
- Encrypted backups (AES-256-GCM, recovery-kit key), verification, restore into a test copy, then swap after typing the pharmacy code: E2E 11 and INT backup/restore PASS.
- Device databases restore from Drive with the recovery code: E2E 19 PASS (built-in fake Drive).
- On Medoro's hosted server, restoring an old server backup is refused because pharmacy data now lives in each pharmacy's own Drive (`noServerRestore`, verified on production: the endpoint never restores).
- Real Google Drive round trip: BLOCKED (OAuth client needed).

## 5. Changing the production schema
The only schema change from this audit is additive (four `CREATE INDEX`). Prisma runs migrations in a transaction, so they are plain `CREATE INDEX` (not `CONCURRENTLY`). The affected tables are small on the hosted server (pharmacy records live in Drive), so the lock is brief. On a large self-hosted database, take a backup first and apply during quiet hours. No data was changed and no production database was touched.
