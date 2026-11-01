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
  - Third slice: **Drive mode pilot.** Owner switch on the device test page (audited); a "Billing on this
    device" screen (`/app/device-pos`: search/scan, packs and loose, customer, Schedule H/H1 fields,
    discount within the role's cap, cash/UPI/card/credit, F2/F9, recent bills, today's total). The owner
    loads this branch's catalogue, stock and customers onto the device once (`deviceSeed` → `importSeed`,
    same ids as the server, audited); each device gets its own invoice series (D + 4 characters).
    In the pilot, device bills stay on the device (queued for Drive) and the server's stock isn't touched.
  - **Phase 1 is complete.**

### Phase 2 progress (built)
- `src/drivedb/crypto.ts`: data key (AES-256-GCM), purpose-bound sealed files, a 52-character Drive recovery
  code made on the device (never sent to Medoro), device keys that can't be exported (IndexedDB).
- `src/drivedb/drive.ts`: the DriveDB folder as a file store (Google Drive API directly from the device with a
  short-lived token; multipart and resumable uploads, paging). `src/drivedb/sync.ts`: set up, unlock (device
  key or recovery code), upload change logs every ~10 s, full encrypted copy every 6 h or on demand, tidy old
  logs, restore = latest copy + later logs (new device gets its own invoice series).
- Server: `deviceDriveAccess` (token + Medoro/<pharmacy>/drivedb folder), owner only, Drive mode only.
- Screens: Google Drive panel on "Billing on this device" (set up → save the recovery code; unlock; last upload,
  last full copy, save now); "Restore from Google Drive" on an empty device.
- Tests: crypto/sync/drive unit tests, `e2e/19-drive-restore.spec.ts` (fake Google Drive in the browser test:
  set up, bill, wipe, wrong code refused, restore with the code).

### Phase 3 progress (built)
- The device counter is one app with tabs (`src/components/device/`): **Billing** (bill opens ready to print,
  80 mm GST tax invoice with pharmacy name, address, GSTIN, DL, batch and expiry), **Bills & day-end** (day
  summary by payment mode, refunds, money received from credit customers, cash in drawer, purchases; print
  day-end; find a bill; reprint; return from a bill as a credit note), **Stock** (stock, low-stock filter,
  nearest expiry, add and edit medicines), **Purchases** (enter a supplier's bill: batches, expiry, packs, free,
  rate, MRP), **Customers** (add, what each owes, receive payment), **Counter** (owner: counter PIN).
- **Works with no internet:** `medoro.in/device` opens without signing in, unlocked with the counter PIN
  (salted hash on the device, 5 wrong tries = 5 min lock). The service worker keeps that page and the SQLite
  build; the old offline page links to it on Drive mode counters.
- The catalogue copy now carries the pharmacy's bill details and the owner's name for offline bills.
- Reports on the device: `src/drivedb/reports.ts` (bill detail, day-end, bill search, stock list, customers,
  suppliers, medicine edits). Tests: `reports.test.ts`, `e2e/20-device-counter.spec.ts` (stock in, customer,
  credit bill, part payment, return, day-end totals, PIN, billing with the browser offline).
- Still to do in phase 3: the "keep my data in my Google Drive" choice at sign-up (after the pilot week).

### Phase 4 progress (built)
- **Sync between counters** (`src/drivedb/sync.ts`): each device uploads its own change files and applies every
  other device's, merged across devices in clock order; a cursor per device; the full copy records how far into
  each device's changes it reaches; change files are kept 7 days, and a counter behind deleted files is told to
  "catch up" (restore, keeping its unsent bills). Restored devices carry on their own invoice numbers.
- **Field-by-field merging** (migration 3, `fieldClock`): two counters editing different fields of the same
  medicine both win; the same field: the later clock wins everywhere. Stock stays movement-based.
- **Keys** (`src/drivedb/keyring.ts`): recovery code → pharmacy key → versioned data keys; owner devices hold the
  pharmacy key, staff devices only data keys; each device has an RSA-OAEP pair (private key not exportable).
  Removing a device starts a new data key it never gets.
- **Relay** (`src/domain/system/drivedb-relay.ts`, `/api/drivedb`): every device (owner too) reaches Drive through
  Medoro, which uses the pharmacy's Drive access and stores nothing; files by name inside the drivedb folder only;
  each device writes and deletes only its own change files; only owner devices write keys, index and full copy;
  3 MB pieces (Vercel limit) with sealed upload tokens. The owner's Google token no longer goes to browsers.
