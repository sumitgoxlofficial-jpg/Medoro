# Medoro DriveDB — phase-by-phase plan

**Goal:** each pharmacy's business data lives only in that pharmacy's own Google Drive, like WhatsApp
chats live on the phone and in the user's Drive. Medoro's server keeps only what it needs to run the
service (sign-in, subscription, partners), so the Medoro database stays small no matter how many
pharmacies join.

Status: plan only. Nothing here is built yet. Each phase ends with something that works and can ship
on its own, behind a per-pharmacy switch ("Drive mode"), so existing pharmacies keep working until
they are moved.

---

## 1. How it works (the corrected diagram)

```
 Pharmacy device (browser / desktop app)              Owner's Google Drive  (Medoro/<pharmacy>/)
 ┌─────────────────────────────────────┐              ┌──────────────────────────────────────┐
 │ Next.js screens                     │              │ pharmacy.db.enc   ← full snapshot     │
 │   │                                 │   upload /   │ transactions/     ← small change logs │
 │ DriveDB SDK  (select/insert/...)    │   download   │ storage/          ← bills, photos     │
 │   │                                 │ ───────────▶ │ manifest.json     ← what is where     │
 │ Local SQLite (the working database) │              │ encryption-meta.json ← wrapped keys   │
 │   │                                 │              └──────────────────────────────────────┘
 │ Sync engine (change log, conflicts) │
 └──────────────┬──────────────────────┘
                │  encrypted blobs only, nothing stored
 ┌──────────────▼──────────────────────┐
 │ Medoro server (Vercel)              │   Medoro database (Supabase) keeps ONLY:
 │  sign-in, Drive token broker,       │   accounts & logins, subscription & payments,
 │  live relay between counters,       │   partners & payouts, device list,
 │  WhatsApp / e-invoice / AI gateway  │   Drive folder id per pharmacy
 └─────────────────────────────────────┘
```

Three rules that make this work:

1. **The database runs on the device.** Google Drive is storage, not a database; it can't run a
   search or a stock query. Each device has its own SQLite copy and works on that (fast, works
   offline).
2. **Drive gets small change logs, plus a periodic full snapshot.** Every bill, purchase or edit is
   written as a small encrypted file in `transactions/`. Every so often the device writes a fresh
   `pharmacy.db.enc` and old logs are tidied up. Uploading the whole database every second would be
   slow and hit Google's limits.
3. **Staff never get the owner's Google password or Drive access.** The server holds the owner's
   Drive token (as it already does today for backups) and passes encrypted blobs between staff
   devices and the owner's Drive. The server cannot read them and keeps no copy.

---

## 2. Every part, one by one

