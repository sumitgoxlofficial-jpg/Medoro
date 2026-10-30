# Orders, home delivery, owner view and scheduled reports

Medoro takes customer orders by phone, WhatsApp or at the counter, bills them through the normal POS
commit, sends them out with a delivery person and tracks the cash until it is back in a drawer.
Owners get a phone-sized summary of the day and can have the numbers emailed to them.

## Orders (`/app/orders`, permission "Create sales")

| Status | What happens | Who |
|---|---|---|
| New | Order saved: customer (found by mobile or created), items with quantity, delivery address, date and slot, notes, payment (cash on delivery, prepaid UPI with reference, or customer credit), optional discount, prescriber and prescription photo/PDF. Stock in hand is shown per item. Schedule H/H1/X items need the prescriber's name | Counter staff |
| Confirmed | Customer is told (see notifications). Items short on stock are listed | Counter staff |
| Packed & billed | The order becomes an invoice through `commitSale`: batches are allocated FEFO (stock held for offline counters is skipped), the Rx rule, discount cap and credit limit are enforced, stock is row-locked and decremented, and the sales voucher is posted. The sale uses the idempotency key `ord_<order id>`, so packing twice can never bill twice | Counter staff |
| Out for delivery | A delivery person is assigned and a 4-digit delivery code is sent to the customer. The rider can be changed while it is out | Counter staff |
| Delivered | The rider enters the code from the customer (5 tries) or, without a code, the receiver's name, and the amount collected for cash on delivery (cash or UPI to the shop). The amount must equal the invoice total | Rider (or a manager for them) |
| Cancelled | Before packing: no money involved. After packing: needs "Refunds & voids"; the invoice is reversed | Staff / manager |
| Returned | The parcel came back undelivered: needs "Refunds & voids"; the invoice is reversed and the stock restocked | Manager |

Reversals use the existing paths: a same-day **void** (the sales voucher is reversed line by line) or, for an
older invoice, a **credit note** (sealed goods restocked). Riders can also report "Couldn't deliver" with a reason;
the order stays out for delivery and the store sees the reason immediately.

Every change writes an append-only `DeliveryEvent` (shown as the order history) and a hash-chained audit event.
Tables have live-change triggers, so the Orders, Deliveries and Owner screens refresh on every device.

### Delivery staff (`/app/deliveries`, permission "Deliver orders")

A new **Delivery** role (permission `delivery`) is created for every pharmacy; owners also hold the permission.
Delivery staff sign in like counter staff and land on *My deliveries*: each stop has the address, notes, items,
amount to collect, **Call** (`tel:`) and **Navigate** (Google Maps) buttons, **Delivered** and **Couldn't deliver**.
A banner shows the cash they are carrying.

### Customer notifications

At *confirmed*, *out for delivery* (with the delivery code and the rider's name) and *delivered*:

1. **WhatsApp**, when WhatsApp Business is connected, the template is approved by Meta, and the customer
   agreed (opt-in on the customer, or "Customer agreed to order updates on WhatsApp" on the order) and has not
   opted out. Default template names: `order_confirmed` (variables: first name, order no., amount),
   `order_out_for_delivery` (first name, order no., code, rider, amount), `order_delivered` (first name, order no.).
   They can be renamed under Orders → Templates (permission "Integrations & backups"). Messages appear in the WhatsApp log.
2. Otherwise **SMS**, when an SMS gateway is configured (below).
3. Otherwise nothing is sent; the rider records the receiver's name instead of a code.

The outcome is recorded in the order history. A notification failure never blocks the order.

SMS uses `SMS_PROVIDER` (default: `OTP_PROVIDER`): `console`, `twilio`, `http` (`SMS_HTTP_URL`/`SMS_HTTP_TOKEN`,
default the OTP webhook; receives `{phone, purpose: "message", text}`) or `msg91`, which needs a separate
DLT-approved Flow template with a `##text##` variable in `SMS_TEMPLATE_ID`.

## Accounting for cash on delivery

Decision: **bill at packing, clear on handover.**

| Event | Voucher |
|---|---|
| Packed (COD) | Sales voucher: Dr **Cash with delivery staff** / Cr Sales, Output CGST, Output SGST, Round off. Payment mode `cod` |
| Packed (prepaid) | Sales voucher with Dr Bank account (mode UPI, reference kept) |
| Packed (credit) | Sales voucher with Dr Sundry debtors for the customer (credit limit checked) |
| Delivered, paid by UPI at the door | Receipt: Dr Bank account / Cr Cash with delivery staff |
| Delivered, paid in cash | Nothing yet: the cash is with the rider |
| Rider hands over cash (`/app/orders?tab=cash`) | Receipt `RS-…`: Dr Cash in hand (counted) / Cr Cash with delivery staff (expected); any difference to Cash short/excess (a note is required) |
| Returned / cancelled after packing | Void (reverses the sales voucher, so the clearing account is credited back) or credit note "COD not collected": Dr Sales returns + output tax / Cr Cash with delivery staff |

Why: the invoice, GST and stock movement happen when goods leave the shelf (the tax point for retail
supply), the cashier's drawer is not inflated by money that is still on the road, and "Cash with delivery
staff" always equals what riders owe. Its balance appears in the trial balance and on the Owner view.
The handover is taken into the open shift of the counter that receives it: the shift's expected cash includes it
(`Delivery cash handed over` on the shift close card), so the drawer count still balances.

## Owner view (`/app/owner`, permission "Accounting & reports")

A single-column page sized for phones: net sales today against yesterday at the same time (all branches the user
can access, with a per-branch table and payment-mode chips), cash expected in every open drawer, cash still with
delivery staff, low-stock and 30-day expiry counts, things waiting for approval (new orders, stock transfers,
purchase order drafts, offline conflicts, discount approvals given today), backup health and the alert list,
plus quick actions. It is a server component that refreshes through the live feed. The PWA manifest has
**Owner view** and **Orders** shortcuts (long-press the installed app icon).

## Scheduled report emails (`/app/owner/reports`)

The owner (permission "Manage users & roles") chooses daily or weekly (day of week), a time (India time),
up to 10 recipients and the reports: daily sales summary (per day and branch, with payment modes including
cash on delivery), GST summary, low stock, expiring stock, customer and supplier dues. The cron tick sends
once per day from that time (claimed atomically, so several app servers never double-send); daily covers
yesterday, weekly the 7 days before. Each recipient gets their own email with CSV attachments and a signed
unsubscribe link (`/api/report-mail/unsubscribe`, which asks for a click before removing the address). Every
run and unsubscribe is audited; the last result is shown on the page. "Send now" sends with the saved settings.

`sendMail` (`src/server/mail.ts`) accepts optional `attachments` (`{ filename, content, contentType }`), sent
base64-encoded to Resend, SendGrid and the HTTP relay (`attachments: [{filename, contentType, content}]`).
Existing callers are unchanged. The unsubscribe link needs `APP_URL`.
