# Workflows

## Order to cash
1. **Chemist registers** on `/portal/register` (licence numbers, validity, GSTIN optional, consent). Rate-limited.
2. **Connects** to a distributor (search by name/area/code) and agrees to share licence/GST details with it.
3. **Distributor approves** on `/dist/portal-admin`: licence validity is re-checked; the request is linked to an existing chemist or a new chemist ledger is created with a credit limit and days.
4. **Views catalogue**: only portal-visible products, the chemist's own rate (special rate → price tier), schemes if shown, stock as the distributor allows.
5. **Places order** (cart, bulk paste, repeat order). The server re-prices, applies the best scheme, refuses expired licences and blocked accounts outright, and snapshots the credit check.
6. **Distributor approves** (`/dist/orders/[id]`): credit check re-run. A hold (over limit, overdue beyond grace, account on hold, two bounced cheques in 90 days) needs the *credit override* permission and a reason (audited). Stock is reserved batch-wise FEFO; short lines can be cut.
7. **Warehouse picks** on a phone (`/dist/warehouse/[id]`), rack by rack; short picks are recorded.
8. **Packed** with box count.
9. **Invoice generated** from exactly what was picked; stock leaves; books post; delivery opens.
10. **Delivery assigned** in a dispatch trip (vehicle, driver, delivery user, route); **van leaves**.
11. **Delivered** with receiver name (proof of delivery) and optional cash/UPI/cheque collection — a receipt voucher posts immediately. A failed delivery returns to the dispatch desk.
12. **Payment reconciled**: bill-wise FIFO outstanding, cheques through deposit → clear / bounce, bank statement matching.

## Procure to stock
Purchase planning (intelligence → reorder suggestions → **draft** POs) → PO placed → supplier invoice → GRN (batch,
expiry, free goods, trade/cash discount, printed-total check ±₹1, short-dated stock needs explicit acceptance) → batch
created or topped up (weighted landed cost) → stock movement → purchase voucher (ITC) → supplier bill with due date.

## Expiry to credit
Expiry identification (workbench by band, shelf + returned stock) → return eligibility from the principal's window
(N days before expiry to M days after) → supplier claim (debit note at landed cost, input GST reversed) → supplier
acknowledgement → credit note (partial allowed) → close with write-off of the shortfall → reconciliation by supplier.