- **Devices** (`DriveDevice` table: public key and status only): owner devices join at once; staff devices ask and
  wait; the owner approves (their device gives it the keys) or removes it (new key) under Counter → Devices.
  A staff device then sets itself up from Drive without the recovery code. Sync every 5 seconds; "Sync now".
- Tests: `sync.test.ts` (3 counters, one offline, same stock and all bills; field merge; approve/remove; 7-day
  tidy-up; numbering after restore), `drivedb-relay.test.ts` (rules), `e2e/21-multi-counter.spec.ts` (owner +
  staff browsers). Browser tests use an in-memory Drive on the test server (`E2E_FAKE_DRIVE`, refused on Vercel).
- Not done yet: instant push between counters (now ~5 s polling), a "stock went below zero" task for the owner.

### Phase 5 progress (slice 1 built: accounts, reports, GST)
- `src/drivedb/books.ts` (migration 4: `supplierPayment`, `expense`): supplier dues and ledger, paying suppliers
  (never more than owed), shop expenses, the day's cash book; day-end cash in drawer now subtracts cash paid to
  suppliers and cash expenses.
- Reports: sales by day with gross profit (net of returns), best sellers, stock expiring within 90 days; CSV.
- GST from the device: GSTR-1 (offline-tool JSON + CSV), GSTR-3B (JSON + CSV, ITC from purchase bills: CGST/SGST
  same state, IGST other states) and the HSN summary, built with the server's own builders (`src/domain/gst`).
- Screens: **Accounts** and **Reports & GST** tabs. Tests: `books.test.ts`, `e2e/22-device-books.spec.ts`.
- Slice 2 (built, `src/drivedb/ops.ts`, migration 5): stock corrections with a reason (damaged, expired, lost,
  sample, found) and physical stock counts, always as movements; quarantine/recall/release batches; loyalty
  points (earned on what is paid, spent as a tender without changing the bill's GST, given back in proportion on
  returns as points not cash, settings copied from Medoro); home delivery orders (take → pack & bill → out with a
  rider → delivered; cash on delivery is a bill on the customer's account settled by the rider's cash).
  Screens: batch panel on Stock, points on Billing, an **Orders** tab. Tests: `ops.test.ts`, `e2e/23-device-ops`.
- Slice 3 (built): **branch transfers** (`transferStock`: out here, in there under the same batch; the other
  branch sees it after sync), **activity log** (`activityLog`: bills, credit notes, purchases, money in/out,
  expenses, stock corrections, counts, transfers, delivery orders, with staff names copied from Medoro; owner tab),
  **WhatsApp from the counter** (`share.ts`: wa.me links with a bill summary or a due reminder, no server and no
  WhatsApp Business setup). The catalogue copy now carries the branch list and staff names.
  Tests: `slice3.test.ts`, `e2e/24-device-transfer-activity.spec.ts`.
- Left for phase 5: the AI assistant (needs a small server gateway that receives only the question and the few
  rows needed), bulk WhatsApp campaigns (need the WhatsApp Business API on the server).

### Phase 6 progress (slice 1 built: customer payments by link, with an offline inbox)
- The owner connects the pharmacy's **own Razorpay account** on the counter (Counter → Online payments; keys checked
  with Razorpay, then sealed in `Integration` kind `razorpay_pay`) and adds the pharmacy's webhook URL
  (`/api/razorpay/pay/<tenant id>`, event `payment_link.paid`) in Razorpay.
- **Pay link**: on Customers, for anyone who owes money, the counter asks Medoro for a Razorpay payment link
  (`createPayLink`: Medoro forwards to Razorpay and keeps nothing) and opens WhatsApp with the reminder and link.
- **Offline inbox**: when the customer pays, Razorpay calls Medoro, which checks the pharmacy's webhook secret and
  seals the payment for each approved device with that device's public key (`src/drivedb/inbox.ts`: AES-GCM with
  an RSA-OAEP wrapped key) in `PaymentInbox` (migration `20261109000000_payment_inbox`). The first counter online
  picks it up through the relay (`op=inbox`), records a UPI receipt on the customer's account (same receipt id on
  every counter, so it is never counted twice) and acknowledges it (`op=inbox-ack`): every copy is deleted.
- Tests: `src/drivedb/inbox.test.ts`, `tests/integration/customer-pay.test.ts` (paid while offline → recorded →
  deleted; bad signatures and foreign links refused).
- Left for phase 6: the AI assistant gateway, the e-invoice (IRN) gateway, and sending bills through the WhatsApp
  Business API (counters already share bills and reminders on WhatsApp with no server, via wa.me).