### 2.1 Local database (on the device)
- **Browser:** official SQLite WebAssembly build, stored in OPFS (the browser's private file area).
  Works in current Chrome/Edge on Android and desktop.
- **Desktop app (Tauri):** native SQLite file on disk — faster and safer for busy counters.
- **Schema:** the current 84 Prisma tables are split (see 2.10). Tenant tables are translated to
  SQLite: money stays in paise (integers), dates as ISO text, JSON as text, `tenantId` columns
  dropped (one file = one pharmacy).
- **Migrations:** numbered SQL files shipped with the app; the database stores its version and
  upgrades itself on open. Snapshot files carry the version too, so an old device can't overwrite a
  newer database.
- **Audit trail:** the append-only `AuditEvent` and `StockMovement` rules become SQLite triggers.

### 2.2 DriveDB SDK (what the screens call)
A small TypeScript API in the style of Supabase, so screen code stays simple:
```ts
const { data } = await drive.from("medicine").select("*").ilike("name", "%para%").limit(20);
await drive.from("sale").insert(bill);                 // writes locally + queues a change
await drive.transaction(async (tx) => { ... });       // all-or-nothing, like Postgres
await drive.storage.upload("bills/INV-1042.pdf", file);
drive.on("sale", (change) => refresh());              // live updates from other counters
```
- Filters: `eq, neq, gt, gte, lt, lte, like, ilike, in, is`, `order`, `limit`, `range`.
- Every write goes through one function that (a) changes SQLite and (b) appends a change record —
  so nothing can be saved without being synced.
- The existing domain functions (`src/domain/...`) are reused where possible: they are rewritten to
  take a database handle, so the same billing/stock/GST rules run on the device.

### 2.3 Change log format (`transactions/`)
- One record per change: `{ id, device, clock, table, rowId, op: insert|update|delete, columns }`.
- `clock` is a hybrid logical clock (time + counter + device id), so changes from different counters
  sort the same way everywhere.
- Records are batched into files of a few seconds' work: `transactions/<device>/<clock>.log.enc`.
- Stock is never written as "stock = 40"; it is written as movements ("−2 strips, batch B12"). Two
  counters selling at once both apply cleanly.

### 2.4 Sync engine
- **Push:** every few seconds while online, upload pending log files to Drive (through the server
  broker, see 2.6). Offline? They wait in the local queue (today's offline billing queue becomes
  this).
- **Pull:** read new log files from other devices, apply in clock order.
- **Snapshot:** one device (the owner's main counter) writes `pharmacy.db.enc` daily or every N
  changes, then logs older than the snapshot are archived.
- **New device:** download latest snapshot, then apply logs after it.
- **Conflict rules:**
  - Stock: movements add up, never overwritten. If stock goes negative (two counters sold the last
    strip offline), the bill stands and a "stock mismatch" task appears for the owner.
  - Invoice numbers: each counter has its own series (`MAIN-C1-0001`), so numbers never clash.
  - Same field edited on two devices (e.g. medicine price): latest clock wins, and the loser is
    kept in history.
  - Deletes: soft delete (a flag), so a late edit can't bring a row back by accident.

### 2.5 Drive folder layout
```
Medoro/<pharmacy name>/
  manifest.json            schema version, latest snapshot, devices, last log per device
  encryption-meta.json     data key wrapped for the owner's recovery kit and each device
  pharmacy.db.enc          latest full snapshot
  snapshots/               last 7 daily snapshots (history / undo)
  transactions/<device>/   change log files
  storage/                 bills, invoices, prescriptions, supplier bills (already used today)
```
- Uses the `drive.file` permission (Medoro sees only files it created), same as today.

### 2.6 Google Drive access (token broker)
- The owner connects Drive once (already built for backups). The server keeps the refresh token,
  encrypted, as today.
- Devices ask the server for a short-lived access token scoped to that one folder's work, or send
  blobs to the server which forwards them. Staff devices never see the owner's Google account.
- If the owner disconnects Drive or the token expires, devices keep working offline and show a
  "reconnect Google Drive" banner to the owner.

### 2.7 Encryption and keys
- One random **data key** per pharmacy encrypts the snapshot, logs and files (AES-256-GCM).
- The data key is stored in `encryption-meta.json` only in wrapped form:
  - wrapped with the owner's **recovery kit** key (the kit pharmacies already download), and
  - wrapped with each approved **device key** (created on the device, never leaves it).
- Approving a new staff device = owner's device wraps the data key for it. Removing a staff member
  = remove their wrapped key and rotate the data key.
- Result: Google can't read the data, Medoro can't read it, only the pharmacy's approved devices.

### 2.8 Live updates between counters (relay)
- Vercel can't hold open connections, so live updates use a small pass-through channel (e.g.
  Supabase Realtime broadcast, which stores nothing) carrying "device X has new changes" pings and
  small encrypted change batches.
- If the relay is down, counters still sync through Drive every few seconds — just slower.

### 2.9 Sign-in, roles, branches
- Sign-in stays on the server (password, Google, email code — as today).
- Roles and permissions are checked on the device (from the synced `Role` table) and the server only
  checks "is this user allowed to use this pharmacy and this device".
- Multi-branch: one database per pharmacy, `branchId` column kept; each device syncs all branches it
  is allowed to see. Very large chains can later get one file per branch.

### 2.10 What stays on Medoro's server vs. moves to Drive

| Stays on server (needed to run Medoro) | Moves to the pharmacy's Drive |
|---|---|
| Tenant (name, plan, Drive folder id), User logins, Session, Invite, LoginAttempt, RecoveryCode, AuthCode, OtpCode, RateLimit | Branch, Counter, Role, Medicine, Batch, StockMovement, StockCount, Transfer, StockOut, Recall, MedicineRack, Doctor |
| Device (approved devices list), SubscriptionMeta, LicenceOutbox, Coupon | Sale, SaleItem, Payment, HeldCart, SalesReturn, SaleVoid, DiscountApproval, Shift |
| StaffUser, StaffSession, StaffBank, StaffPayout, StaffAudit (Medoro team & partners) | Supplier, SupplierBill, SupplierItemMap, SupplierClaim, PurchaseOrder(+Item), Grn(+Item), ScanDocument |
| CpSetting, CpCustomer, CpBillingEvent, CpNote, CpSale, CpOnlinePayment, Lead, LeadLog | Customer, ConsentRecord, LoyaltyLedger, Campaign, WaMessage history |
| Ticket, TicketMessage, RemoteAccessRequest, SupportGrant, RestoreRun | Voucher, LedgerLine, Cheque, BankStatement, BankLine, Sequence, EInvoice records |
| Integration (encrypted tokens only), short-lived inboxes (see 2.11) | DeliveryOrder(+Item), DeliveryEvent, RiderSettlement, AuditEvent, AiAsk, AiConfirmation |
| | FileObject / BackupManifest → replaced by Drive `storage/` and `snapshots/` |

### 2.11 Integrations
- **WhatsApp, email:** device asks the server to send; server forwards and forgets (no message copy).
- **Customer online payments (Razorpay):** Razorpay's webhook reaches the server while the pharmacy
  may be offline, so the server keeps a tiny encrypted **inbox** entry until a device picks it up,
  then deletes it.
- **E-invoice / GST portal:** device sends the invoice through the server gateway; the IRN comes back
  to the device and is stored in Drive.
- **AI assistant:** device sends only the question plus the few rows needed; nothing is stored.
- **Medoro subscription payments:** unchanged — stays on the server.

### 2.12 Support access
- Today support can open a pharmacy's data with a grant. In Drive mode, support sees nothing unless
  the owner shares a temporary key from their device (time-limited, logged on both sides).

---

## 3. Phases

Each phase: what we build, what "done" means, and the main risks. Estimates are for one developer
working with me; they overlap a little.

### Phase 0 — Groundwork and proof (1 week)
- Build a throwaway test page: SQLite WASM in OPFS on a cheap Android phone, insert 50,000
  medicines + 200,000 sale lines, measure search and bill speed.
- Upload/download an encrypted 50 MB file to Drive via the existing token; measure time.
- Decide: browser-only vs. push the desktop app for counters.
- **Done when:** numbers are written down and we agree it's fast enough on the phones pharmacies use.
- **Built:** owner-only page **App → Backup → "Test this device"** (`/app/lab`). It runs in a background
  worker (`public/drivedb/bench-worker.mjs`) using SQLite WebAssembly in OPFS, then uploads/downloads an
  encrypted snapshot to the owner's Drive using a short-lived token. Medoro's server sees no test data.
- **First result** (headless Chromium, 4-core Linux, large pharmacy: 50,000 medicines, 1 lakh batches,
  2 lakh bill lines): search 2 ms, stock of one medicine 3 ms, save a bill 64 ms, day total 1 ms,
  full stock report 0.46 s, building the sample database 11 s. Still needed: real Android phones,
  counter PCs, and the Drive upload/download numbers.
- **Risk:** older phones/browsers without OPFS → fall back to IndexedDB storage (slower) or require
  the desktop app.

### Phase 1 — Local database + DriveDB SDK (2–3 weeks)
- SQLite schema for medicines, batches, stock movements, sales, payments, customers.
- Migrations runner, the SDK (`from().select/insert/update/upsert/delete`, filters, transactions).
- Change capture: every write appends a change record.
- Unit tests that run the same domain rules on SQLite as on Postgres.
- **Done when:** a test pharmacy can bill and see stock entirely from local SQLite, with every write
  producing a change record.
- **Progress (first slice, built):**
  - `src/drivedb/` — `engine.ts` (SQLite wrapper, nested transactions), `schema.ts` (tables + append-only
    migrations; bills and stock movements blocked from edit/delete by triggers), `hlc.ts` (device clock),
    `client.ts` (the SDK: `from().select/eq/neq/gt/gte/lt/lte/like/ilike/in/is/order/limit/range`,
    `insert/update/upsert/delete` with soft delete, change log in the same transaction, per-counter
    sequences), `pharmacy.ts` (add medicine, receive stock, search, stock levels, billing with FEFO,
    loose units, GST, Schedule H/H1, discount ceiling, split and credit payments, per-counter GST
    invoice series, day totals).
  - Runs in the browser in a worker on OPFS (`device.worker.ts`, `device.ts`) and in Node for tests.
  - Preview on App → Backup → "Test this device": "Try billing on this device" (sample data).
  - Tests: `src/drivedb/drivedb.test.ts` (17) and `e2e/17-device-db.spec.ts`.
  - Second slice (`src/drivedb/trade.ts`, migration 2): customers (search by phone/name, credit balance,
    payments received), suppliers and purchase bills (paid + free packs into stock, GST, no duplicate
    bill numbers), sales returns as credit notes (share paid after discount, restock only sealed and
    unexpired goods, never more than sold, per-counter credit note series). Tests: `trade.test.ts`.
  - Next in Phase 1: the counter screen reading from the device database behind the "Drive mode" switch.

### Phase 2 — Drive storage, encryption, keys (2 weeks)
- Folder layout, `manifest.json`, `encryption-meta.json`, snapshot write/read, change-log files.
- Token broker endpoint on the server; data key + recovery kit wrapping + device keys.
- "Restore from Drive" on a brand-new device using the recovery kit.
- **Done when:** wipe the browser, sign in, enter recovery kit → the full pharmacy comes back from
  Drive; Medoro's DB holds no sale/stock rows for that pharmacy.
- **Risk:** owner loses both device and recovery kit → data is gone (same as WhatsApp). Make the kit
  step unskippable and remind every month.

### Phase 3 — Single-counter pilot in "Drive mode" (2–3 weeks)
- Per-pharmacy switch. In Drive mode: billing, stock, medicines, customers, day-end run on the device.
- Background sync to Drive every few seconds; offline queue reused.
- Sign-up option "Keep my data in my Google Drive" for new pharmacies.
- **Done when:** one real pharmacy (yours first) runs a full week on one counter in Drive mode, with
  daily snapshots in Drive and nothing in Medoro's tables.

### Phase 4 — Multiple counters, staff, live sync (3–4 weeks)
- Hybrid clocks, pulling other devices' logs, conflict rules, per-counter invoice series.
- Device approval flow (owner approves a staff phone/PC), staff removal + key rotation.
- Live relay for instant updates; falls back to Drive polling.
- **Done when:** 3 counters bill the same medicine at once (one offline) and all end with the same
  stock and no lost bills; removed staff device can't read new data.
- **Risk:** negative stock after offline sales — handled as an owner task, not blocked.

### Phase 5 — Move every other screen (4–6 weeks, can be split)
In this order, each shippable alone:
1. Purchases: suppliers, purchase orders, GRN, supplier bills, scan documents.
2. Accounts: vouchers, ledger, cheques, bank statements & matching.
3. GST: GSTR-1/3B reports, e-invoice records (gateway on server).
4. Reports and dashboard.
5. Delivery orders, riders, loyalty, campaigns, recalls, transfers between branches.
6. Audit log, AI assistant history.
- **Done when:** with Drive mode on, no screen reads or writes tenant tables on the server (checked
  by a test that fails if any tenant table gets a row).

### Phase 6 — Integrations in Drive mode (1–2 weeks)
- WhatsApp/email send-and-forget, Razorpay customer-payment inbox, e-invoice gateway, AI gateway.
- **Done when:** a customer pays by UPI link while the pharmacy is offline, and the payment appears
  on the bill when the counter comes back online; the inbox entry is deleted.

### Phase 7 — Move existing pharmacies (1–2 weeks)
- Owner clicks "Move my data to my Google Drive": server exports that pharmacy into a SQLite file,
  encrypts it with a new data key, uploads to their Drive, device downloads and checks row counts
  and totals.
- 7-day safety period: server copy kept read-only; then deleted (owner can confirm earlier).
- **Done when:** the demo pharmacy and one real pharmacy are moved, totals match to the paisa, and
  their rows are gone from Supabase.

### Phase 8 — Clean-up and launch (1 week)
- Drive mode becomes the default for new sign-ups; old server-side backup code retired.
- Update privacy policy, data-ownership page, help pages ("your data is in your Drive").
- Monitoring: sync errors, Drive quota/token failures, devices not synced for 3+ days (alert owner).
- **Done when:** Supabase only holds the "stays on server" tables for Drive-mode pharmacies.

**Total: about 4–5 months** of steady work. Phases 0–3 (about 2 months) give a working single-counter
Drive-mode pharmacy you can start selling.

---

## 4. Testing at every phase
- Same domain tests run against Postgres and SQLite until the move is finished.
- Sync tests with simulated devices: random offline periods, random order of arrival — every device
  must end with identical data.
- Restore drills: wipe device → recover from Drive + kit, every release.
- Playwright end-to-end: bill on two browser profiles at once, check both.

## 5. Risks to accept up front
| Risk | What we do |
|---|---|
| Owner loses phone **and** recovery kit | Data can't be recovered (by design). Unskippable kit step, monthly reminder, optional second kit holder. |
| Owner's Drive is full | Warn at 80%; logs keep queueing locally; snapshots compressed. |
| Owner deletes the Medoro folder in Drive | Device still has the full copy and re-uploads it; warn owner. |
| Google API limits or outage | Batch uploads; devices keep working offline and catch up. |
| Support can't see data | Owner-shared temporary key (2.12). |
| Google app verification for Drive access | Needed before public launch — the OAuth consent screen must be published (already pending on your side). |
| Reports across all pharmacies (for you as Medoro) | Only counts the device chooses to report (e.g. bills per day, no amounts or names). |

## 6. What you need to do
- Publish the Google OAuth consent screen (needed for Drive access by all pharmacies).
- Choose the pilot: your own pharmacy first (Phase 3).
- Decide Phase 0's outcome with me: browser-only, or desktop app for counters.
