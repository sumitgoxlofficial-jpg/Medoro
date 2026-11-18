# Hosted SaaS: single authoritative transactional store (migration plan)

Status: **a plan, not implemented, not enabled.** Written to satisfy the Medoro 2.0 requirement that the default hosted deployment
have one documented, authoritative transactional database, and the rule that the deployment model is not changed without a migration
plan. Nothing in the code switches any pharmacy to this model. It needs the owner's decision (section 9) before any work starts.

## 1. What is true today (from the code and `DATA_OWNERSHIP.md`, `DRIVEDB_PLAN.md`)

| Deployment | Transactional source of truth | Role of Google Drive | Role of local SQLite |
|---|---|---|---|
| Hosted SaaS (`PUBLIC_SIGNUP=1`) | The pharmacy's **devices** (DriveDB, SQLite) with encrypted copies in the owner's Drive. Medoro's PostgreSQL holds only the control plane (accounts, sessions, subscription, payments, device list, integration tokens, two short-lived inboxes). The server refuses business writes (`Ctx.moved`) | Primary durable store | Working copy per device, synced through Drive |
| Self-hosted, LAN, customer cloud | PostgreSQL, the only transactional store | Optional encrypted backups | Offline queue only (`OfflineOp`, reserved stock quotas) |

Within each mode there is one authoritative store per pharmacy. The problem is the **hosted default**: it cannot run any server-side
feature (reports, intelligence, forecasting, benchmarking, recalls, compliance, central catalogue, integration health) because the
records are not on the server, and it is the only mode where Drive and device SQLite *are* the primary store.

## 2. Target model for the hosted default

**PostgreSQL is the single authoritative transactional store, per pharmacy (tenant).** Everything else is a derivative:

| Component | Target role | Never |
|---|---|---|
| PostgreSQL (hosted, tenant-isolated, RLS enforced) | Source of truth for bills, stock, purchases, ledger, customers, audit | |
| Device SQLite | **Offline queue and read cache** for counters: operations queued while offline, replayed to PostgreSQL | A second source of truth; accepting a sale that PostgreSQL later cannot reconcile without a conflict record |
| Google Drive | **Optional encrypted backup and export** (existing behaviour, retained) | Read at run time for business data; written to as the primary store |

## 3. Preconditions (do these first; each is independently valuable)

1. **Tenant isolation enforced by the database**, not only the service layer: the staged RLS rollout in `MEDORO_2.md` section 5, using the readiness kit already in the repo (`src/server/rls.ts`, `src/server/tenant-context.ts`, `scripts/rls-policies.ts`, `tests/integration/rls-readiness.test.ts`). Hosting many pharmacies' records in one database is the reason this matters. Do not migrate before it is on in production and the two-tenant suite passes against the non-owner role.
2. **Backups and restore at hosted scale:** per-tenant encrypted backup and verified test-restore already exist; confirm they hold at the expected data volume and that restore time meets your promise to pharmacies.
3. **Capacity and cost model:** the current promise that "Medoro's database stays small no matter how many pharmacies join" ends. Estimate rows per pharmacy per year (bills, lines, movements, ledger lines, audit) and the cost per tenant before committing.
4. **Privacy and legal review:** `DATA_OWNERSHIP.md` states Medoro stores no pharmacy records for hosted pharmacies. That statement, the privacy policy, the terms and the signup text change. Each pharmacy's consent to the move must be explicit and recorded. This is not an engineering decision.
5. **Customer-controlled option:** keep the self-hosted and "your own database" modes as they are, for pharmacies that do not want Medoro to hold their records.

## 3a. Conflict resolution (reuse what exists; add nothing new)

- Master data (medicines, suppliers, customers, prices): optimistic `version`; a save based on an older version is refused.
- Offline operations: each carries a ULID, the device id and a base version. On reconnect the server revalidates price, permission and stock and either posts the operation or records a `conflict` for a person to resolve. Counters sell from a **reserved stock quota** per batch, which bounds oversell while offline.
- Invoice numbers: per-branch, per-fiscal-year sequences issued by the server. An offline counter uses a pre-allocated series (`resumeNumbering` exists in DriveDB) so numbers never collide; reconciliation on replay.
- Nothing is ever silently overwritten: a rejected operation stays visible as a conflict.

## 4. Migration of one pharmacy (per-pharmacy, reversible until the final step)

There is a move **from** Medoro's copy **to** Drive (`src/domain/system/drive-move.ts`: `startMove`, `completeMove`, `undoMove`, `deleteMedoroCopy`, with checks and a 7-day grace). There is **no reverse mover**. It must be built, mirroring that design:

1. **Eligibility and consent.** Owner opts in; consent recorded; subscription in good standing; all devices on a compatible version.
2. **Freeze.** The pharmacy's counters go read-only for a short, announced window. No new bills are accepted anywhere.
3. **Export.** From the most recent complete device snapshot plus change log in Drive (`restoreFromDrive`, `pullChanges`), reconstruct the full database on a staging worker.
4. **Import.** Load into the tenant's PostgreSQL rows through the same validation as the existing import and restore paths (never raw SQL). Append-only tables are written once.
5. **Verify before cut-over (all must pass, otherwise abort and unfreeze):**
   - row counts per table equal the source; per branch;
   - trial balance equal: total debits = total credits, and each ledger account's balance equals the source;
   - stock: per batch quantity equals the source; sum of movements equals batch quantity;
   - sales: count, total taxable and GST per month equal; every invoice number present exactly once; the next invoice number continues each series;
   - customers' balances and consent records equal; supplier balances equal;
   - the audit chain verifies from its first event (`verifyAuditChain`).
