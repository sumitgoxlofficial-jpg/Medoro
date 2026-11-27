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
| 4 | Low (copy) | Distributor-facing screens still use pharmacy wording: sign-in and two-step pages ("Bill faster… FEFO… Offline billing", "Trust this counter PC"), staff join flow ("Pharmacy code", "Pharmacy staff login"), plan page ("your pharmacy's name"), backup screen copy | **Fixed after recording** (`1cf9685`): Shared sign-in, staff login, two-step, plan and reset-email text is now neutral (Staff login, Business code, Trust this PC); the Distribution Users page describes the real join path |
| 5 | Low (UX) | The stock screen has no **Reserved** column; reserved packs are visible on each order's pick list and are netted in the order entry's Stock column | **Fixed after recording** (`1cf9685`): Stock screen shows Reserved and Free to sell per batch |
| 6 | Low (UX) | Sign-up errors that belong to an earlier step (e.g. "An account with this mobile number already exists") appear on the last wizard step | **Fixed after recording** (`1cf9685`): Distributor sign-up returns to the step the error belongs to |
| 7 | Low (a11y) | Credit-note line inputs on the invoice had no accessible names. (Companies and Territories forms were also listed here; that was a probe error — their fields are labelled) | **Fixed after recording** (`1cf9685`): quantity, condition, credit % and reason are labelled |
| 8 | Info | Portal discovery shows a distributor's address from its most recently created godown | **Fixed after recording** (`1cf9685`): Portal directory uses the first (main) godown's address |
| 9 | Medium (privacy) | Every role, including Salesman, Warehouse and Delivery, sees the full distributor dashboard: today's and month's sales, collections, total receivable and top outstanding chemists | **Fixed after recording** (`1cf9685`): Business-wide sales, collections, receivables and top outstanding now need the reports permission (Owner, Manager, Accountant); other roles see the order pipeline and stock alerts |
| 11 | Low (copy) | The password-reset email ends "let your pharmacy owner know" for a distributor owner | **Fixed after recording** (`1cf9685`): Reset email says "let the account owner know" |
| 10 | Low (UX) | "Against PO" on Receive goods lists only PO numbers, not the supplier, so the wrong PO is easy to pick (it happened in a first recording take of Part 08) | **Fixed after recording** (`1cf9685`): Against PO lists `PO no · supplier` |

Videos were recorded before the fixes marked "after recording", so they show the earlier behaviour (Part 23 narrates finding 9 as it was).

## 3. Feature status (verified on the demo server)

Legend: **Working** = demonstrated end to end on camera and checked in the demo database · **Partial** = works with the limits noted · **Requires configuration** = needs external credentials · **Not available** = not in the application · **Built** = added during this project.


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
| Dashboard | Sales today/month, margin, collected today, receivable/overdue, 30-day chart, order pipeline, expiry and reorder alerts, top outstanding with risk, ageing | Working | Money figures for reports roles only (finding 9, fixed) |
| Products | Add/edit, generic, strength, form, pack, company, HSN, GST, MRP/PTR/PTS (PTR+GST ≤ MRP check), schedule, barcode, packs per case, min order, reorder level, portal visibility, discontinue | Working | No delete by design (history kept) |
| | Bulk product import | Not available in Distribution | Shared Excel importer is pharmacy-only |
| Godowns & inventory | Add godown (plan limit), racks with pick order and cold chain, place product on rack | Working | |
| | Batch-wise stock, expiry, value at landed cost, reserved / free to sell, audited adjustment with reason, quarantine column | Working | Reserved columns added (finding 5) |
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
| Users & roles | Team list, invite (email for password roles, mobile for PIN roles), roles, permission matrix toggles, server-side enforcement, audit trail | Working | |
| Backup & security | Encrypted backup, recovery kit fingerprint, backup history, test restore, Drive connection | **Built** (menu) / Working (test Drive) | Finding 2; real Google Drive not connected |
| Subscription | Trial status, plan features and limits, licence check-in | Working | No payment made; payment details not set on demo server |
| Language | English ⇄ Hindi interface | Working | |


## 4. Recording QA


