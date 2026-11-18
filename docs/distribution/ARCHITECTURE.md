# Architecture and database design

## 1. Two products, one codebase, one database engine

```
                         ┌──────────────────────── Next.js 15 app (one deployment) ────────────────────────┐
 Pharmacy staff  ──▶  /app/*     MEDORO Pharmacy (unchanged)                                                  │
 Distributor staff ─▶ /dist/*    MEDORO Distribution ──┐                                                      │
 Chemists ──────────▶ /portal/*  Chemist portal ───────┤  src/domain/distribution/*  (rules + services)        │
                                                       └─▶ shared services: purchasing (GRN), claims, cheques,  │
                                                           receipts, ledgers, bank recon, GST builders, audit,  │
                                                           sequences, backup/restore, licensing                │
                         └──────────────────────────────────────────┬─────────────────────────────────────────┘
                                                                    ▼
                                                     PostgreSQL 16 / Supabase (one schema)
```

* `Tenant.product` decides the product. `/app` redirects a distribution tenant to `/dist`; `/dist` sends a pharmacy
  tenant to `/app`. Sign-in, MFA, sessions, invites, audit and licensing are shared.
* Distribution permissions are computed by `distCtxFrom()` from the user's role (`DIST_PERMS`), so pharmacy roles and
  screens never change. Distribution roles: Owner, Manager, Accountant, Billing, Warehouse, Salesman, Delivery.
* Every distribution service takes a `Ctx` (tenant, user, godowns, permissions) and filters by `tenantId` and the
  user's godowns. There is no query in `src/domain/distribution` without a tenant filter.
* Pure business rules live in `src/domain/distribution/rules/*` (no database, unit-tested): wholesale GST pricing,
  schemes, credit control, expiry eligibility and loss, FEFO allocation with reservations, FIFO ageing, licence
  checks, the order state machine and analytics.

## 2. Database design

All amounts are integer **paise** (`BigInt`); rates are per pack ex-GST; stock is in stock units (`Batch.qtyAvailable`).

### Reused tables

| Table | Role in Distribution |
|---|---|
| `Tenant` (+`product`) | The distributor |
| `Branch` | A godown (code = invoice series) |
| `Medicine` | Product master (HSN, GST rate, MRP, pack) |
| `Batch`, `StockMovement`, `MedicineRack`, `Transfer` | Batch-wise stock per godown, movement ledger, rack placement, godown transfers |
| `Supplier`, `PurchaseOrder(Item)`, `Grn(Item)`, `SupplierBill` | Purchasing |
| `SupplierClaim`, `StockOut` | Expiry / breakage claims and supplier returns |
| `Customer` | The chemist's ledger party (balances live on `Sundry debtors` with `partyId`) |
| `Voucher`, `LedgerLine` | Books |
| `Cheque`, `BankStatement`, `BankLine` | Cheques and bank reconciliation |
| `AuditEvent`, `Sequence`, `Role`, `User`, `Session`, `SubscriptionMeta` | Shared platform |

### New tables

| Table | Purpose | Key constraints |
|---|---|---|
| `DistCompany` | Manufacturer / marketing company | unique (tenant, name) |
| `DistPrincipal` | Stockist agreement with a company: supplier, margin, **claim window before/after expiry, credit %** | unique (tenant, company) |
| `DistProduct` | Wholesale terms of a `Medicine`: PTR, PTS, company, division, minimum order, portal visibility | PK = medicineId; CHECK prices ≥ 0 |
| `DistSpecialRate` | Chemist-specific net rate, optional expiry | unique (tenant, customer, product) |
| `DistScheme` | Free goods (buy X get Y) or extra discount, product or company wide, dates, min qty, optional chemist list | CHECK validTo ≥ validFrom, 0 ≤ disc ≤ 100 |
| `DistTerritory`, `DistSalesman` | Beats, salesmen, monthly targets, field-app user link | unique codes |
| `DistChemist` | Wholesale profile of a `Customer`: Form 20B/21B licences + validity, credit days, grace, price tier, status (active/hold/blocked), KYC verification, portal link | PK = customerId |
| `DistRack` | Rack master per godown with pick order and cold-chain flag | unique (godown, code) |
| `DistOrder`, `DistOrderLine` | Customer orders (portal/salesman/phone/office) with credit snapshot, override, idempotency key | unique (tenant, no), (tenant, idempotencyKey); CHECK qty > 0 |
| `DistPickList`, `DistPickLine` | Batch-wise picking; **open pick lines are stock reservations** | one pick list per order; CHECK units > 0 |
| `DistInvoice`, `DistInvoiceLine` | GST tax invoice (rate ex-GST, discount, free goods, CGST/SGST or IGST, round-off, cost) | **append-only trigger**; unique (tenant, no), (tenant, idempotencyKey) |
| `DistInvoiceCancel` | Same-day cancellation record with its reversing voucher | **append-only** |
| `DistReturn`, `DistReturnLine` | Credit notes (condition saleable / expired / damaged, credit %) | **append-only**; CHECK 0 ≤ credit % ≤ 100 |
| `DistDispatch`, `DistDelivery` | Van/route trips; per-invoice delivery with proof of delivery and cash collected | one delivery per invoice |
| `DistCollection` | Field / delivery collections linked to their receipt voucher | **append-only** |
| `DistChemistAccount`, `DistPortalSession` | Chemist portal accounts and sessions (platform-wide: one chemist, many distributors) | unique email, phone |
| `DistConnection` | A chemist's request to buy from a distributor; approval links it to the distributor's `Customer` | unique (tenant, account) |

