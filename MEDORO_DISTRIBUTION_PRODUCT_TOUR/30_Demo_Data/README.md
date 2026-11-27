# Demo data: Medoro Demo Pharma Distributors (fictional)

Everything here is invented. GSTINs use the letters "DEMO" in the PAN part (valid checksum so the app accepts them, but not real registrations), drug licences contain "DEMO", phone numbers are 90000 0xxxx, emails end in `.local`, and addresses are marked "(Demo Address)". Company and supplier names carry "Demo"; brand names are invented (generic names are real).

## The account

| Field | Value |
|---|---|
| Business | Medoro Demo Pharma Distributors · code `MEDORO-RNC` · legal name "Medoro Demo Pharma Distributors (Demo)" |
| Owner | Demo Distributor Owner · owner@medoro-demo-distributor.local · 90000 00011 (two-step verification on) |
| GSTIN / licence | 20DEMOF0001D1ZO (Jharkhand) · JH-RNC-DEMO-20B-0001 / 21B-0002 |
| Godowns | Medoro Main Godown (code RNC, created at sign-up), Kanke Road Godown (KNK); Dhanbad Depot (DHN) is added on camera in Part 06 |
| Plan | 7-day free trial, Professional (local licence server on the demo machine) |
| Staff (joined through invite codes) | Ravi Kumar (Salesman, E-102), Rahul Picker (Warehouse, E-103), Manoj Driver (Delivery, E-104), Pooja Billing (Billing, E-105); an accountant invite is created on camera in Part 23 |

## Masters and history (state before recording)

| Item | Count |
|---|---|
| Companies / principals (with expiry-claim terms) | 6 / 6 |
| Suppliers (C&F, super stockists; 2 out of state for IGST) | 4 |
| Products (PTR, PTS, MRP, HSN, GST 5/12/18 %, schedule H/H1, barcode, reorder level, rack) | 30 |
| Batches (incl. short-dated and one expired batch) | 103 |
| Racks (incl. cold chain and quarantine) | 22 |
| Territories / salesmen | 4 / 3 |
| Chemists (credit limits ₹25,000–₹2,50,000, licences, 2 out-of-state, 1 on hold, 1 at ₹45,000 of a ₹50,000 limit) | 24 |
| Schemes (10+2, company 10+1, 5 % discount, chemist-only 20+3) / special rates | 4 / 3 |
| GRNs / purchase orders | 28 / 3 |
| Orders (every stage, incl. credit hold and rejected) / invoices | 241 / 414 |
| Credit notes / supplier claims | 6 / 2 |
| Dispatch trips / deliveries (incl. failed and re-dispatched) | 52 / 414 |
| Collections (cash, UPI, NEFT, cheque) | 297 |
| Vouchers / audit events | 777 / 2,608 |

History covers 28 Sep – 26 Nov 2026 (Sundays closed), with today's orders at every pipeline stage. Sales ≈ ₹29 lakh, receivable ≈ ₹6.5 lakh with ageing up to 60 days, gross margin ≈ 17 %.

## How it was made

- The account itself was created on camera through the real sign-up (Parts 02–03).
- Staff joined through the real invite flow in a browser.
- History was entered by `dist-demo.seed.ts.txt`, which calls Medoro's own domain services (the same functions the screens call: `saveProduct`, `postGrnTx`, `placeOrder`, `approveOrder`, `startPicking`, `packOrder`, `invoiceOrder`, `directInvoice`, `createDispatch`, `recordDelivery`, `collectPayment`, `createReturn`, `raiseDistClaim`, …) with the process clock moved to past dates (libfaketime). Validation, credit control, FEFO, GST and double-entry posting all ran exactly as in the app.
- Prisma stamps some timestamps itself (not affected by the fake clock), so those were moved to the simulated time afterwards by `remap-timestamps.sql`, using rows that record both clocks (vouchers, approvals, pick lists, deliveries) as anchors.
