# Medoro Distribution – QA and feature-status report

Product tour production, 27 November 2026 (session clock). Demo history is dated 28 Sep – 26 Nov 2026; everything done on camera is dated 27 Nov 2026.

## 1. Test environment (production was not touched)

| Item | Value |
|---|---|
| Application | Medoro repository `sumitgoxlofficial-jpg/medoro`, branch `claude/lucid-fermi-lrqhzg`, production build (`next build` + `next start`) |
| Server | Local demo server in an isolated cloud container, `http://localhost:3000`, configured like Medoro's hosted service (`DEPLOYMENT_MODE=hosted`, `PUBLIC_SIGNUP=1`) with `DIST_HOSTED=1`, so distributor records live in the server database and the full Distribution ERP (`/dist`) is used |
| Database | Separate local PostgreSQL 16 database `medoro_distdemo` (all 93 migrations applied) |
| Email | Local HTTPS mail sink acting as the authorised test inbox for sign-up and password-reset codes. No real email was sent |
| Licence | A local licence server on the same demo machine (own key pair), so the Subscription screen shows a real 7-day Professional trial. No payment gateway; no payment made |
| Google Drive | The app's built-in test Drive (`E2E_FAKE_DRIVE=1`). Real Google sign-in is not configured on the demo server |
| E-invoice / e-way bill, GSTN filing, bank feeds, WhatsApp/SMS | Not connected (no credentials; several are not wired for Distribution at all). Shown only as their real status |
| Live website | https://medoro.in/distribution opened read-only in Parts 01, 02, 25. No account was created on production |
| Browser | Chromium (Playwright), 1920×1080 at 125 % scale, Asia/Kolkata, en-IN; staff phones are a second, phone-sized app window signed in as that employee |