Row-level security is **enabled on every new table** (deny-by-default for a hosted data API such as Supabase
PostgREST); the app connects with its own role. `scripts/rls-policies.ts` generates tenant-isolation policies for all
tenant tables, including the new ones, when a deployment wants per-transaction RLS.

## 3. Transaction rules

* **Order approval** (`approveOrder`): one transaction — advisory lock on the order → credit check re-run → `SELECT … FOR UPDATE`
  on every batch of the ordered products in that godown, in id order (no deadlocks) → current reservations read *after*
  the lock → FEFO allocation in whole packs, skipping batches under the minimum shelf life → pick lines written.
  Two approvals competing for the same batch are serialised by the row locks; the second sees the first's pick lines.
  (Integration test: six concurrent approvals for 60 packs against 50 in stock → exactly five succeed, 50 reserved.)
* **Invoicing** (`invoiceOrder`, `directInvoice`): batch rows locked, stock checked again, `Batch.qtyAvailable`
  decremented with a `StockMovement` per batch, invoice number from a per-godown per-FY sequence, balanced sales
  voucher (Dr Sundry debtors / Cr Sales, Output CGST+SGST or IGST, Round off), delivery opened, audit written.
  Idempotency keys make retries safe (unique constraint + replay).
* **GST**: line taxable = rate × qty − discount; tax = round(taxable × rate%); CGST = ⌊tax/2⌋, SGST = remainder, or
  all IGST when the chemist's state differs from the godown's GSTIN state; invoice rounded to the rupee on its own line.
  Free goods carry no value or tax.
* **Credit notes**: credit = the line's value per pack (paid and free packs share it) × the agreed credit %;
  GST reduced in proportion; saleable stock returns to its batch, expired/damaged stock goes to the batch's quarantined
  quantity for the principal claim.
* **Immutability**: invoices, invoice lines, cancellations, credit notes and collections are append-only at the
  database (trigger), like vouchers, ledger lines and stock movements. Corrections are cancellations (same day),
  credit notes and reversing vouchers.
* **Receivables**: bill-wise outstanding is derived FIFO from the ledger balance (payments clear the oldest bills), so it
  always agrees with the books, including opening balances, credit notes and bounced cheques.

## 4. Security model

| Concern | Control |
|---|---|
| Tenant isolation | Every query filtered by `tenantId`; godown access via `ctx.branches`; integration tests with two distributors |
| Permissions | `distAuthorize()` on every change; view checks on every screen; read-only support sessions can't change anything; lapsed subscriptions block business changes but keep viewing |
| Salesmen | Book orders and collect only for chemists assigned to them |
| Chemist portal | Separate cookie (`medoro_portal`, path `/portal`), hashed session tokens, Argon2id, lockout after 5 failures, IP rate limits; every read goes through `portalLink()` (approved connection required) and is scoped to the chemist's own `customerId` |
| Distributor-controlled exposure | Products hidden per product; stock shown exact / as a band / not at all; schemes and MRP optional |
| Consent | Registration consent with version; licence/GST details shared only with distributors the chemist asks to connect to (`shareKyc`) |
| Financial integrity | Append-only triggers, balanced-voucher check, CHECK constraints, idempotency keys, row locks |
| Audit | Every master change, approval, override (with reason), invoice, cancellation, credit note, claim and collection |
| AI | Read-only statistics over the tenant's own data; the only write is a **draft** purchase order a person must place |
| Backups | Distribution tables are included in the existing encrypted per-tenant backups and deletion |
