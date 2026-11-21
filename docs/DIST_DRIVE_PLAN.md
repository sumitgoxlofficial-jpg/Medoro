# MEDORO Distribution in Google Drive — plan and status

**Goal:** every account on Medoro's hosted server keeps its business records in its own Google Drive, distributors
included, exactly as pharmacies do (docs/DRIVEDB_PLAN.md). Medoro's database then holds only sign-in, subscription and
the short-lived relays between a tenant's own devices. When this is done, `DIST_HOSTED` (which today lets distributor
records stay on the hosted server) is turned off.

## What is reused as it is
- **The device database, Drive storage, encryption, keys and sync** (`src/drivedb`: engine, client, sync, relay, keyring,
  device worker). A distributor's records are more tables in the same kind of file; nothing new on that side.
- **The distribution rules** (`src/domain/distribution/rules`): wholesale pricing and GST, schemes, FEFO allocation with
  reservations, credit control, expiry eligibility, licences, the order state machine, ageing, analytics. They are pure
  functions, so the device runs the very same code as the server.
- **Device modules a distributor needs too:** catalogue and batches, purchases from suppliers, supplier claims, cheques,
  receipts and payments, expenses, bank matching, GST helpers, the AI gateway, WhatsApp sending.

## Phases
| Phase | What | Status |
|---|---|---|
| D1 | Device tables for distribution (migration 15); companies, product terms (PTR / PTS), chemist profiles, schemes, special rates; **direct wholesale invoices** (rate, scheme, FEFO, credit control with override, CGST/SGST or IGST, round-off) and same-day cancellation. Chemist balances include wholesale invoices. | **Built** (`src/drivedb/dist.ts`) |
| D2 | Orders: placing (salesmen for their own chemists), credit hold and release, approval with FEFO stock reservation (pick lines; short lines refused or cut with free goods in proportion), picking (short picks), packing, invoicing exactly what was picked; cancelling or rejecting; counter bills and credit exposure respect reservations. Godown transfers use the existing device transfer (`ops.transferStock`). | **Built** (`src/drivedb/dist-orders.ts`) |
| D3 | Credit notes (saleable back to stock; expired / damaged wait to be claimed; credit % and proportional GST), principals and expiry / breakage claims on companies (returned goods first, then shelf; claim window and expected credit; expiry workbench), van trips and proof of delivery (cash, UPI or cheque collected at the door; failed drops back to the desk; orders follow: dispatched, delivered), collections (salesmen for their own chemists), receivables with ageing and credit risk, chemist statements, wholesale invoices and credit notes in the device's GSTR-1 / GSTR-3B / HSN (cancelled invoices listed as cancelled). | **Built** (`src/drivedb/dist-trade.ts`) |
| D4 | Screens: the distribution app on the device (like Billing (device) for pharmacies), and staff devices (warehouse, salesman, delivery) through the existing relay. | |
| D5 | Chemist ordering portal in Drive mode: what chemists may see is published by the distributor's device, and their orders reach the distributor's devices through a sealed inbox (as customer payments do for pharmacies). | Decided: option 1 (below) |
| D6 | Moving existing distributors from Medoro's database to their Drive (the pharmacy move, extended), Drive sign-up for distributors, then `DIST_HOSTED` off. | |

## Decided for D5: the chemist portal (option 1, chosen by the owner on 21 Nov 2026)
Chemists across many distributors use one portal on medoro.in. To show a chemist a distributor's products, rates and
stock, that list has to be readable by Medoro's server (the chemist isn't one of the distributor's devices). Options:
1. **Publish a portal catalogue** (recommended): the distributor's device sends Medoro only what chemists are meant to
   see — product names, rates for the tier, stock as a band (In stock / Low / Out), active schemes — and refreshes it
   after changes. No bills, ledgers, chemists' balances or purchase prices. Orders come back sealed to the
   distributor's devices and are deleted once collected.
2. **No hosted portal in Drive mode**: chemists order through the salesman or WhatsApp only.

## How orders are kept on the device
The server edits an order's status in place; devices can't, because several devices work offline and sync later.
On the device everything is added, never edited (migration 16): the order and its lines as placed; each step
(approved, picking, packed, invoiced, rejected, cancelled) as an event whose id is the order id + the step, so a step
taken on two devices offline is kept once; the reserved stock as pick lines with ids fixed per order; what was picked
as one event per pick line. The status is worked out from the events: an invoice that stands beats a cancellation made
elsewhere offline (the goods left with a bill), and a cancelled invoice cancels the order. Stock reserved for orders
is the sum of open pick lines, as on the server. Approve an order on one device: if two approve it offline, the first
copy to sync is kept.

## Tests
- `src/drivedb/dist.test.ts`: pricing, FEFO in whole packs, IGST, price tiers, special rates, schemes, credit holds and
  overrides, hard stops, block mode, short stock, minimum shelf life, cancellation, append-only invoices.
- `src/drivedb/dist-orders.test.ts`: the whole order flow, reservations blocking counter bills, credit holds and
  override, partial approval with schemes, short picks, reject / cancel rules, idempotent retries, salesman limits.
- `src/drivedb/dist-trade.test.ts`: credit notes and the returned-goods pool, claims within the principal's window,
  trips with delivery, failure and re-dispatch, cheque collected at the door, salesman collections, ageing,
  statements, and GSTR-1 with wholesale B2B invoices, credit notes, cancelled documents and HSN.
- `tests/integration/dist-drive.test.ts`: the same bills on Medoro's server and on a device loaded from the server's
  records give identical invoices (every total and every line: batch, packs, free goods, rate, discount, taxable, tax), and an
  order taken through approval, a short pick, packing and invoicing reserves the same batches and invoices the same.
  A credit note (part return, expired, 80% credit) credits the same taxable value and GST on both.
