# Reference Repository Analysis

Inspected: 27 Oct 2026. Source: the public GitHub repository pages and READMEs. Source files were **not** cloned or executed. Claims about internals come from each README and should be confirmed in code before anything is relied on.

**Policy:** Medoro is an original codebase. No code is copied from any reference. Patterns are re-implemented from first principles. If any code is reused later, it must first get a license review and keep its attribution.

---

## Summary

| Repo | Status | Stack | License (per GitHub) | Reuse posture |
|---|---|---|---|---|
| psvineet/grxstore | **Not accessible** (fetch failed) | Unknown | Unknown | None. Retry later; assume no rights |
| drkNsubuga/PharmaSpot | Accessible | Electron, Node, NeDB-style local server | MIT | Ideas only |
| seifosmaan53/pharmacy-pos | Accessible | Next.js 16, React 19, TS, Prisma, SQLite, Zod, jose, pdf-lib, Vitest | MIT | Ideas only. Closest to Medoro's stack |
| Jerophin123/MedicPOS | Accessible | Spring Boot 3, Java 17, PostgreSQL, Angular 17 | **No license file shown** | **Do not reuse code.** Without a license, all rights are reserved |
| psvineet/drxstore | Accessible | PHP 7.4, JSON files or MySQL | **No license file shown** | **Do not reuse code** |

---

## 1. psvineet/grxstore
- The page could not be fetched on 27 Oct 2026 (network or availability error).
- Its contents are unknown. Nothing here is inferred about it.
- Action: retry, and if it's still unavailable, record it as excluded.

## 2. drkNsubuga/PharmaSpot (MIT)
**What it shows:** a cross-platform pharmacy POS on Electron. Several PCs share one central database on the network. It has receipt printing, barcode search, staff permissions, open tabs, customers, transaction filters by till, cashier and date, expiry tracking and alerts, low-stock alerts, and profit per item. The README credits it as adapted from tngoman/Store-POS.

**Useful patterns**
- Multi-PC mode: one host machine plus LAN clients. This validates Medoro's "Shop LAN" deployment option.
- Filtering transactions by till and cashier feeds shift reconciliation.
- Expiry and low-stock alerts on the main screen.

**Concerns**
- The default credentials (admin/admin) are documented. Medoro must force credential setup on first run.
- Backup, restore and export are listed as roadmap items, not implemented.
- There is no batch-level FEFO model described in the README.
- Electron carries a larger attack surface than Tauri. Medoro prefers Tauri for the desktop app.

## 3. seifosmaan53/pharmacy-pos (MIT)
**What it shows:** a Next.js and Prisma pharmacy POS, described as a rebuild of an older WinForms app.

**Useful patterns, all matching Medoro's requirements**
- **Money as integer minor units** (`lib/money.ts`). Medoro uses integer paise everywhere.
- **Batch-level stock with FEFO** as a pure, testable function (`lib/fefo.ts`) used inside a Prisma `$transaction`.
- **Server-authoritative totals:** Zod validation, prices re-derived from the database, and stock decrement plus sale in one transaction.
- **Revocable sessions** through a `tokenVersion` column. Startup fails if the secret is shorter than 32 characters.
- Vitest unit tests on the money and FEFO logic, plus an integration script for a sale that rolls back afterwards.

**Concerns and gaps for Medoro's needs**
- Uses SQLite. Medoro needs PostgreSQL with row locking (`SELECT … FOR UPDATE`) for concurrent multi-counter sales.
- Only two roles. Medoro needs fine-grained permissions.
- No end-to-end or UI tests, as its README says.
- Early project (7 commits, 0 stars). Not a maintenance signal to depend on.

## 4. Jerophin123/MedicPOS (no license shown)
**What it shows:** Spring Boot, PostgreSQL and Angular. Ten core tables: users, medicines, batches, bills, bill_items, payments, returns, return_items, stock_barcodes, audit_logs. GST per item, HSN codes, PDF bills with iText 7, ZXing barcode scanning, Swagger docs.

**Useful patterns**
- **Optimistic locking** (a `version` column) on medicines and batches to catch concurrent edits.
- Product barcode (GTIN/EAN) kept separate from optional per-unit serial barcodes.
- Bills are cancelled with a flag, never hard-deleted. Audit logs keep before and after values plus IP.
- Composite index on `(medicine_id, expiry_date)` for FEFO queries.
- Returns linked to the original bill item.

**Concerns**
- **No license file was visible.** Code must not be copied. Only general architectural ideas, which aren't copyrightable, are referenced.
- The README ships a sample JWT secret and a shared default password for every user. Insecure if used as-is.
- iText 7 is AGPL or commercial. Medoro avoids it and uses pdf-lib (MIT) or similar.
- Database migrations are ad-hoc SQL scripts. Medoro uses versioned Prisma migrations.

## 5. psvineet/drxstore (no license shown)
**What it shows:** a PHP app with JSON-file storage and optional MySQL. Portals for admin, supplier and customer. A setup wizard, CSV import with duplicate detection, POs emailed to suppliers, cheque payment details, rack location, a ledger, and expiry tiers (expired, 30 days, 90 days).

**Useful patterns**
- A first-run setup wizard. Medoro's onboarding follows the same idea.
- CSV catalogue import with preview and duplicate detection. Add this to the Medoro backlog.
- Rack or shelf location on the medicine record.
- Login lockout after 5 failures for 15 minutes, and CSRF tokens on forms.

**Concerns**
- No license visible, so the code must not be reused.
- JSON-file storage isn't safe for concurrent multi-device writes.
- Password reset goes through a personal email address, which can't scale and isn't secure.

---

## Patterns Medoro adopts (re-implemented originally)
1. Integer paise for all money, with exact GST back-calculation from MRP-inclusive prices.
2. A pure FEFO allocator with unit tests, called inside a database transaction with `FOR UPDATE` row locks on batches.
3. Server-side recalculation of totals. The client cart is only a suggestion.
4. Optimistic `version` columns on mutable master data, row locks on stock.
5. Immutable invoices and ledger entries. Corrections post as credit notes or reversals.
6. Revocable sessions, a required strong secret, login rate-limiting, and no default credentials.
7. A setup wizard, CSV import, rack location, and returns linked to the original line item.

## Avoid
- AGPL dependencies (iText) in the closed SaaS product.
- Shipping default credentials or sample secrets.
- File-based storage for shared, multi-device data.
