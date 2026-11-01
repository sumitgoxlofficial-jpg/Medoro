# UPI & Bank Connect: plan for approval

**Status:** plan only. Nothing in this document is built yet. It answers the "first inspect, then plan" step of the
UPI & Bank Connect brief. Implementation starts phase by phase once this plan is approved, and each decision marked
**Decision** below needs a yes/no.

**Goal:** Medoro tells a pharmacy which of its bills have really been paid, using the pharmacy's existing bank account
and existing UPI QR. The pharmacy keeps its bank, its UPI ID and its QR. Money never passes through Medoro, and Medoro
never becomes a payment gateway.

Contents:
1. [What the repository already has](#1-what-the-repository-already-has)
2. [Technical architecture](#2-technical-architecture)
3. [Integration feasibility report](#3-integration-feasibility-report)
4. [Database migrations](#4-database-migrations)
5. [Implementation plan](#5-implementation-plan)
6. [Provider API documentation references](#6-provider-api-documentation-references)
7. [Regulatory and partner dependencies](#7-regulatory-and-partner-dependencies)
8. [Decisions needed](#8-decisions-needed)

---

## 1. What the repository already has

Inspected on `main` at `72f5c70`. The brief assumes some things the code does not match; those are flagged first
because they change the design.

### 1.1 Facts that change the brief

| The brief assumes | The repository actually does | Effect on this plan |
|---|---|---|
| Supabase tables hold invoices and payments | On Medoro's **hosted** server, every pharmacy's business data lives on its own devices (SQLite) and, encrypted, in **its own Google Drive** (`docs/DRIVEDB_PLAN.md`; commit `cffd7e7` made this compulsory). Supabase keeps only sign-in, subscription, device list and short-lived sealed inboxes. Self-hosted pharmacies still keep everything in their own PostgreSQL | Bank transactions are business records, so on the hosted server they must live **on the device and in Drive**, not in Supabase. The 14 tables in the brief are split between the server (connections, consents, jobs, counts) and the device (transactions, matches, allocations). See 2.2 |
| Supabase Auth, `supabase-js`, RLS per tenant | Medoro has its own sign-in (`src/server/auth.ts`), resolves the pharmacy on the server (`requireCtx()` → `ctx.tenantId`) and never trusts a tenant id from the browser. Supabase is used only as PostgreSQL and private storage. Migration `lock_data_api` turns on RLS for every table and revokes the `anon`/`authenticated` roles; the app connects as table owner | New server tables follow the same rule. Tenant-scoped RLS policies are proposed as an extra layer (Decision D3) |
| A separate invoice module with outstanding invoices | Invoices are `Sale` rows (server) / `sale` rows (device). Credit customers pay through `customerReceipt` (device) or a receipt `Voucher` (server). Receipts are booked **against the customer, not against a bill**, so "partially paid invoice" and "two payments for one bill" have nowhere to be recorded today | Add a receipt-to-bill allocation table (device and server). Without it, priorities 1–3 of the matching rules can't record which bill was paid |
| A bank statement importer must be built | **Already built** for self-hosted / server data: `src/domain/accounting/bank.ts` (+ `/app/bank`). CSV and XLSX, column auto-detection with a saved mapping, duplicate-safe re-imports (row fingerprint), auto-match to the *Bank account* ledger (amount + direction + ±3 days, reference wins, ambiguous left for manual), manual match/unmatch, statement vs book balance, audit entries | Extend it, don't duplicate it. Its parser (`bankAutoMapping`, `bankAmount`, `bankRows`) is pure and moves into a shared module that also runs on the device. Old `.xls` (binary) is refused today |
| Prisma not mentioned | Prisma 6 + raw SQL migrations in `prisma/migrations`, money as `BigInt` paise, append-only triggers on posted rows, hash-chained `AuditEvent` | Same conventions: paise integers, append-only financial rows, `writeAudit` for every change |

### 1.2 Pieces to reuse

| Need | Existing piece |
|---|---|
| Tenant/auth on every endpoint | `requireCtx()`, `authorize(ctx, perm)`, `run()` server-action wrapper, CSRF/Origin checks (`src/server/csrf.ts`) |
| Permissions | `payments` ("Record payments & expenses") and `reports`; `integrations` for connecting outside accounts; owner-only checks (`ownerOnly`) |
| Secrets at rest | `seal()`/`unseal()` with `HOST_KEY` (`src/server/vault.ts`), `Integration` table (`kind`, `config`, `encryptedSecret`) — already holds WhatsApp, Google Drive and the pharmacy's own Razorpay keys |
| Server → device delivery while offline | `PaymentInbox` + `sealForDevice()` (`src/drivedb/inbox.ts`): a payment is sealed with each approved device's RSA-OAEP key; the first counter online records it and every copy is deleted. The same pattern carries bank and provider transactions |
| Per-pharmacy webhooks | `/api/razorpay/pay/[tenant]` with the pharmacy's own HMAC secret (`handlePayWebhook`) |
| Scheduled jobs | `/api/cron/tick` (Vercel Cron once a day on the current plan; in-process every minute on self-hosted) |
| Rate limits | `src/server/rate-limit.ts` (PostgreSQL-backed) |
| File parsing | `readEbillTable()` (CSV, XLSX, pipe/tab text), `parseCsv`, `parseXlsx` (`fflate`, no heavy dependency) |
| UPI QR on a bill | `src/lib/qr.ts` encoder and the `upi://pay?pa=…&tn=…` intent already used on the Plan page |
| UI kit | `src/components/ui/*` (card, badge, button, field, modal, segmented, toast), `PageHead`, `lucide-react`, Recharts; device screens in `src/components/device/*` |
| WhatsApp | Meta Cloud API module (`src/domain/comms/whatsapp.ts`); on Drive counters, wa.me links. Used for "payment received" messages later, not needed for reconciliation |
| Tests | Vitest unit tests next to code, `tests/integration/*` against real PostgreSQL (`tenant-isolation.test.ts`, `customer-pay.test.ts`, `cheques-bank.test.ts`), DriveDB tests in `src/drivedb/*.test.ts`, Playwright in `e2e/` |

### 1.3 Gaps

- No connection to any bank, Account Aggregator, PhonePe, Paytm or BharatPe. Only the pharmacy's own Razorpay
  (payment links, optional) exists.
- Drive counters have **no bank statement import** at all; the importer only works on server data.
- No normalized transaction model, no UTR/RRN field, no provenance, no review queue.
- No allocation of a receipt to a bill (see 1.1).
- No check that a bill marked "UPI" at the counter was actually received. This matters more for a pharmacy than credit
  bills: most UPI money arrives at the counter, and a faked "payment successful" screen is the common fraud.

---

## 2. Technical architecture

### 2.1 Shape

```
 Sources (all authorised, all optional except statements)
 ┌──────────────────────┐ ┌────────────────────────┐ ┌──────────────────────────┐ ┌───────────────────┐
 │ Bank statement file  │ │ Direct bank API        │ │ Account Aggregator via   │ │ Provider API      │
 │ (CSV / XLSX / XLS)   │ │ (per-bank partnership) │ │ regulated FIU partner    │ │ (PhonePe, Paytm…) │
 └─────────┬────────────┘ └───────────┬────────────┘ └────────────┬─────────────┘ └─────────┬─────────┘
           │ parsed on the device       │ poll / webhook             │ consent + fetch          │ poll / webhook
           │ (or on a self-hosted       ▼                            ▼                          ▼
           │  server)        ┌─────────────────────────────────────────────────────────────────────────┐
           │                 │ Medoro server: Connector adapters (one per source)                      │
           │                 │  connection + consent state · encrypted tokens · job queue · cursors   │
           │                 │  · retries/backoff · rate limits · webhook auth · sync logs (counts)    │
           │                 └──────────────────────────────┬──────────────────────────────────────────┘
           │                     hosted (Drive pharmacy):   │ self-hosted / server data:
           │                     seal per device → FinInbox │ write straight to PostgreSQL
           ▼                                                ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Shared core (pure TypeScript, runs on device and server — like src/domain/gst builders do today)     │
 │  normalize → extract refs (UTR/RRN, Medoro ref) → dedupe (confidence) → match (priority 1–5)         │
 │  → allocate (full / partial / multiple) → reversal & refund handling                                  │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
           │ Drive pharmacy: device SQLite (+ encrypted change log to the owner's Drive)
           │ Self-hosted: PostgreSQL tables of the same shape
           ▼
 UPI & Bank Connect screens: overview · connections · transactions · reconciliation · sync history · reports
```

### 2.2 Where each piece of data lives

The rule from `docs/DRIVEDB_PLAN.md` stays: Medoro's hosted database keeps only what it needs to run the service.

| Data | Hosted (Drive pharmacy) | Self-hosted |
|---|---|---|
| Connection, consent status, consent expiry, masked account (`XXXX1234`), bank/provider name | Server (Supabase) | Server |
| Provider tokens / API keys / AA consent handles | Server, sealed with `HOST_KEY` | Server, sealed |
| Sync jobs, cursors, locks, retry state | Server | Server |
| Sync logs: start, end, source, **counts only**, error code | Server | Server |
| Transactions fetched by the server, waiting for a device | Server `FinInbox`, sealed per device, deleted on acknowledgement, hard limit 14 days (Decision D2) | n/a |
| Normalized transactions, source records, duplicates, match suggestions, allocations, statement imports | **Device SQLite + owner's Drive** | Server PostgreSQL |
| Uploaded statement file | Parsed in the browser, never uploaded; kept in Drive `storage/statements/` only if the owner ticks "keep a copy" | Private storage (`STORAGE_DIR` / Supabase bucket), deleted after the retention period |
| Audit of connection changes (connect, consent, revoke, disconnect) | Server `AuditEvent` | Server `AuditEvent` |
| Audit of reconciliation decisions (approve, reject, manual match, unallocate) | Device append-only table, synced to Drive | Server `AuditEvent` |

Why: a bank statement shows every customer and supplier the pharmacy deals with. Keeping it off Medoro's server is
what the product now promises (legal page, Privacy & data).

### 2.3 Connector adapters

One interface, one file per source in `src/domain/finance/connectors/`:

```ts
interface Connector {
  id: "statement" | "aa" | "bank:icici" | "bank:axis" | "phonepe" | "paytm" | …;
  capabilities(): Capabilities;            // history days, webhook?, poll interval, fields supplied
  status: "available" | "sandbox" | "partner_required" | "unsupported";   // shown in the UI, from config
  start(ctx, input): Promise<{ redirectUrl?: string; pendingId: string }>; // official auth / consent flow
  callback(params): Promise<ConnectionResult>;   // only here can a connection become "active"
  fetch(conn, cursor): Promise<{ records: SourceRecord[]; next: Cursor; done: boolean }>;
  verifyWebhook(req): Promise<SourceRecord[] | null>;  // null = refuse (401)
  revoke(conn): Promise<void>;
}
```

- A connector whose `status` is not `available` cannot be connected in production: its card shows the label and the
  steps, and the **Connect** button is absent. No mock connector is registered outside tests.
- Every connector returns raw `SourceRecord`s exactly as received (kept for provenance); the shared core normalizes.
- Fields a source doesn't give stay `null`. Nothing is guessed (no payer name from narration unless the source labels
  it, no "Google Pay" unless the source says so).

### 2.4 Normalized transaction model

```
NormalizedTxn {
  id, accountRef (bank connection or "statement:<bank>-<last4>"),
  direction: credit | debit,  amountPaise (integer > 0), currency ("INR"; others kept but never matched),
  bookedAt (date, + time when the source gives it), valueDate?,
  utr? (12-digit RRN for UPI, IMPS RRN, NEFT/RTGS UTR), bankRef?, providerTxnId?, provider?,
  channel: upi | imps | neft | rtgs | card | cash | cheque | settlement | other | unknown,
  counterpartyName?, counterpartyVpa?, description (as given, trimmed),
  status: success | pending | failed | reversed,
  verified: true when the source is a bank API, AA or provider API; false for a statement file,
  reconStatus: unmatched | suggested | matched | partially_allocated | duplicate_review | ignored,
  firstSeenAt, sources: [TransactionSourceRecord…]
}
```

`channel` and `utr` are parsed from the narration only with bank-specific patterns that are covered by fixture tests
(e.g. `UPI/<12-digit RRN>/<remarks>/<vpa>` as standardised by NPCI's UPI narration circular). When no pattern matches,
they stay `unknown`/`null`.

### 2.5 Duplicate detection (confidence-based)

A new record is compared with existing transactions of the same pharmacy, in this order. The first rule that fires
decides.

| # | Evidence | Confidence | Action |
|---|---|---|---|
| 1 | Same source and same provider transaction id | certain | Same transaction: add the source record, update status (e.g. pending → success) |
| 2 | Same UTR/RRN, same amount and direction | certain | Same transaction (this is how a PhonePe record and the bank credit for it merge) |
| 3 | Same bank reference on the same account | certain | Same transaction |
| 4 | Same account + same statement row fingerprint (existing importer rule: date, amount, narration, ref, balance, occurrence) | certain | Already imported, skipped and counted as duplicate |
| 5 | Same account, amount, direction, date, and the narration matches after normalizing spaces/case; no reference on either | high | Same transaction, recorded as "merged on attributes"; shown in sync history |
| 6 | Same amount and direction within ±1 day, at least one side has no reference, different sources | ambiguous | **Kept as two rows**, both flagged `duplicate_review`; neither is matched to a bill until a person decides |

Nothing is deleted. A merged record stays as a `TransactionSourceRecord` under the surviving transaction, and the
merge can be undone.

**Settlement batches.** Some QR providers pay the merchant's bank one net amount per day instead of each payment. A
bank credit whose narration identifies the provider's settlement, or whose amount equals the sum of a provider's
settled transactions for that payout, becomes `channel = settlement` and is linked to those provider transactions. It
is never itself matched to a bill, so the money is not counted twice.

### 2.6 Matching and allocation

Only **credits** with `status = success` are matched. Debits feed the existing supplier/expense side later; reversed
and failed rows never are.

Targets, in order of business value:

1. **Counter UPI verification.** A bill already marked UPI at the counter is checked against incoming credits. Found →
   "UPI received ✓". Not found after the source's normal delay → "UPI not seen in bank" alert for the manager. The
   bill itself is not changed (it is append-only); the verification is a separate record.
2. **Credit bills and customer dues.** An allocation records which bill(s) a receipt pays.

| Priority | Rule | Automatic? |
|---|---|---|
| 1 | The transaction carries a Medoro payment reference (`MD-<bill id short>` put in the UPI note by a Medoro-printed QR, see below) and the amount is ≤ the bill's balance | Yes, when the source is verified. From a statement file: yes when D4 says so |
| 2 | The UTR/RRN or provider transaction id was already recorded on a bill or receipt (e.g. typed at the counter) | Yes, when verified |
| 3 | The description contains the exact invoice number of exactly one open bill, and the amount ≤ its balance | Yes, when verified |
| 4 | Exact amount = balance of exactly one open bill in the time window (default: bill date to +7 days), **and** exactly one credit of that amount in the window, **and** the payer VPA/name was linked to this customer before | Suggestion; auto only when all three hold and the owner turned on "auto-match known payers" |
| 5 | Same amount or near amount, or open bills of the same customer | Suggestion only |

- Amount alone never matches automatically.
- Overpayment: allocate up to the balance, the rest stays as an unallocated credit on the customer (advance).
- Partial payment: the bill shows "part paid ₹x of ₹y"; several payments may be allocated to one bill.
- Reversal/refund of a matched credit: a reversing allocation is added (allocations are append-only), the bill
  reopens, and the event appears in "needs review".
- Any automatic match can be undone by a user with `payments`; undo is a new row plus an audit entry.

**Medoro payment reference with the merchant's own QR.** Medoro can print, on a credit bill or a WhatsApp reminder, a
UPI intent QR built from the pharmacy's **existing** UPI ID: `upi://pay?pa=<their VPA>&pn=<name>&am=<balance>&tn=MD-<ref>`.
Money still goes straight to their bank through their own UPI ID; the QR only pre-fills the amount and note. Whether
the note reaches the bank statement depends on the payer app and the bank (narration fields are often truncated), so
priority 1 helps when present and nothing depends on it. The pharmacy's static shop QR is not replaced.

### 2.7 Sync engine (server)

- **Job table** (`FinSyncJob`) with `status`, `runAfter`, `attempts`, `lockedUntil`, claimed with
  `SELECT … FOR UPDATE SKIP LOCKED`; a per-connection `pg_advisory_xact_lock` stops two runs of the same connection.
- **Triggers:** first sync after a connection becomes active; schedule per connection (only for sources whose
  capabilities allow polling, interval ≥ the source's minimum); "Sync now" (rate-limited: 1 per connection per
  10 minutes); webhooks (enqueue a small fetch or deliver the record directly).
- **Cursors:** per connection, what the source supports (timestamp, page token, AA consent session). The cursor
  advances only after the batch is stored (self-hosted) or sealed into the inbox (hosted).
- **Retries:** exponential backoff with jitter (1, 2, 4, 8, 16 min, then hourly up to 24 h); honours `Retry-After` on
  429. Permanent errors (consent expired/revoked, bad credentials) stop retries and mark the connection.
- **Timeouts:** each run stops at 240 s (Vercel limit 300 s) and continues from the cursor in the next job.
- **Vercel Cron:** today it runs once a day (Hobby). Polling more often needs Vercel Pro (cron every few minutes) or
  an external scheduler calling `/api/cron/tick` with `CRON_SECRET`. Self-hosted already ticks every minute.
- **Alerts:** a connection failing for 24 h, an expiring consent (7 days and 1 day before), or "UPI not seen in bank"
  shows in the dashboard alert list and the owner's daily email (existing `reportMailTick`), never with amounts or
  names in the email subject.

On the **device**, a small sync step runs when the screen opens and every few minutes while online: fetch sealed
inbox entries (existing relay `op=inbox`, extended for kind `fintxn`), open, normalize, dedupe, match, write, then
acknowledge so the server deletes them.

### 2.8 Screens

New nav group **Financial Management** (in `src/lib/nav.ts`) with **UPI & Bank Connect** at `/app/money`, and the same
screen as a tab on the Drive counter (`src/components/device/`). The existing **Bank** screen moves under it as the
"Statements" tab, so there is one place, not two.

Tabs: Overview · Connections · Transactions · Reconciliation · Sync history · Reports. Each integration card carries
one of four labels: **Available**, **Sandbox only**, **Partner onboarding required**, **Not yet supported**. Copy on
every source states its delay honestly ("Statement: as of the file you upload", "Settlement data: next day").

### 2.9 Endpoints

The brief's endpoint list maps onto Medoro's two modes. Server endpoints all use `requireCtx()` (session cookie),
permission checks, Origin/CSRF checks and rate limits; webhooks use per-provider signatures instead of a session.
For Drive pharmacies, transactions and reconciliation never reach the server, so those "endpoints" are device
operations in the DriveDB SDK.

| Brief | Implementation | Where |
|---|---|---|
| `POST /api/financial-connections/bank/start` | Same path | Server |
| `GET /api/financial-connections/bank` | Same path | Server |
| `GET /api/financial-connections/bank/callback` | Same path; checks a signed, single-use `state` bound to the session and tenant | Server |
| `POST /api/financial-connections/bank/:id/consent/refresh` | Same path | Server |
| `POST /api/financial-connections/bank/:id/revoke` | Same path; calls the partner's revoke, then marks revoked | Server |
| `POST /api/financial-connections/bank/:id/sync` | Same path; enqueues a job | Server |
| `POST /api/financial-connections/provider/:provider/connect` | Same path; refuses providers not `available` | Server |
| `GET /api/financial-connections/providers` | Same path; capabilities + labels | Server |
| `GET /api/financial-connections` | Same path | Server |
| `DELETE /api/financial-connections/:id` | Same path; revokes first, deletes tokens, keeps the audit | Server |
| `POST /api/transactions/webhooks/:provider` | `/api/transactions/webhooks/:provider/:tenant` (per-pharmacy secret, like the Razorpay pay webhook) | Server |
| `POST /api/transactions/sync` | Server: enqueue all of this pharmacy's connections. Device: also pulls the inbox | Both |
| `POST /api/transactions/import` | Self-hosted: server action (existing `importStatementAction`, extended). Drive: parsed on the device | Mode-dependent |
| `GET /api/transactions`, `GET /api/transactions/:id` | Self-hosted: same paths. Drive: device query | Mode-dependent |
| `GET /api/reconciliation`, `/suggestions`, `POST …/:id/approve`, `…/reject`, `…/manual-match` | Self-hosted: same paths. Drive: device operations | Mode-dependent |
| `GET /api/financial-reports/collections`, `/transactions` | Self-hosted: same paths (CSV/XLSX/PDF). Drive: built on the device like today's GST reports | Mode-dependent |

### 2.10 Security

- Never asked for, never stored: UPI PIN, net-banking password, OTP, card number/CVV. Connection forms only accept
  what an official flow issues (OAuth/consent redirect, or provider-issued API keys pasted by the owner, like Razorpay
  today). A test scans connector inputs for fields named like pin/password/otp.
- Tokens and API keys sealed with `HOST_KEY`; never sent to a browser; never logged (log redaction already exists).
- OAuth/consent `state`: random 32 bytes, HMAC-bound to session + tenant + connector, 10-minute expiry, single use.
- Webhooks: provider signature checked with a constant-time compare on the raw body, tenant in the path, replay window
  where the provider sends a timestamp, idempotent on the provider transaction id. Bad signature → 401, logged without
  the body.
- Statement files: 4 MB limit (Vercel), extension and magic-byte check, zip-bomb guard on XLSX (size limits in
  `fflate` filter), formula cells read as text (no evaluation), CSV export escapes leading `= + - @`.
- Rate limits: connect/start 5/hour per pharmacy, sync now 1 per 10 min per connection, import 20/hour per user.
- Consent: expiry date stored and enforced before every fetch; revoked/expired → no fetch, status shown, owner told.
  Revoke in Medoro calls the partner's revoke; revoke at the AA/bank is picked up by the partner's notification or the
  next fetch failing.
- Retention: sync logs 180 days (CERT-In log retention), inbox entries deleted on acknowledgement or after 14 days,
  uploaded statement copies per the pharmacy's retention setting (existing daily retention job).
- Use limitation: transaction data is used only to reconcile and report for that pharmacy. It is not used for
  marketing, credit scoring, analytics across pharmacies, or AI training. Remote AI never receives it in strict mode.
- Read-only Medoro support sessions can see connection status but not transactions.

---

## 3. Integration feasibility report

Research done on 1 November 2026 from public documentation. Several provider sites (e.g. `developer.phonepe.com`)
could not be opened from this build environment, so details below come from search results of those pages and must
be re-checked with each provider before building. **Nothing here is a commitment from any provider.**

### 3.1 Summary

| Source | What exists | Who can use it | Real-time? | Label at launch |
|---|---|---|---|---|
| **Bank statement import** (CSV, XLSX, XLS) | Built for server data; to be shared with Drive counters | Every pharmacy, every bank | No: as of the file | **Available** |
| **Account Aggregator** | RBI-regulated consent framework; bank deposit data incl. transactions (txnId, type, mode, amount, timestamp, narration, reference) | Only a **regulated FIU** receives data. Medoro alone is not eligible | No: periodic fetch within the consent's frequency limit | **Partner onboarding required** |
| **Direct bank APIs** (ICICI, Axis, HDFC, others) | Corporate API banking portals with account statement APIs | The bank's current-account customers, with bank approval per corporate, often a partner agreement with Medoro | Near real-time on some (statement on demand); some banks offer credit notifications | **Partner onboarding required**, bank by bank |
| **PhonePe** (Integrated Static QR) | Transaction List API and server-to-server callback for static QR at stores | Merchants onboarded for PhonePe's offline integration (merchant id, salt key, store/terminal mapping) | Callback within seconds; list covers recent payments only | **Partner onboarding required** |
| **Paytm** (Paytm Payments) | Settlement API (transaction-level, settled, last 6 months, 1-day range), settlement detail and order lookup | Merchants with a Paytm MID and API keys | No: settlement data | **Partner onboarding required** (eligibility of plain Paytm for Business QR merchants to be confirmed) |
| **BharatPe** | No public merchant transaction API found | — | — | **Not yet supported** |
| **Google Pay for Business** | Per-transaction lookup in the Omnichannel API for onboarded merchants; no history listing found | Onboarded Omnichannel merchants | — | **Not yet supported** for static-QR merchants |
| **Razorpay** (pharmacy's own account) | Already built: payment links and per-pharmacy webhook | Pharmacies that already have Razorpay; never required | Yes (webhook) | **Available** (existing, optional) |
| SMS reading, notification listening, app scraping, automated logins | Excluded by the brief and by Play/App Store policy | — | — | Never |

Payments made with Google Pay, PhonePe, Paytm, BHIM or any other UPI app to the pharmacy's UPI ID all land in the
pharmacy's bank account. So the **bank side (statement, bank API, AA) is the universal source**; provider APIs only add
detail for merchants whose QR belongs to that provider.

### 3.2 Account Aggregator

- **Eligibility.** Sahamati (the AA industry body) states FIUs must be registered with and regulated by RBI, SEBI,
  IRDAI or PFRDA, with a use case that fits their licence. A technology service provider (TSP) can build and run the
  FIU module for a regulated entity but cannot be the licensed participant. Medoro, a SaaS company, is therefore **not
  eligible to be an FIU** and ordinary SaaS registration does not give AA access.
- **Route open to Medoro:** a partnership with a regulated entity (an NBFC, bank or other RE) that is an FIU and whose
  licence covers a merchant-reconciliation / account-monitoring use case, with Medoro as its TSP or as a service it
  offers to its customers. Open questions for legal counsel and the partner:
  1. Can the FIU share AA-sourced data onward to Medoro / the pharmacy's devices for this purpose, and under what
     contract (the FIU stays responsible for the data)?
  2. Which purpose code fits (ReBIT purpose codes include aggregated statement and explicit consent for monitoring of
     accounts) and what fetch frequency and data life the consent may ask for?
  3. Data storage and location rules in the partner's contract (see 7.3 on Google Drive).
  4. Is a business current account of a proprietorship covered by the FIPs the partner reaches?
- **Technical shape** (once a partner exists): consent request → redirect to the AA app (Finvu, OneMoney, Anumati,
  CAMSfinserv, NADL, Saafe etc., the customer picks) → consent approved notification → FI request for a date range →
  encrypted data (ECDH, per ReBIT spec) decrypted at the FIU/TSP → normalized → delivered. Consent expiry, pause,
  revoke and renewal follow the AA notifications. Incremental fetch = date-range requests from the last fetched
  timestamp within the consent's frequency limit.
- **Effort after a partner is signed:** 3–4 weeks with a TSP SDK; sandbox access comes with the partner.

### 3.3 Direct bank APIs

- **ICICI Bank:** API Banking portal for partner firms; statement and balance retrieval; an older ICICI partner deck
  mentions statement calls limited to 2000 records with a paginated 200-per-call option. Access needs onboarding with
  the bank.
- **Axis Bank:** public API portal lists Account Statement (date range), Real-Time Account Statement and Instant
  Account Statement under Corporate Payments; sandbox, then "apply for a partnership"; pagination above 2000 entries.
- **HDFC Bank:** developer portal with Accounts & Deposits APIs; registration needs approval; corporate statement API
  details are only confirmed through a third-party integrator's guide.
- **Practical limits:** these serve current-account corporate customers. Many small pharmacies use savings or small
  current accounts and may not qualify. Each bank needs a separate agreement, security review (often including VAPT
  and IP allow-listing), and per-merchant activation through the bank's relationship team. Third-party "connected
  banking" aggregators exist that hold several bank integrations; they are worth evaluating as one contract instead
  of five (Decision D5).
- **Effort per bank after approval:** 1–2 weeks (auth with certificates/encryption the bank prescribes, statement
  fetch, pagination, cursors).

### 3.4 PhonePe

- Documented **Integrated Static QR** APIs: *Transaction List* (`POST /v3/qr/transaction/list`, X-VERIFY = SHA-256 of
  payload + path + salt key; filters merchant id, store id, terminal id, amount, last 4 of transaction id or UTR,
  start timestamp) and a *server-to-server callback* sent within about 5 seconds of a payment, with a status API as
  fallback. A metadata API attaches a bill number, after which the payment drops out of later list responses.
- Documentation conflicts on the list window ("last 5 minutes" vs a start-timestamp filter); older pages use `/v2/`.
  Must be tested in the sandbox.
- This is a **counter-time verification** tool (perfect for "did this UPI payment really arrive?"), not a history
  export. Whether an existing small-merchant "PhonePe Business" QR can be mapped into it, or whether PhonePe issues
  new integrated QRs, must be confirmed with PhonePe. It needs PhonePe merchant onboarding and credentials.
- Medoro would need either PhonePe's partner/aggregator onboarding (one integration, merchants activated by PhonePe) or
  each pharmacy's own merchant credentials (pasted by the owner, sealed like Razorpay keys).

### 3.5 Paytm

- Documented under Paytm Payments: *Settlement API* (transaction-level settled data incl. refunds and disputes,
  1-day range per call, last 6 months, paginated), *Settlement Detail API* (per payout), *Settlement Transaction
  Detail API* (one order, production only, JWT auth with MID and merchant key).
- Fits "which payments made up yesterday's settlement" and matching settlement batches to bank credits. Not real-time.
- Needs a Paytm MID and API keys. Whether a Paytm for Business (Soundbox/QR) merchant gets these from the dashboard,
  or only payment-gateway merchants do, must be confirmed with Paytm.

### 3.6 BharatPe, Google Pay and others

- **BharatPe:** no public developer documentation for merchant transaction history or webhooks was found. Marked
  "Not yet supported"; a partnership enquiry is listed in section 7.
- **Google Pay for Business:** the India Omnichannel API looks up one transaction by the merchant's own transaction id
  for onboarded merchants. There is no list of payments received on a static QR. "Not yet supported".
- **BHIM and other UPI apps:** payer apps, not merchant accounts. Their payments appear in the bank. Nothing to connect.
- **Bank alert emails** (Gmail API with the owner's consent) is technically an authorised route, but Gmail read scopes
  are "restricted" and need Google's security assessment, and alert formats vary per bank. Not planned; listed only
  as a possible later option.

### 3.7 Statement formats

- CSV and XLSX: supported today.
- Old `.xls`: refused today. Many Indian banks' "Excel" downloads are actually HTML tables or SpreadsheetML XML with an
  `.xls` name; those can be parsed without a dependency. True BIFF8 binary `.xls` needs a parser library; the plan is
  to detect HTML/XML first and only add a small, maintained BIFF reader if fixtures prove it necessary (Decision D6).
- PDF statements: not in scope (text extraction is unreliable and password-protected PDFs need the account holder's
  password, which Medoro must not collect). The UI tells the user to download CSV/Excel instead.
- Fixture set: anonymised sample statements for SBI, HDFC, ICICI, Axis, Kotak, PNB, Bank of Baroda, Canara, Union,
  IDFC First, Yes, IndusInd (synthetic rows, real column layouts), each with a test.

---

## 4. Database migrations

Names follow the repository convention (Prisma models, quoted PascalCase tables, `TEXT` UUID ids from
`@default(uuid())`, `BigInt` paise, `createdAt`/`updatedAt`). The brief's names are given for each.

### 4.1 Server (PostgreSQL / Supabase) — both modes

| Brief name | Model | Purpose |
|---|---|---|
| `bank_connections` + `payment_provider_connections` | `FinConnection` | One row per connected source: `tenantId`, `kind` (`aa`, `bank`, `provider`), `connector` (`aa:<partner>`, `bank:axis`, `phonepe`…), `status` (`pending`, `active`, `expired`, `revoked`, `error`, `disconnected`), `displayName`, `accountMasked`, `ifscPrefix`, `encryptedSecret` (sealed), `config` (non-secret), `lastSyncAt`, `lastErrorCode`, `lastErrorAt`, `syncEveryMin`, `createdBy`. Unique `(tenantId, connector, accountMasked)`. One table instead of two because bank and provider connections share every column; `kind` keeps them apart in the UI |
| `bank_connection_consents` | `FinConsent` | Append-only consent history: `connectionId`, `externalId` (consent handle), `purpose`, `fetchFrom`, `fetchTo`, `frequency`, `expiresAt`, `status`, `event` (requested, approved, rejected, paused, revoked, expired, renewed), `at` |
| `payment_provider_capabilities` | `FinCapability` | Per connector, maintained by Medoro: `label` (available, sandbox, partner_required, unsupported), `realtime`, `historyDays`, `minPollMin`, `fields` (json), `docsUrl`, `reviewedAt`. Seeded by migration; not tenant data |
| `bank_sync_jobs` | `FinSyncJob` | `tenantId`, `connectionId`, `trigger` (initial, schedule, manual, webhook), `status`, `runAfter`, `attempts`, `lockedUntil`, `cursor` (json), `lastError`. Index `(status, runAfter)` |
| `financial_sync_logs` | `FinSyncLog` | Append-only: `tenantId`, `connectionId` or `source = 'statement'`, `startedAt`, `endedAt`, `fetched`, `newCount`, `duplicates`, `matched`, `errors`, `errorCode`. **Counts only**, no amounts or names. Hosted devices report their statement-import counts here too |
| — | `FinInbox` | Hosted only: like `PaymentInbox`; `tenantId`, `deviceId`, `connectionId`, `batchId`, `sealed`, `createdAt`. Unique `(tenantId, deviceId, batchId)` |
| `financial_audit_logs` | existing `AuditEvent` | Hash-chained, append-only already; entities `fin_connection`, `fin_consent`, `fin_reconciliation`. No second audit table |

All new tables: `ENABLE ROW LEVEL SECURITY`, privileges revoked from `anon`/`authenticated` (the existing
`tenant-isolation`/RLS test fails otherwise). With Decision D3 = yes, also `FORCE ROW LEVEL SECURITY` and a policy
`USING ("tenantId" = current_setting('medoro.tenant', true))`, with the service setting `SET LOCAL medoro.tenant` in
each transaction.

### 4.2 Transaction tables — device SQLite (Drive) and PostgreSQL (self-hosted), same shape

| Brief name | Device table / Prisma model | Notes |
|---|---|---|
| `external_transactions` + `transaction_source_records` | `finSourceRecord` / `FinSourceRecord` | Raw record as received: `source` (statement, aa, bank:x, phonepe…), `sourceRef` (provider txn id or statement fingerprint), `importId`, `payload` (json, trimmed), `receivedAt`, `txnId` (→ normalized). Unique `(source, sourceRef)`. Append-only. One table: an "external transaction" is a source record |
| `normalized_transactions` | `finTxn` / `FinTxn` | Model in 2.4. Indexes on `utr`, `bankRef`, `providerTxnId`, `(bookedAt)`, `(reconStatus)`, `(amountPaise, direction, bookedAt)`. Core fields append-only; `status` and `reconStatus` change through append-only events (`finTxnEvent`) and a derived current value |
| `transaction_match_suggestions` | `finSuggestion` / `FinSuggestion` | `txnId`, `target` (`sale`, `customer`, `counter_upi`), `targetId`, `priority`, `score`, `reason`, `status` (open, approved, rejected, expired), `decidedBy`, `decidedAt` |
| `payment_reconciliation` | `finAllocation` / `FinAllocation` | Append-only: `txnId`, `saleId` and/or `customerId`, `receiptId` (the receipt it created or matched), `amountPaise` (negative = reversal), `kind` (auto, approved, manual, reversal), `rule` (1–5), `userId`, `at`. Bill balance = credit part − sum of allocations − credit returns |
| — | `finCounterCheck` / `FinCounterCheck` | Counter-UPI verification: `paymentId` (bill payment), `txnId`, `status` (received, not_seen, mismatch), `at` |
| `statement_imports` | `finImport` / existing `BankStatement` extended | File name, bank, account, mapping, rows, new, duplicates, skipped, errors, `createdBy` |
| `statement_import_rows` | `finImportRow` / existing `BankLine` extended | Existing `BankLine` gets `utr`, `channel`, `txnId`; the per-row error list (row number + reason) goes in `finImportRow` |
| — | `receiptAllocation` (device), and `ReceiptAllocation` (server) | Gap from 1.1: which bill a customer receipt pays, used by manual receipts at the counter too |

Device migration is migration 8 in `src/drivedb/schema.ts` (append-only triggers like the other tables). The server
`BankStatement`/`BankLine` data migrates into `FinTxn` with a one-time, idempotent backfill; the old tables stay
read-only for a release, then are dropped in a later migration.

### 4.3 Existing tables touched

- `Payment` (server) and `payment` (device): add nullable `utr` so a UTR typed at the counter feeds priority 2.
- `Integration`: unchanged; `FinConnection` holds bank/provider secrets so the existing Razorpay row stays as is.
- `Tenant.settings`: `finance` block (auto-match switches, time window, alert thresholds, statement retention).

---

## 5. Implementation plan

Each phase ends with something that ships on its own. Estimates are for one developer, including tests.

| Phase | Builds | Done means | Est. |
|---|---|---|---|
| **1. Core + statements** | Shared core (`src/domain/finance/core/`: normalize, narration parsers per bank, UTR extraction, dedupe, priority rules) as pure functions; device migration 8; server migration for `FinTxn` family + backfill from `BankLine`; statement importer on the device (bank picker, mapping with saved profile per bank, preview, validation with row errors, import history); HTML/XML `.xls`; `receiptAllocation` | A Drive counter and a self-hosted server both import statements from the fixture banks; re-import adds nothing; UPI credits are identified with UTR; tests in section 5.1 pass | 3 weeks |
| **2. Dashboard + reconciliation** | `/app/money` and the device tab: overview, transactions, reconciliation queues (auto-matched, suggested, unmatched, partial, duplicate warnings), manual match, undo, counter-UPI verification, sync history, reports (daily/monthly credits, UPI collections, bank-wise, unmatched, reconciliation; CSV/XLSX, PDF via `pdf-lib`); Bank screen folded in | A credit bill paid by UPI and imported from a statement is matched (rule 1–3) or suggested (4–5); partial and multiple payments show correctly; counter UPI bills show received / not seen | 3 weeks |
| **3. Direct bank APIs** | Connector framework, `FinConnection`, jobs, cursors, retries, alerts; first bank connector **only after** a signed agreement and sandbox | Sandbox-only label until the bank approves production | 1 week framework + 1–2 weeks per bank |
| **4. Account Aggregator** | Consent flow, notifications, FI fetch through the partner's TSP SDK, expiry/renewal/revoke | Only after the regulated partner and legal sign-off; sandbox first | 3–4 weeks |
| **5. PhonePe** | Static-QR callback webhook + transaction list for counter verification, metadata (bill number) | After PhonePe onboarding confirms eligibility of existing merchant QRs | 2 weeks |
| **6. Paytm, BharatPe** | Paytm settlement fetch + settlement-batch linking; BharatPe only if a documented API appears | After Paytm confirms API access for QR merchants | 2 weeks |
| **7. Multi-source dedupe + automation** | Cross-source merges (provider ↔ bank by UTR), settlement-batch linking, configurable intervals per connection, job monitoring page | Same payment from PhonePe and the bank counts once in every report | 2 weeks |
| **8. Security + production** | Threat model review, pen test of new endpoints, webhook fuzzing, load test of import (10k rows), DPDP notice and consent text, runbook | Section 7 items ticked for each source going live | 2 weeks |

Phases 1–2 need no outside party and deliver the full value for every pharmacy and every bank. Phases 3–6 start only
when their partner dependency in section 7 is resolved; until then their cards show "Partner onboarding required".

### 5.1 Tests (mapped to the brief)

| Brief case | Test |
|---|---|
| Successful / failed bank connection | Connector framework with a test-only fake connector (registered only under `NODE_ENV=test`): callback success → active; denied/invalid state → stays pending, audit |
| Consent expiry / revocation | Fetch refused after `expiresAt`; revoke calls the partner and blocks jobs; partner revoke notification handled |
| Successful / partial sync | Cursor advances only after storing; a failure mid-way resumes from the cursor without duplicates |
| Duplicate bank/provider transaction | Same UTR from provider and statement → one `FinTxn`, two source records; reports count once |
| UPI incoming credit / outgoing debit | Narration fixtures per bank → channel, direction, UTR |
| Multiple payments / partial payment / incorrect amount | Allocation sums, part-paid status, overpayment as advance, under-payment stays open |
| Missing UTR | Falls through to rules 3–5; never auto by amount |
| Duplicate statement import | Same file twice → 0 new; overlapping date ranges → only new rows |
| Invalid CSV/XLSX | Wrong extension, corrupt zip, missing columns, bad dates → readable errors, nothing saved |
| Ambiguous matching | Two bills of the same amount, or two credits → suggestion only |
| Manual reconciliation | Approve, reject, manual match, undo; audit entries |
| Cross-tenant access | Extend `tests/integration/tenant-isolation.test.ts`: every new endpoint and table with two pharmacies; inbox sealed for another pharmacy's device can't be opened |
| Provider API failure | 5xx → retry with backoff; 429 honours `Retry-After`; 401 → connection error, no retry |
| Webhook authentication failure | Bad/missing signature → 401, nothing stored; replayed event → idempotent |

Plus Playwright specs for the import → match → report path on both the server screen and the Drive counter. All test
data is synthetic; no real bank credentials anywhere in the repository (gitleaks already runs in CI).

### 5.2 Deployment items

- Environment variables (names only; values per partner): `FIN_STATE_SECRET`; per connector, e.g. `AA_PARTNER_BASE_URL`,
  `AA_PARTNER_CLIENT_ID`, `AA_PARTNER_CLIENT_SECRET`, `AXIS_API_*`, `PHONEPE_*`, `PAYTM_*`. A connector without its
  variables reports "Not yet supported" and cannot be connected. Added to `.env.example` and the start-up checker.
- Migrations: additive only, run by `scripts/vercel-build.sh` as today.
- Scheduling: decide Vercel Pro cron frequency (Decision D7).
- Monitoring: JSON logs (existing), Prometheus counters (`fin_sync_runs_total`, `fin_sync_failures_total`,
  `fin_webhook_rejected_total`), alert on failure rate.
- Backups: server tables are covered by Supabase backups; device data by DriveDB snapshots.

---

## 6. Provider API documentation references

Checked 1 November 2026. Re-verify each before building; some pages could not be fetched directly from this
environment.

- Sahamati — FIU requirements: <https://sahamati.org.in/financial-information-user-fiu>
- Sahamati — joining the AA network: <https://sahamati.org.in/?p=3007>
- Sahamati — TSP listing: <https://sahamati.org.in/tsp/fip-fiu-tsp>
- Sahamati documentation (GitHub): <https://github.com/Sahamati/documentation>
- ReBIT AA API specifications and FI schemas (Deposit v2.0.0, Jan 2025): <https://api.rebit.org.in>
- Finvu sandbox FIP data sample (Deposit transaction fields): <https://finvu.github.io/sandbox/fip_data_api.html>
- NPCI UPI Circular 43 (account statement narration for UPI): <https://www.npci.org.in/PDF/npci/upi/circular/2018/UPI%20-%20Circular%20No.43.pdf>
- ICICI Bank API Banking overview: <https://www.icici.bank.in/blogs/current-account/api-banking-icici>
- Axis Bank API portal: <https://apiportal.axisbank.com/portal/>
- HDFC Bank developer portal FAQ: <https://developer.hdfc.bank.in/faqs>
- PhonePe Integrated Static QR — introduction: <https://developer.phonepe.com/offline-integration/integrated-static-qr/introduction>
- PhonePe — Transaction List API: <https://developer.phonepe.com/offline-integration/integrated-static-qr/transaction-list-api>
- PhonePe — StaticQR S2S callback: <https://developer.phonepe.com/offline-integration/integrated-static-qr/staticqr-s2s-callback-api>
- Paytm — Settlement API: <https://paytmpayments.com/docs/api/settlement-api>
- Paytm — Settlement Detail API: <https://paytmpayments.com/docs/api/settlement-detail-api>
- Paytm — Settlement Transaction Detail API: <https://paytmpayments.com/docs/api/settlement-transaction-detail-api>
- Google Pay India — Omnichannel get transaction details: <https://developers.google.com/pay-wallet/regions/india/api/otherapis/omnichannel/get-transaction-details>
- BharatPe: no public developer documentation found.

---

## 7. Regulatory and partner dependencies

This is a checklist for a lawyer and for each partner, not legal advice. Nothing here is claimed as complied with.

### 7.1 Medoro's own position

- Medoro does not hold, move or settle funds, so it is not a payment aggregator or payment system operator under RBI
  rules, and not a UPI third-party app under NPCI. The product copy must keep saying so and the code must never
  initiate a payment.
- **DPDP Act, 2023 and the DPDP Rules:** for pharmacy data processed on Medoro's server (connection metadata, sync
  logs, inbox), Medoro acts for the pharmacy; the pharmacy's privacy notice and Medoro's terms need a section on bank
  and payment data. Bank statements contain third parties' data (customers, suppliers): purpose limitation and
  retention rules apply. Check the Rules' commencement dates for each obligation.
- **CERT-In directions (April 2022):** incident reporting within 6 hours and 180-day log retention for service
  providers; the sync-log retention above follows this.
- **IT Act s.43A / reasonable security practices:** covered by existing controls plus the items in 2.10; partners will
  likely ask for ISO 27001 or a VAPT report.

### 7.2 Per source

| Source | Dependency | Owner of the action |
|---|---|---|
| Account Aggregator | Regulated FIU partner (NBFC/bank/other RE) with a licence-aligned use case; TSP agreement; Sahamati membership via that partner; legal opinion on onward sharing to the pharmacy and to Medoro; purpose code and consent template approval; DPDP notice | Medoro founders + counsel |
| Direct bank APIs | Partner agreement per bank (or one connected-banking aggregator); bank security review (VAPT, IP allow-list, certificates); per-pharmacy activation by the bank (current account, mandate letter) | Medoro + each bank's API team; pharmacy signs the bank's mandate |
| PhonePe | Confirm whether existing PhonePe Business QRs work with the Integrated Static QR APIs; partner or per-merchant onboarding; production key issue | Medoro + PhonePe merchant/partnership team |
| Paytm | Confirm API (MID + key) access for Paytm for Business QR merchants, not only PG merchants; any partner programme | Medoro + Paytm |
| BharatPe | Ask whether any merchant data API or partnership exists | Medoro + BharatPe |
| Google Pay for Business | Ask whether a received-payments list exists for static QR merchants | Medoro + Google Pay |

### 7.3 Data location

Supabase (`ap-south-1` Mumbai) and Vercel (`bom1`) keep server data in India. **Google Drive storage location is not
selectable for ordinary accounts**, and DriveDB keeps the transaction data in the pharmacy's Drive. An AA or bank
partner contract may require India-only storage of the data it supplies. If it does, that source can only be offered
to self-hosted pharmacies or after a storage change, and this must be settled before signing (Decision D8).

---

## 8. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Keep transactions off Medoro's server for Drive pharmacies (device + Drive, server keeps connections and counts), instead of the brief's 14 Supabase tables? | **Yes.** It is what the product now promises; the brief's tables map onto server + device as in section 4 |
| D2 | Inbox hold time for fetched transactions when no counter is online | 14 days, then delete and re-fetch from the source if it allows |
| D3 | Add tenant-scoped `FORCE ROW LEVEL SECURITY` policies on the new server tables (beyond today's "RLS on, API roles revoked")? | Yes for new tables; existing tables unchanged |
| D4 | May a **statement file** the pharmacy uploads trigger automatic matches for rules 1–3? | Yes for rules 1–3 (the merchant's own bank file, exact reference), suggestions only for 4–5 |
| D5 | Pursue a multi-bank connected-banking aggregator instead of separate bank agreements? | Evaluate one aggregator before signing any single bank |
| D6 | Add a binary `.xls` parser dependency if HTML/XML detection does not cover the fixture banks? | Only if fixtures prove it necessary |
| D7 | Vercel Pro (frequent cron) for scheduled syncs | Needed before phase 3 goes live; phases 1–2 don't need it |
| D8 | If a partner requires India-only storage, offer that source to self-hosted pharmacies only? | Decide per partner when the contract terms are known |
| D9 | Start phases 1 and 2 now, and open partner conversations (section 7.2) in parallel? | **Yes** |