6. **Cut-over.** Flip the tenant to server-authoritative; devices re-pair as offline-queue clients and discard their old authority; Drive switches to backup-only.
7. **Keep the Drive copy untouched** for a fixed rollback window (suggest 30 days), then archive.
8. **Rollback within the window:** freeze, export from PostgreSQL back to the device/Drive format (the existing `moveExport` is the model), verify the same checks, flip back. After the window, rollback needs a new migration.

## 5. Phases

| Phase | Output | Exit test |
|---|---|---|
| 0 | RLS on in production; capacity model; privacy review signed | Two-tenant suite green against the non-owner role; counsel sign-off |
| 1 | Reverse mover for **one internal test pharmacy**, with the checks in 4.5 as automated tests | The checks pass on a real DriveDB export; a deliberately corrupted export is rejected |
| 2 | Offline-queue client mode for devices (replay, conflicts, series) | Offline sales replay with zero lost or duplicated invoices in a fault-injection test |
| 3 | Pilot with a few volunteer pharmacies | A month of operation; owner sign-off; no data discrepancy |
| 4 | New hosted signups default to server-authoritative; existing pharmacies migrate on request | |

## 6. Risks

- **Invoice-number collisions** between a stale device and the server: mitigated by server-issued sequences, pre-allocated offline series, and refusing replay from a device whose version is too old.
- **Devices on old builds** continuing to treat Drive as authoritative: the server must refuse them once the tenant flips.
- **Scale and noisy neighbours:** per-tenant limits, connection pooling, and RLS overhead need measuring.
- **Data protection duties** move to Medoro as a data holder (breach notification, retention, erasure). Existing erasure and export features apply but must be re-reviewed.
- **Support access:** Medoro staff must have no standing access (existing support-grant model) to records that are now on Medoro's servers.

## 7. What stays the same

Optional encrypted Google Drive backup; the self-hosted modes; the append-only ledgers; the audit chain; the role and branch permission model; the consent model.

## 8. Alternative (option A): keep Drive/SQLite authoritative for hosted

Then every server-side module must run on-device or on aggregates the device chooses to send, and each needs a DriveDB port (several already exist under `src/drivedb/`). This keeps the privacy promise and a small server database, and costs a second implementation of each analysis. It is a legitimate choice if the data-stays-with-the-pharmacy promise is the product's core.

## 9. Decision needed from the owner

Choose **A** (keep) or **B** (this plan) for the hosted default. Recommendation: **B**, but only after phase 0, because every server module in Medoro 2.0 (and any future one) depends on it, and B is what the "single authoritative database" requirement describes. B is a change to a promise made to customers; it must not be made silently.

## 9. Audit of what stays on Medoro's server for a Drive-mode pharmacy (option A in practice)

Method: read the code (`drive-move.ts`, `restore.ts`, `retention.ts`, `daily.ts`, `customer-pay.ts`) and the table list of a freshly migrated database. **No production data was queried**, so this says what the code allows, not what the live database holds today.

**Deleted 7 days after the move** (once Drive holds a full copy saved after the move): every pharmacy-owned table except the control plane below: bills, stock, customers, suppliers, accounts, audit trail, messages, compliance, forecasts, recalls, stored files.

**Stays by design (control plane):** the `Tenant` row (code, name, legal name, GSTIN, phone, `settings`), `User`, `Role`, `Invite`, `RecoveryCode`, `SupportGrant`, `Branch`, `Counter`, `Device`, `DriveDevice`, `SubscriptionMeta`, `OnlinePayment` (Medoro's own subscription invoices, incl. buyer email), `Integration` (connection config and encrypted secrets), `BackupManifest` (metadata), `RestoreRun`, `LicenceOutbox`, `IntegrationHealth` (status only), `Session` (IP and user agent, ended sessions deleted after 30 days).

**Gaps found, and what was done:**

| Finding | Action |
|---|---|
| `WaMessage` keeps a customer's mobile number and message text; the old rule redacted them only after 1 year, and the one-time purge does not cover rows created afterwards | Drive-mode pharmacies: finished messages are redacted after **7 days** (`DRIVE_MESSAGE_DAYS`); a message still queued keeps its number until sent. Tested. |
| Daily compliance, forecast and audit-check jobs ran for Drive pharmacies | They are skipped for them. Tested. |
| `PaymentInbox` holds customer payments until the device collects them | Not a gap: rows are sealed to the device's key and deleted when the device acknowledges them (`customer-pay.ts`). Left as is. |
| `Tenant.settings` is free-form | Checked every key present in the test databases and every write in code: thresholds, templates, loyalty and CRM switches, report-mail recipients, UPI id, Tally names, pharmacist name/registration, language. Configuration, not bills, stock or customer records. Not enforced by a schema, so a future key could add data. |

**Partly done:** the demand forecast now runs on the counter too (see `docs/MEDORO_2.md` section 11). The other Medoro 2.0 analysis screens still run only on PostgreSQL, so a Drive pharmacy sees an explanatory note instead of numbers. Each needs a device version (several older ones exist in `src/drivedb/`; the counter already has demand forecast, reorder drafts, supplier price comparison and margins in `insights.ts`). That is a separate piece of work per module.
