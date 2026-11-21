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
| D4 | Screens: the distribution app on the device at `/dist/device` (like Billing (device) for pharmacies): wholesale bill with a live quote, orders (approve, pick list, pack, invoice), invoices and credit notes, dispatch and proof of delivery, receivables (collect, ageing, statement), chemists (profile, hold / block, portal requests approved on the owner's device), products and schemes (terms, companies, principals), expiry and claims, distribution settings; plus the shared stock, purchases, supplier, cheques, UPI & bank and GST screens. A device loaded for a distribution tenant knows it (`product` in the seed). A distributor whose records live in Drive gets the device menu (each item opens its device screen) and `/dist` opens the wholesale bill. Staff devices join through the existing relay with the same approval as a pharmacy counter; signed in, each role sees only its own screens, the same as the menu (unlocked by the counter PIN without signing in, the device shows every screen, as a pharmacy counter does). | **Built** (`src/components/device/dist/`, `src/drivedb/dist-views.ts`, `src/app/dist/device`) |
| D5 | Chemist ordering portal in Drive mode (option 1): the device publishes the catalogue (products, PTR / PTS, MRP if shown, stock as the distributor chose to show it, schemes open to every chemist, each portal chemist's tier); a chemist's order is sealed for the distributor's devices and deleted once a device takes it in (it then waits for approval like any order, same credit rules); the device reports each portal order's status (order no, invoice no and total); cancelling while unapproved; approving a portal chemist adds them on the device and Medoro keeps only the link. Account statements and invoice copies stay with the distributor. | **Built** (`src/drivedb/dist-portal.ts`, `src/domain/distribution/drive-portal.ts`, migration `20261221000000_dist_portal_drive`, device migration 18) |
| D6 | **Move:** a distributor's records come across in the device's form (companies, product terms, chemist profiles, special rates, schemes, principals, invoices and cancellations, credit notes, proof of delivery, collections, settings); chemists' opening balances count wholesale invoices and credit notes; each batch's returned-goods pool starts equal to Medoro's quarantined stock; new checks (row counts of every table, returned goods per batch). Open orders and deliveries out on a van must be finished first. **Sign-up:** with `DIST_DRIVE=1` on the hosted server, a new distributor's records live in its Drive. **Then:** turn `DIST_HOSTED` off once every distributor has moved. | **Built** |

## Switching it on (owner, in this order)
1. Ship D4 (the distribution screens on the device). **Done.**
2. Set `DIST_DRIVE=1` on the hosted server: new distributors sign up into Drive mode.
3. Existing distributors move (*Move all my data from Medoro*; open orders and deliveries out first finished).
4. When none is left on Medoro's copy, remove `DIST_HOSTED`: Medoro's database then holds no distributor records.

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
- `src/drivedb/dist-portal.test.ts`: the published catalogue (only portal products; stock net of orders; schemes open to all;
  MRP and stock view as chosen; nothing of the books), portal orders taken in (idempotent, refused ones reported,
  waiting for chemists not synced yet), cancellations, statuses through to the invoice, linking portal chemists.
- `tests/integration/dist-drive-portal.test.ts`: end to end with real keys: connect, approve on the device, browse the
  published catalogue, order (sealed: Medoro can't read it), the device takes it in and invoices it, the chemist sees
  the status and invoice number; Medoro's database holds no medicines, stock, chemists, orders or invoices for the
  distributor.
- `tests/integration/dist-drive-move.test.ts`: a distributor with invoices (one cancelled), expired and saleable credit
  notes, a claim from returned goods, a delivered invoice with cash collected and an office collection moves to a device:
  every check passes, the chemist's balance and the returned-goods pool equal Medoro's, and the device carries on (new
  bill at the special rate, credit note on a moved invoice, a delivered invoice can't be cancelled). Open orders block the move.
- `tests/integration/dist-drive.test.ts`: the same bills on Medoro's server and on a device loaded from the server's
  records give identical invoices (every total and every line: batch, packs, free goods, rate, discount, taxable, tax), and an
  order taken through approval, a short pick, packing and invoicing reserves the same batches and invoices the same.
  A credit note (part return, expired, 80% credit) credits the same taxable value and GST on both.