Note on hosting: on medoro.in today, new distributors sign up in **Drive mode** (`DIST_DRIVE=1`, records on the distributor's devices and Google Drive, screens at `/dist/device`). This tour uses the server-database Distribution ERP (`/dist`), which is what a distributor gets on its own server/database or with `DIST_HOSTED=1`. The business workflows and rules are the same code (`src/domain/distribution/rules`), but the screens differ.

Demo account and data: see `30_Demo_Data/README.md`.

## 2. Bugs and gaps found, and what was done

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High (gap)** | **No supplier outstanding, ledger or payment screen in Distribution.** Supplier dues were visible only as one "Sundry creditors" total in the trial balance; suppliers could not be paid from the Distribution app (the pharmacy screens redirect distributors to `/dist`) | **Fixed** (`ffb5ca0`): `/dist/suppliers/[id]` (we owe, last purchase/payment, ledger statement with date range, recent GRNs, *Pay supplier* using the shared payment service, oldest bills first); "We owe" column and links on Companies & principals; Hindi strings; integration test `tests/integration/dist-payables.test.ts` |
| 2 | **High (gap)** | **Distributors could not reach Backup & restore.** `/app/backup` redirects a distribution tenant to `/dist`, and the Distribution menu had no backup screen, although the shared encrypted backup covers every distribution table | **Fixed** (`ffb5ca0`): `/dist/backup` renders the shared backup screen; *Backup & restore* added under System |
| 3 | Low (copy) | Sign-up verification email told distributors "…create your **pharmacy** account" | **Fixed** (`ffb5ca0`): the distributor sign-up passes the product; the email says "distributor account" |
| 4 | Low (copy) | Distributor-facing screens still use pharmacy wording: sign-in and two-step pages ("Bill faster… FEFO… Offline billing", "Trust this counter PC"), staff join flow ("Pharmacy code", "Pharmacy staff login"), plan page ("your pharmacy's name"), backup screen copy | Open (recorded as observed) |
| 5 | Low (UX) | The stock screen has no **Reserved** column; reserved packs are visible on each order's pick list and are netted in the order entry's Stock column | Open (narration describes the real behaviour) |
| 6 | Low (UX) | Sign-up errors that belong to an earlier step (e.g. "An account with this mobile number already exists") appear on the last wizard step | Open |
| 7 | Low (a11y) | Some forms have inputs without accessible labels (Companies/principals/suppliers, Territories/salesmen, the credit-note lines on the invoice) | Open |
| 8 | Info | Portal discovery shows a distributor's address from its most recently created godown | Open |
| 9 | Medium (privacy) | Every role, including Salesman, Warehouse and Delivery, sees the full distributor dashboard: today's and month's sales, collections, total receivable and top outstanding chemists | Open (shown honestly in Part 23) |
| 10 | Low (UX) | "Against PO" on Receive goods lists only PO numbers, not the supplier, so the wrong PO is easy to pick (it happened in a first recording take of Part 08) | Open |

## 3. Feature status (verified on the demo server)

Legend: **Working** = demonstrated end to end on camera or in rehearsal · **Partial** = works with the limits noted · **Requires configuration** = needs external credentials · **Not available** = not in the application · **Built** = added during this project.


| Area | Feature | Status | Notes |
|---|---|---|---|
| Registration | medoro.in/distribution → Start 7-day free trial | Working | Live site opened read-only; account created on the demo server |
| | Email verification (6-digit code, 10 minutes) | Working | Code to the demo test inbox |
| | Google sign-up / sign-in | Requires configuration | Google sign-in isn't configured on the demo server |
| | Login, two-step verification (TOTP), trust PC 30 days, recovery codes | Working | Secrets blurred on screen |
| | Forgot password (email code, signs out every device) | Working | Recorded last (Part 02, second half) |
| | Trial activation, no card | Working | 7-day Professional trial from the local licence server |
| Onboarding | Business name, GSTIN (format + checksum), wholesale drug licence, address, business code, owner, godowns, recovery kit, terms | Working | |
| | State, city, financial year, tax configuration as separate settings | Not available | Address is one field; FY is automatic (Apr–Mar) in document numbering; GST is per product |
| | Godown code/GSTIN/licence/address, legal name, min shelf life, cover/safety days, credit-rule mode | Working | |
| Dashboard | Sales today/month, margin, collected today, receivable/overdue, 30-day chart, order pipeline, expiry and reorder alerts, top outstanding with risk, ageing | Working | Visible to every role (finding 9) |
| Products | Add/edit, generic, strength, form, pack, company, HSN, GST, MRP/PTR/PTS (PTR+GST ≤ MRP check), schedule, barcode, packs per case, min order, reorder level, portal visibility, discontinue | Working | No delete by design (history kept) |
| | Bulk product import | Not available in Distribution | Shared Excel importer is pharmacy-only |
| Godowns & inventory | Add godown (plan limit), racks with pick order and cold chain, place product on rack | Working | |
| | Batch-wise stock, expiry, value at landed cost, audited adjustment with reason, quarantine column | Working | No "Reserved" column (finding 5) |
| | Godown transfer request → approve & send → receive | Working | |
| | Reorder suggestions | Working | Business intelligence |
| Companies & suppliers | Companies, principals (margin, divisions, claim window and credit %), suppliers (GSTIN, credit/lead days, returns) | Working | |
| | Supplier outstanding, ledger statement, supplier payment | **Built** | Finding 1 |
| Purchases | PO draft → place; GRN against PO with batch, expiry, free goods, trade discount, printed-total check (±₹1); stock and supplier ledger update; partial receipt | Working | |
| | AI / OCR invoice reading | Requires configuration | Remote OCR not configured |
| Batch & reservation | FEFO batch reservation on approval, pick list with rack/batch/expiry, min-shelf-life rule, expiry bands, stock statement | Working | |
| Orders | Book order (office, phone, salesman, portal), special rate, schemes, stock column, credit status, approve, reject with reason, cancel, status timeline | Working | No editing after placing (cancel and re-book) |
| Credit control | Limits, utilisation, overdue, ageing buckets, risk score with reasons, filters; over-limit order → credit hold; override needs permission + reason; approve after collection; hold/block; expired licence refusal | Working | ₹50,000 limit / ₹45,000 dues example shown without overriding |
| Schemes | Free goods (slabs), % discount, product or company, chemist-only, validity, portal flag; automatic on order/invoice; free goods deducted from stock | Working | |
| GST invoicing | Direct invoice, PTR/PTS tier, CGST+SGST same state, IGST inter-state (Bihar), HSN, series per godown & FY, A4 print, invoice history, same-day cancel | Working | |
| | E-invoice (IRN), e-way bill | Not available | Made on government portals (as the website says) |
| Returns & claims | Credit note from invoice: saleable back to stock, damaged/expired to quarantine, credit %, proportional GST | Working | |
| | Expiry workbench, claim within principal's window, acknowledgement, record company credit note, reconciliation | Working | No company settlement was invented; the credit-note form is only shown |
| Picking & packing | Pick queue, mobile pick list (rack, batch, expiry), start, picked all, short pick, boxes, pack, invoice what was picked | Working | Barcode scan while picking not available |
| Dispatch & delivery | Trip (vehicle, driver, route, delivery user), van left, delivery phone, receiver name, cash/UPI/cheque at door, failed delivery back to desk, trip status | Working | POD photo/signature not available |
| Collections | Cash, UPI, NEFT, cheque; FIFO bill-wise allocation; partial/full; over-payment refused; receipts list | Working | |
| Salesman & territories | Territories with PIN codes, salesmen with targets, link to user, field app (own chemists, book order, collect), salesman/territory reports | Working | |
| Chemist portal | Register, find distributor, ask to connect with KYC share, distributor approval with credit terms, catalogue with own rates/schemes/stock band, cart, order to approval queue, order tracking, dues | Working | Password reset / email verification not available on the portal |
| Accounts | Double-entry vouchers, trial balance, day book, chemist ledger, supplier ledger (built), bank statement import & matching | Working | |
| | Expense entry form, profit & loss, cash book as separate screens | Not available in Distribution | Expenses in the demo were entered through the shared service |
| | Bank feeds / Account Aggregator | Not available | Statement import only |
| GST reports | GSTR-1 JSON, GSTR-3B JSON, HSN CSV, HSN summary, ITC; purchase register | Working | Filing is on the GST portal after the CA checks |
| MIS & BI | 14 MIS reports with date range and CSV; reorder, expiry loss, dead stock, product and scheme profitability, credit risk, sales forecast; rule-based assistant | Working | All 14 advertised reports exist |
| Users & roles | Team list, invite (email for password roles, mobile for PIN roles), roles, permission matrix toggles, server-side enforcement, audit trail | Working | Dashboard visible to all roles (finding 9) |
| Backup & security | Encrypted backup, recovery kit fingerprint, backup history, test restore, Drive connection | **Built** (menu) / Working (test Drive) | Finding 2; real Google Drive not connected |
| Subscription | Trial status, plan features and limits, licence check-in | Working | No payment made; payment details not set on demo server |
| Language | English ⇄ Hindi interface | Working | |


## 4. Recording QA

(filled in after recording)