### Phase 7 progress (slice 1 built: the move, checks, read-only copy, undo)
- Server `src/domain/system/drive-move.ts`: `startMove` freezes Medoro's copy (`tenant.settings.driveMove`;
  `Ctx.moved` refuses every business change with `MovedToDriveError`, and the app shows a notice), `moveExport`
  hands the owner's device everything in parts that fit a server response (base, then sales, returns, purchases,
  stock movements, loyalty, page by page), `completeMove` records it, `undoMove` works while moving and for 7 days.
  Turning Drive mode off is refused while moved.
- The base part carries the catalogue (inactive medicines too), every batch (all branches), customers (erased ones
  without details), suppliers, counter settings, and opening rows dated 2000-01-01 for what the copied history
  doesn't explain: opening stock per batch, customer dues and supplier dues, so the device's balances equal
  Medoro's ledger exactly. Cancelled bills stay behind; cash on delivery and points-only bills come across as cash.
  Payments received, supplier payments and expenses move entry by entry (reversed entries stay behind); other
  ledger entries (opening balances, journals, bounced cheques) become one opening balance per party.
- Device `src/drivedb/migrate-in.ts` (migration 6 adds `sale.igstPaise` and `placeOfSupply` for inter-state bills;
  GST returns, reports and the receipt use them): `beginMove` → `importPart` → `finishMove`, which adds the opening
  rows and runs `verifyMove`: row counts of every table, sales/returns/purchases totals, stock of every batch, every
  customer's and supplier's dues and loyalty points. Only if all match does the device become a counter; the load's
  change history is dropped because the first full copy to Drive carries it.
- Screen: **Move all my data from Medoro** on the device setup (owner, Drive connected, no Drive data yet):
  start → copy with progress → check (failed checks are listed; try again or cancel) → new Drive keys and full copy
  → recorded as moved → recovery code. A "Finish the move" card covers a page closed while saving. The Drive mode
  card on the speed-test page shows the state and the Undo button.
- Tests: `tests/integration/drive-move.test.ts` (real sales, credit, points, returns, purchases, payments moved and
  checked; a broken copy refused; undo window), `e2e/25-drive-move.spec.ts` (moves the whole e2e pharmacy).
- Slice 2: **deleting Medoro's copy** (`deleteMedoroCopy`): owner only, after the move, confirmed with the pharmacy
  code, and only if Drive's manifest shows a full copy saved after the move (Medoro reads only the plain manifest).
  Deletes every business table and stored file (scans, server-held backups); keeps the account, sign-in, staff,
  branches, devices, integrations, subscription and the audit log. State becomes `purged`: no undo after this.
  The Drive mode card has the button; the expenses total joined the checks.
- Left for phase 7: moving a pharmacy whose Drive already holds pilot data (needs merging the pilot's device bills).

### Phase 8 progress (slice 1 built: Drive sign-up, sync monitoring, privacy pages)
- **Sign-up** asks where the pharmacy's records live: "In my own Google Drive (recommended)" or Medoro's server.
  Drive sets `driveMode` and `driveOnly`: Medoro keeps only the account (`dataInDrive` makes `Ctx.moved` true, so
  every business change on the server is refused), `/app` opens Billing (device), and the device setup offers
  "Start my pharmacy on this device" (nothing to copy or move).
- **Server backups retired** for Drive pharmacies (signed up that way or moved): no scheduled, on-visit or manual
  backups (there is nothing to back up; counters save full copies to Drive). The bell stops asking for backups.
- **Monitoring**: devices report each sync's result (`op=health`: worked, or the error text) to `DriveDevice`
  (`lastSyncAt`, `lastError`, migration `20261108000000_drivedb_sync_health`). The owner's bell lists counters that
  haven't saved to Drive for 3+ days, sync errors from the past day, and lost Drive access. The Devices list shows
  each device's last sync and error.
- **Privacy**: the privacy policy, backup and help sections of /legal, and the in-app Privacy & data page say
  where records live in Drive mode and what Medoro keeps.
- Slice 2: **daily Drive health check** (`driveHealthTick`, in the cron tick): reads how full each Drive mode
  pharmacy's Google Drive is (`driveQuota`, Drive `about.storageQuota`) and emails the owners, at most once a day,
  when a counter stopped saving to Drive, a sync keeps failing, or Drive is 90%+ full (also on the bell).
  **No path back onto the server**: importing or applying a Medoro backup is refused for a Drive pharmacy (the
  WhatsApp/SMS webhooks only touch existing customer rows, so they add nothing). The Backup page explains that
  server backups are off and Drive must stay connected.
- Left: retiring the server backup code once no pharmacy keeps its data on Medoro's server (not yet: server mode
  is still offered at sign-up).

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
