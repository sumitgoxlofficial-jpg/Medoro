# Architecture

## 1. Planes
```
┌──────────────────────── Customer-controlled environment ────────────────────────┐
│  Browsers / Tauri desktop / tablets  ──HTTPS──▶  Medoro App Service (Next.js)   │
│                                                   ├─ Route handlers (REST, Zod) │
│                                                   ├─ Domain services            │
│                                                   ├─ AI tool registry + local LLM│
│                                                   ├─ Job worker (backups, WA)   │
│                                                   └─ Webhook receiver           │
│                                                          │ TLS, least-priv role │
│                                                   PostgreSQL 16 (live DB)       │
└───────────────────────────────────────┬─────────────────────────────────────────┘
          outbound only, explicit opt-in│
   ┌──────────────┬─────────────────────┼──────────────────┬───────────────────┐
   Meta WA Cloud API   Google Drive API (encrypted blobs)   Optional remote AI   Medoro Control Plane
                                                                                (accounts, plans, licences)
```
- **Data plane:** everything that holds pharmacy records runs inside the customer's environment. PostgreSQL is never exposed to browsers or the public internet.
- **Control plane (Medoro-operated):** accounts, subscriptions, signed licence tokens, release channel, support tickets. **No pharmacy operational data.**

## 2. Deployment modes
| Mode | DB | Notes |
|---|---|---|
| Customer cloud | PostgreSQL on the customer's VM or managed DB | Customer owns the cloud account |
| On-premises | PostgreSQL on a customer server | Same container images |
| Shop LAN | PostgreSQL on the host PC, Tauri clients | mDNS discovery, TLS with a local CA |
| Hosted PostgreSQL | Managed PostgreSQL (Supabase, Neon, RDS…) over TLS | App on Vercel or any host; see VERCEL_SUPABASE.md |

## 3. Domain modules (`src/domain/*`)
catalogue · inventory (batches, movements, FEFO, counts, transfers, recalls) · sales (carts, invoices, payments, returns, shifts) · purchasing (PO, GRN, supplier invoices, returns) · parties (customers, suppliers, balances) · accounting (vouchers, ledger, GST summary) · comms (WhatsApp, campaigns, consent) · ai (tool registry, confirmations) · intelligence (forecast, reorder, anomalies) · backup · sync (offline queue) · identity (users, roles, sessions, MFA) · tenancy (tenant, branch) · licensing.

Each module exposes **services** (pure business rules plus repository calls) and **Zod contracts**. Route handlers, the AI tools and background jobs all call the same services. There is no second code path.

## 4. Transaction rules
- **Sale commit** (one DB transaction, `SERIALIZABLE` or `READ COMMITTED` plus row locks):
  1. Check the idempotency key (unique on `sales.idempotency_key`). If it exists, return the stored result.
  2. `SELECT … FROM batches WHERE id = ANY($1) FOR UPDATE`.
  3. Re-validate eligibility: status `ok`, `expiry_date > today`, qty available. Re-derive prices from the database.
  4. Allocate with the pure FEFO function (unit-tested).
  5. Insert the sale, sale items, payments and stock movements (negative), and decrement `batches.qty_available`.
  6. Take the invoice number from a per-branch, per-fiscal-year sequence row locked `FOR UPDATE`.
  7. Post ledger vouchers. Write the audit event.
- **Money:** `BIGINT` paise. GST is back-calculated from the MRP-inclusive price per line: `taxable = round(net × 100 / (100 + rate))`, CGST = floor(tax / 2), SGST = remainder. Round-off goes to the nearest rupee on a separate line.
- **Units:** batches hold stock units (the smallest unit a medicine is sold in; whole packs when `packSize` is 1). Prices and costs stay per pack; a loose unit sells at MRP ÷ pack size rounded down. See [CATALOG.md](CATALOG.md).
- **Immutability:** invoices, vouchers and movements are append-only. Corrections are credit notes, reversals or adjustment movements. A database trigger blocks `UPDATE` and `DELETE` on posted tables.

## 5. Concurrency & sync
- Optimistic `version` on master data (medicines, suppliers, customers, prices).
- Live multi-device updates go over server-sent events per branch channel.
- Offline (opt-in per device): each device gets a **reserved stock quota** per batch. Queued operations carry a ULID, the device ID and a base version. On reconnect the server re-validates price, permission and stock, then posts the operation or marks a conflict for review. Offline sales show as "provisional" until they post.
  Implemented in `src/domain/sales/offline.ts` and `/offline`: share = floor(stock ÷ (offline devices in the branch + 1)), refreshed every 5 minutes while online. Online counters can't sell a share another device still holds (it lapses with the snapshot after 7 days); a device's synced bills use up its own share first; bill ids are random `off_…` keys used as the sale idempotency key, so resending never double-posts; bills keep their device time (accepted up to 7 days back, never in the future); credit and split payments stay online-only. Conflicts are settled on Sync & offline by re-allocating the same quantities with FEFO from current stock, or closing with a note.

## 6. AI
The AI calls tools that wrap the domain services (see AI_ASSISTANT.md). It runs on a local model by default (Ollama or llama.cpp on the app host). Remote providers need explicit opt-in and get minimised context.

## 7. Key decisions
| Decision | Why |
|---|---|
| PostgreSQL only (no SQLite mode) | Row locks, concurrency, PITR |
| Tauri over Electron | Smaller attack surface, minimal native permissions |
| pdf-lib for invoices | MIT license; avoids AGPL iText |
| Integer paise | Exact arithmetic |
| One service layer for UI and AI | The same permission and validation path |
| Signed offline licences | Customer-hosted installs keep working without phoning home |

## 8. Threat model (summary; see SECURITY.md)
Assets: invoices, prescriptions, customer phone numbers, stock, money, backup keys, integration tokens. Main threats: cross-tenant access, insider fraud (discounts, voids), stolen devices, token leakage, AI prompt injection through OCR text, backup theft, supply-chain attacks.
