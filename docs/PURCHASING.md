# Purchasing, claims, cheques and bank reconciliation

How Medoro prices purchases the way Indian pharma distributors bill them, imports their digital bills, tracks
expiry/breakage claims, handles cheques (including post-dated ones) and reconciles the bank. Money is integer paise
throughout; percentages are applied in basis points and rounded once per step.

## Purchase pricing (PO and GRN lines)

Each line carries **PTR** (price to retailer, per pack, excluding GST), optional **PTS** (price to stockist, kept for
reference), **MRP**, a **scheme** such as `10+2` (buy 10, get 2 free), and **scheme / trade / cash discount %**.

Per line (`src/domain/purchasing/pricing.ts`):

| Step | Formula |
|---|---|
| Gross | paid qty × PTR |
| Scheme discount | gross × scheme % |
| Trade discount | (gross − scheme discount) × trade % |
| Cash discount | (after trade) × cash % |
| **Purchase value (net)** | gross − all discounts |
| GST | GST base × catalogue GST rate (see below) |
| Supplier bills | net + GST |
| **Landed cost / unit** | (net + GST if not claimable) ÷ (paid + free units) |

A scheme fills the free quantity when none is typed (25 on `10+2` → 4 free). Free units go into stock at the landed
cost, so they lower the batch cost instead of being recorded at zero. When a batch number is topped up, the batch
cost is the weighted average of what's on hand and the new receipt's total landed cost.

### What GST is charged on (configurable: Purchases → Pricing rules, owner only)

| Setting | GST base | When to use |
|---|---|---|
| `net` (default) | Value after scheme, trade and cash discounts | CGST Act s.15(3)(a): discounts given before or at the time of supply and shown on the invoice are excluded from the taxable value. This is how Marg/BUSY-style distributor bills are usually computed. |
| `before_cd` | After scheme and trade discounts, before cash discount | Distributors who treat cash discount as a settlement (post-supply) discount and print GST before it. |
| `gross` | PTR × paid quantity | Distributors who print GST on the undiscounted PTR value. |

Free quantity is never taxed separately: CBIC circular 92/11/2019-GST treats "buy X get Y free" as one supply whose
value is the price paid for the lot, so the supplier's GST is on the paid quantity only and the retailer's input tax
credit is whatever the bill shows.

**Input GST** setting: *claimed* (regular registration: GST goes to Input CGST/SGST/IGST and stock is valued without
it) or *not claimable* (composition scheme: GST is added to purchase value and landed cost). Each GRN stores the
rules it was posted with (`Grn.gstBase`, `Grn.itc`), and each line stores its discounts, GST base, GST and landed cost.

### GRN posting

| Account | Dr | Cr |
|---|---|---|
| Purchases | net (net + GST when not claimable) | |
| Input CGST + SGST, or Input IGST | GST (only when claimable) | |
| Round off | ± difference to the printed total (≤ ₹1) | |
| Sundry creditors (supplier) | | printed total |

The supplier bill (due date tracking) is the printed total. The GST summary report reads each line's stored GST base
and GST, so it agrees with the input-tax ledgers.

### Margins and price comparison

* **Insights → Margins on landed cost**: last 30 days of sales by item, category (dosage form) or supplier of the batch
  sold — selling value excluding GST, net of returns, against the landed cost carried on each sale line — and margin on
  stock in hand (MRP excluding GST against batch landed cost). CSV export.
* **Supplier price comparison** compares each supplier's latest landed cost per unit, so a supplier with a higher PTR
  but a better scheme can come out cheaper. The PTR and scheme are shown beside it.
* The GRN screen shows landed cost and margin on MRP for every line as you type.

## Distributor e-bills (Purchases → Receive invoice → Import e-bill)

Distributors export bills as CSV, Excel or delimited text from Marg, BUSY, Logic, GoFrugal and others. We could not
find a publicly documented, verifiable field layout for any of these exports (Marg's own import also asks the user
to map columns), so Medoro does not hard-code one. Instead:

* **Readers**: `.csv` (comma, semicolon or tab), `.xlsx`, and `.txt`/`.dat`/`.prn` files where most lines are
  pipe-separated (`|`). Letterhead rows above the column header are skipped.
* **Header detection**: column names are matched against common spellings (Item Name/Product/Particulars, Batch/B.No,
  Exp/Expiry, Qty, Free/Bonus/Sch Qty, M.R.P., PTR/Rate, PTS, GST %/Tax %, Disc %/TD, CD %, Scheme, HSN, Barcode,
  Item Code, Bill No, Bill Date). Totals rows and rows without an item name or numeric quantity are skipped.