- **38 MP4 files:** 26 chapter videos and 12 compilations; the complete tour (V01) runs 1:30:02. All 1920×1080, 30 fps, H.264 (CRF 20) with AAC 160 kbps 48 kHz, about 1.4 GB in total. Chapter timestamps for every compilation are in its `_chapters.txt` and in `27_Scripts_Subtitles/Video_Titles_Descriptions_Timestamps.md`.
- **Recording method:** a real Chromium window (125 % zoom) on a 1920×1080 virtual display, captured with ffmpeg (x11grab, 30 fps). Staff phones (warehouse, delivery, salesman) and the chemist's phone are a second, phone-sized app window signed in as that person. Every screen is the real Medoro Distribution application; title cards, intro/outro and the "demo test inbox" panel are the only designed frames. An overlay draws a highlighted cursor, click ripples, spotlights, zoom-ins and callouts.
- **Voice-over:** Microsoft neural Hindi voice (hi-IN-SwaraNeural), spoken from Devanagari text with English business terms; each scene lasts at least as long as its narration. Subtitles are the Roman Hinglish text, burned in and supplied as SRT.
- **Music:** a light background track synthesised for this project (royalty-free), ducked under the voice; mix normalised to −16 LUFS.
- **Branding:** official Medoro logo and colours (#0B5E5B, #0B3A78, #0A9A80), IBM Plex type on chapter cards, outro and thumbnails.
- **Checks done:**
  - Every chapter's actions were checked twice: frames from the video, and the resulting rows in the demo database (orders, picks, invoices, deliveries, schemes, claims, POs).
  - Takes that did not match their narration were re-recorded: the whole set after the first takes were clipped on the right (browser window wider than the screen at 125 %) and after Chrome's "Save password?" bubble covered Part 03; Part 08 (wrong PO picked); Part 15 (short pick not registered, four takes); Part 16 (wrong invoices on the trip). Earlier takes are kept aside, not delivered.
  - Two scenes whose click did not happen were re-narrated to describe what the screen shows: Part 19 (cart updates without "Add to cart") and Part 23 (the salesman's phone shows the full dashboard — finding 9).
  - The complete tour's audio decodes without errors; audio and video durations differ by less than 0.1 s over 90 minutes.
  - Secrets (QR code, authenticator key, recovery codes) are blurred as they render; one-time sign-up and reset codes from the test inbox are shown, as they are demo-only and expired.
- **Known limitations:** synthetic voice; subtitle timing within a scene is proportional to text length, not word-aligned; the session clock is 27 Nov 2026, so "today" in the demo is that date; the history was entered by script through the app's services (see `30_Demo_Data`), while everything narrated as done on camera was done on camera.

| Chapter | Length |
|---|---|
| Part_01_Introduction | 3:17 |
| Part_02_Account_Registration | 4:08 |
| Part_03_Distributor_Onboarding | 4:29 |
| Part_04_Dashboard | 2:54 |
| Part_05_Product_Management | 3:29 |
| Part_06_Godown_Inventory | 3:55 |
| Part_07_Supplier_Management | 3:26 |
| Part_08_Purchase_GRN | 4:35 |
| Part_09_Batch_Expiry | 3:24 |
| Part_10_Sales_Orders | 3:22 |
| Part_11_Credit_Control | 3:44 |
| Part_12_Schemes_Free_Goods | 3:33 |
| Part_13_GST_Invoicing | 3:58 |
| Part_14_Expiry_Claims_Returns | 3:31 |
| Part_15_Picking_Packing | 2:39 |
| Part_16_Dispatch_Delivery | 3:01 |
| Part_17_Collections | 2:47 |
| Part_18_Salesman_Territories | 2:51 |
| Part_19_Chemist_Portal | 3:55 |
| Part_20_Accounts_Finance | 3:04 |
| Part_21_GST_Reports | 2:26 |
| Part_22_MIS_Analytics | 3:38 |
| Part_23_User_Permissions | 3:52 |
| Part_24_Backup_Security | 2:53 |
| Part_25_Subscription_Language_Workflow | 4:59 |
| Part_26_Conclusion | 2:01 |

| Compilation | Length |
|---|---|
| V01_Medoro_Distribution_Complete_Product_Tour | 1:30:02 |
| V02_Registration_and_Distributor_Onboarding | 8:37 |
| V03_Dashboard_and_Business_Overview | 6:11 |
| V04_Product_Inventory_and_Godown_Management | 10:49 |
| V05_Purchase_Suppliers_and_GRN | 8:01 |
| V06_Sales_Orders_and_Credit_Control | 7:07 |
| V07_Schemes_Discounts_and_GST_Invoicing | 7:31 |
| V09_Picking_Packing_and_Dispatch | 5:40 |
| V08_Chemist_Portal_and_Salesman_App | 6:46 |
| V10_Collections_Accounts_and_GST | 8:17 |
| V11_Expiry_Claims_and_MIS_Analytics | 7:10 |
| V12_Staff_Security_Backup_and_Subscription | 11:46 |

