# The 35 modules: where they are and what state they are in

Status: **Done** = database-backed, validated, permissioned, audited and tested; **Partial** = works, with the gap
named; **Shared** = provided by the existing MEDORO service, reached from Distribution screens.

| # | Module | Where | Status |
|---|---|---|---|
| 1 | Distributor dashboard | `/dist` · `reports.ts#distDashboard` | Done (today/month sales, margin, collections, receivable & ageing, order pipeline, expiry and reorder alerts, 30-day chart) |
| 2 | Company & manufacturer | `/dist/companies` · `masters.ts` | Done |
| 3 | Principal management | `/dist/companies` | Done (supplier link, margin, divisions, agreement dates, expiry-claim terms) |
| 4 | Product & medicine catalogue | `/dist/products` | Done (PTR/PTS, HSN, GST, MRP, schedule, packs, min order, reorder level, portal visibility). Bulk import: the shared Excel importer is pharmacy-only — Partial |
| 5 | Supplier management | `/dist/companies` (suppliers) | Shared (create, credit days, lead time, returns) |
| 6 | Chemist & retailer | `/dist/chemists`, `/dist/chemists/[id]` | Done (licences + validity, KYC verification, GSTIN checksum, credit terms, territory, salesman, price tier, hold/block, special rates, statement) |
| 7 | Purchase management | `/dist/purchases` | Done (shared GRN posting) |
| 8 | Purchase orders | `/dist/purchases?tab=po` | Done (draft → place → receive / close short / cancel) |
| 9 | Goods receipt notes | `/dist/purchases?tab=grn` | Done (shared `postGrn`: batches, landed cost, ITC, totals check) |
| 10 | Wholesale sales billing | `/dist/billing`, order invoicing | Done |
| 11 | GST invoicing | `billing.ts`, `/dist/invoices/[id]` | Done (CGST/SGST/IGST, place of supply, HSN, ≤16-char numbers, printable A4). IRN on distribution invoices: not wired — see INTEGRATIONS |
| 12 | Sales returns | `/dist/invoices/[id]` → credit note | Done |
| 13 | Purchase returns | `/dist/expiry` (claims), shared supplier returns | Done for expiry/breakage claims; plain non-claim returns use the shared debit-note service (no dedicated distribution screen) — Partial |
| 14 | Batch management | `/dist/stock` | Done (batch-wise, expiry, quarantine, racks) |
| 15 | Expiry management | `/dist/expiry` | Done |
| 16 | Free scheme management | `/dist/schemes` · `rules/schemes.ts` | Done |
| 17 | Customer credit management | `/dist/credit` | Done |
| 18 | Supplier claims | `/dist/expiry?tab=claims|recon` | Done |
| 19 | Godown management | `/dist/godowns` | Done (plan limit enforced) |
| 20 | Rack management | `/dist/godowns` | Done |
| 21 | Stock transfers | `/dist/stock?tab=transfers` | Shared (request → approve/send → receive) |
| 22 | Warehouse picking | `/dist/warehouse` (mobile) | Done. Barcode scanning while picking: not implemented — Partial |
| 23 | Dispatch management | `/dist/dispatch` | Done |
| 24 | Delivery management | `/dist/deliveries` (mobile) | Done (POD by receiver name; photo/signature capture not implemented) |
| 25 | Salesman management | `/dist/territories`, `/dist/field` | Done |
| 26 | Territory management | `/dist/territories` | Done |
| 27 | Customer order portal | `/portal` | Done. Missing: portal password reset and email verification (accounts are verified by the distributor's licence check) — Partial |
| 28 | Payment collection | `/dist/collections`, field app, delivery | Done (cash, UPI, NEFT, cheque) |
| 29 | Accounting & ledgers | `/dist/accounts` | Shared (trial balance, day book, chemist ledger statements) |
| 30 | Bank reconciliation | `/dist/accounts?tab=bank` | Shared |
| 31 | GST reports | `/dist/gst`, `/api/dist/gst` | Done (GSTR-1 JSON, GSTR-3B JSON, HSN CSV; filing is on the GST portal) |
| 32 | Business MIS reports | `/dist/reports` | Done (14 reports, CSV) |
| 33 | AI business intelligence | `/dist/insights` | Done as transparent statistics + rule-based assistant (no language model) |
| 34 | User & permission management | `/dist/users` | Done (invites, roles, permission matrix, deactivate, audit trail) |
| 35 | Subscription & licensing | `/dist/plan` | Done (plans enforced server-side; shared licence server). Online payment for distribution plans: not wired — Partial |

Not supported in Distribution: offline billing / device sync (the pharmacy counter's offline mode doesn't apply to a
multi-godown wholesale operation); WhatsApp/SMS notifications to chemists; e-way bill generation.