* **Column mapper**: when required columns (item, batch, expiry, quantity, rate) aren't found — e.g. headerless pipe
  files — the user picks a column for each field, can choose the header row, and can keep only rows whose given
  column equals a record type (e.g. `D` detail lines in `H|…`/`D|…`/`T|…` files). The mapping is saved on the supplier
  (`Supplier.ebillMapping`), re-anchored by header names next time so reordered columns still read.
* **Matching** (`src/domain/purchasing/ebill-service.ts`), in order: barcode → the supplier's item code learned from
  earlier GRNs → the supplier's item name + pack learned earlier → fuzzy name + pack (marked low confidence; the user
  must tick *verified* on the GRN). Unmatched lines are resolved in the dialog by picking a medicine or creating one
  (prefilled from the bill). Codes and names are remembered (`SupplierItemMap`) when the GRN is posted.
* Lines land in the normal GRN form with batch, expiry, quantity, free, scheme, PTR, PTS, MRP and discounts, and go
  through the same checks (printed-total match, PO limits, batch/expiry/MRP consistency) before posting.

Fixtures: `tests/fixtures/ebill/` (a letterheaded CSV and a headerless pipe file with record types).

## Expiry / breakage claims (Purchases → Claims, or a batch's actions in Stock)

Two ways to send stock back:

* **Return (debit note)** — unchanged: the payable is reduced at once.
* **Claim** — reason *expired*, *near expiry*, *breakage* or *wrong item*; tracked *raised → acknowledged → credit note
  received / rejected*. The supplier's credit note often arrives weeks later and for less than claimed, so:

| Event | Dr | Cr |
|---|---|---|
| Raise claim (stock leaves at batch landed cost) | Supplier claims receivable | Purchases; Input GST reversed (none when GST was in cost) |
| Credit note received (partial allowed) | Sundry creditors (supplier) | Supplier claims receivable; any excess → Claim write-off (recovery) |
| Close with shortfall / reject | Claim write-off (expense, in P&L) | Supplier claims receivable |

Input GST is reversed when the goods go back, because ITC isn't available on goods destroyed or not used for
business (CGST Act s.17(5)(h)); a shortfall on the credit note is therefore a pure expense. Credit notes settle the
supplier's oldest open bills. The claims screen shows aging per supplier (0–30 / 31–60 / 61–90 / 90+ days) and a
"claim before it's too late" list: stock from suppliers who accept returns, expiring within that supplier's
**return window** (`Supplier.returnWindowDays`, set on the supplier form; expired stock included).

## Cheques and post-dated cheques (Cheques)

Pay a supplier or receive from a customer with method **Cheque** (6-digit cheque number, bank, cheque date; post-dated
allowed; cheques older than three months are refused as stale). Postings go through clearing accounts, so the bank
balance only moves when the money really moves:

| Event | Customer cheque (received) | Supplier cheque (issued) |
|---|---|---|
| Recorded | Dr Cheques in hand / Cr Debtors | Dr Creditors / Cr Cheques issued (uncleared); bills settled |
| Deposited | status only (not before the cheque date) | — |
| Cleared | Dr Bank / Cr Cheques in hand | Dr Cheques issued / Cr Bank |
| Bounced | Dr Debtors / Cr Cheques in hand; charge recovered: Dr Debtors / Cr Bank charges | Dr Cheques issued / Cr Creditors; bills reopened; supplier penalty: Dr Bank charges / Cr Creditors (new bill) |
| Our bank's return charge | Dr Bank charges / Cr Bank | Dr Bank charges / Cr Bank |

Cheque vouchers can't be "reversed" in Accounting; a bounce is the correction. Every step is audited. Open cheques
dated within three days appear on the dashboard and as a sidebar badge.

## Bank reconciliation (Bank)

Upload a bank statement (CSV, Excel .xlsx, or the .xls most banks offer, which is an HTML or Excel 2003 XML file;
old binary .xls and PDF are refused with instructions). Rows that can't be read are listed by row number. Columns are detected (Date / Txn date, Narration, Chq/Ref no, Withdrawal,
Deposit, or a signed/Dr-Cr Amount, Balance) or mapped once and saved. Re-uploading the same file skips lines already
imported. Each statement line is matched to a Bank account ledger line with the same amount and direction within ±3
days: a shared cheque number or UTR wins; otherwise only an unambiguous single candidate is matched. The rest can be
matched by hand (same-amount entries within 15 days are offered) and unmatched again. The page shows statement lines
not in the books, book entries not yet on a statement (cheques in transit), the last statement balance against the
books, and exports the unreconciled items as CSV.

On Drive counters, statements are matched to bills, counter UPI payments and receipts instead; see
**Billing (device) → UPI & Bank** and [UPI_BANK_CONNECT_PLAN.md](UPI_BANK_CONNECT_PLAN.md).
