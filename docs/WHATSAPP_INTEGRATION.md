# WhatsApp Business Integration

Uses the **official Meta WhatsApp Business Platform (Cloud API)** only. Unofficial automation is not permitted. Customers without WhatsApp consent can be reached by SMS instead (see [SMS](#sms)).

## Setup (per pharmacy)

### Embedded Signup (recommended)
Owners click **Connect with Facebook** on the WhatsApp screen. Meta's Embedded Signup (v4, JavaScript SDK, `FB.login` with the configuration ID, `response_type: "code"`) lets them log in, pick or create a business portfolio, WhatsApp Business Account (WABA) and phone number. Medoro then, server to server:
1. Exchanges the 30-second code for the customer's **business token** (`GET /oauth/access_token` with `WA_APP_ID`, `WA_APP_SECRET`, `code`).
2. Takes the WABA and phone number IDs from the signup session event and checks the WABA against the token's granted assets (`GET /debug_token`, `granular_scopes`). Without a session event it uses the granted WABA and its first phone number (`GET /<WABA>/phone_numbers`).
3. Seals the token (plus the app secret and a generated two-step PIN) in the server vault with `HOST_KEY`. It never reaches browsers.
4. Subscribes the app to the WABA's webhooks (`POST /<WABA>/subscribed_apps`). When `APP_URL` is https it sets a **WABA callback override** to `APP_URL/api/wa/webhook` with this pharmacy's verify token, so each self-hosted server gets its own webhooks; Meta verifies the URL first. If the override is refused, the plain subscription is kept and the screen says to add the webhook in the Meta app.
5. Registers the number for Cloud API (`POST /<PHONE_ID>/register` with the PIN) unless it already is (`platform_type` `CLOUD_API`). A failed registration is shown on the screen.
6. Syncs message templates.

**Owner/operator setup in Meta (one time, for the Medoro app):** be a Tech Provider; in the App Dashboard → Facebook Login for Business → Settings turn on Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Strict Mode and Login with the JavaScript SDK, and add each pharmacy's https domain to **Allowed domains** and **Valid OAuth redirect URIs**; create a configuration from the **WhatsApp Embedded Signup** template; subscribe the app to the `messages` (and `message_template_status_update`) webhook fields. Put the app ID, app secret and configuration ID in `WA_APP_ID`, `WA_APP_SECRET`, `WA_CONFIG_ID`. Customers add a payment method in WhatsApp Manager.

### Manual credentials (fallback)
"Enter credentials manually" takes a WABA ID, phone number ID, a permanent system-user token and the app secret, checks them with Meta and seals them. The webhook URL and verify token to enter in the Meta app are shown on the screen.

### Webhook
`POST /api/wa/webhook`. Verification (`GET`) matches `hub.verify_token` against the pharmacy's random verify token. Payloads are checked with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret). Handled: message statuses, failures with their error code, template status changes, and STOP replies.

### Templates
| Purpose | Default name | Body variables |
|---|---|---|
| Invoice with PDF | `invoice_share` (utility, **document header**) | name, invoice no., amount |
| Invoice as link | `invoice_link` (utility, no media header) | name, invoice no., amount, link |
| Credit note | `credit_note` | name, credit note no., amount, invoice no. |
| Refill reminder | `refill_reminder` | first name, medicine, due date |
| Feedback request | `feedback_request` | first name, invoice no. |
| Payment reminder | `payment_reminder` | first name, amount due, pharmacy |
| Store update / campaign | `store_update` (or any approved) | first name, update text |
| Points earned | `loyalty_points` | first name, points earned, balance |

A template with fewer body variables gets the first ones. Each needs Meta approval; names are chosen on the WhatsApp and Customer messaging screens.

**Approved-template check:** before any send Medoro looks the template up in its cached list (refreshed from Meta every 6 hours, and once more when a name is missing) and needs status `APPROVED`, preferring the account's language; the invoice PDF also needs a `DOCUMENT` header. Otherwise nothing is queued and the screen says what's missing; with auto-send on, the WhatsApp screen shows that auto-send is paused. Template status webhooks update the list immediately.

## Invoice send flow
1. The sale commits (DB transaction complete).
2. The cashier sees the number and summary, reads the number back, and ticks consent (auto-send skips this for customers with recorded opt-in).
3. `wa_messages` row inserted: status `queued`, idempotency key `wa:<invoice id>`, with what to send (template, variables) so it can be retried.
4. **Attach PDF on** (default): the PDF is generated from the committed invoice (pdf-lib), uploaded to Meta (`POST /<PHONE_ID>/media`) and sent by media id as the template's document header. It isn't stored by Medoro or exposed on a URL.
   **Attach PDF off:** the text-only template is sent; its 4th variable is a link `APP_URL/api/wa/invoice/<sale>.<expiry>.<hmac>` signed with `SESSION_SECRET` that serves the PDF for 7 days. Voided invoices aren't served.
5. Webhooks update status `sent → delivered → read` (never backwards), or `failed` with the error code.

Credit notes are sent the same way from Returns after the credit note is issued.

## Delivery worker, retries and failures
Every send goes through one path that classifies Meta's error code:

| Case (codes) | Behaviour |
|---|---|
| Throughput / pair rate limit (130429, 131056), Meta errors (1, 2, 131000, 131016, 131057, 133004), HTTP 5xx/429, network | `failed`, retried automatically after 1, 4, 16 min, at most 3 attempts in all |
| Not on WhatsApp (131026) | `failed`, never retried; the customer's number is flagged and every automatic send (auto-send, reminders, campaigns) skips it until the number is changed or WhatsApp consent is recorded again; the cashier is told to check the number |
| Template problems (132xxx), 24-hour window (131047), marketing opt-out (131050), billing (131042) and other errors | `failed`, never retried |
| Token expired/revoked (190, 0, 102) | integration marked **disconnected**, queue paused (pending retries wait, uncounted), dashboard banner + bell alert + red WhatsApp badge, **Reconnect** button; reconnecting resumes the paused messages |
| Webhook replay | statuses never move backwards; a failure already recorded isn't applied twice |

The worker runs in the scheduler (`/api/cron/tick`): every minute on self-hosted installs (in-process), once a day with Vercel Cron. A message that Meta accepted (has a `wamid`) is resent only when a webhook later reports a temporary failure. The delivery log shows each message's kind, channel, reason and next automatic retry; the Retry button appears only for retryable failures. The WhatsApp badge counts failures from the past week that won't be retried, plus a disconnected integration.

## Auto-send
Optional, off by default. It sends only when the customer has recorded opt-in consent, the number isn't flagged and the approved template exists.

## Refill reminders, feedback and payment reminders
Turned on under Customer messaging, each with its own approved template. The scheduler sends refill reminders once a day per pharmacy from 10:00 IST to opted-in customers due within 2 days (or up to a week overdue): one message per customer per day and one per refill cycle (`refill:<customer>:<medicine>:<last purchase>`). Feedback requests go the chosen number of hours after a sale, once per sale (`fb:<sale>`) and at most once in 30 days per customer, never for voided bills, WhatsApp only.

**Payment reminders** go to customers with a credit balance who consented: manually ("Remind all now" on Customer messaging, "Remind" on a customer in Parties) and, when turned on, weekly on the chosen weekday from 10:00, skipping anyone reminded in the past 6 days. At most one per customer a day (`pay:<customer>:<date>`).

## Store updates and campaigns
A campaign is a template sent to everyone who consented, in resumable batches. Adding update text makes it a store update: the text (line breaks collapsed, up to 300 characters) is body variable 2 after the first name, and the SMS text for SMS-only customers.

## SMS
Customers who agreed to SMS (recorded on the customer, separately from WhatsApp) but have no WhatsApp opt-in, or whose number isn't on WhatsApp, get refill and payment reminders, store updates and points messages by SMS once SMS is turned on under Customer messaging. The gateway is `SMS_PROVIDER` (default: `OTP_PROVIDER`) with the existing credentials:
- **msg91**: Flow API; each message type needs the MSG91 template id linked to its **DLT** template, entered per type. Variables go as `var1`, `var2`… (use `##var1##` etc. in the template) in the same order as the WhatsApp variables.
- **twilio**: sends the text; register matching DLT templates for your Indian sender.
- **http**: posts `{phone, text, type, vars, dltTemplateId}` to `OTP_HTTP_URL`.

Texts end with "Reply STOP to opt out." SMS failures from the gateway (5xx, network) are retried like WhatsApp; rejections aren't.

**STOP by SMS:** `POST /api/sms/inbound` accepts Twilio inbound webhooks (form post, `X-Twilio-Signature` checked with `TWILIO_AUTH_TOKEN` against `APP_URL/api/sms/inbound`) and the http gateway (`{from, text}` with `Authorization: Bearer SMS_INBOUND_TOKEN`). STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT withdraw SMS consent for that number. MSG91 has no signed inbound webhook, so it isn't accepted: with MSG91, opt-outs come through DLT/NCPR preferences and are recorded by staff on the customer.

## Loyalty points
Settings (Customer messaging → Loyalty points): on/off, points per ₹100 paid, value of a point, minimum to redeem, expiry in months (0 = never), optional "points earned" message.
- **Earn** on sale commit: `floor(amount paid × rate / ₹100)`, where amount paid is the bill total less points redeemed.
- **Redeem** at Billing as part payment: the customer row is locked and the balance checked in the sale transaction; the value can't exceed the bill. It's recorded as a `loyalty` payment.
- **Accounting:** redemption is a tender, not a price change. The invoice, its taxable value and GST stay as billed (GST is paid on the full value, consistent with how the bill was issued); the redeemed value is debited to **Loyalty points redeemed**, shown with expenses in the P&L (like a discount allowed after tax). Earning posts nothing.
- **Returns and voids:** the returned share of the bill takes back the same share of earned points and gives back the same share of redeemed points; that value is refunded as points (credited back to Loyalty points redeemed), not money. A void reverses everything. Shift cash expects only the money part.
- **Expiry:** daily, oldest points first; unused points past expiry get one `expire` row.
- `LoyaltyLedger` is append-only (database trigger); a balance is the sum of its rows. The customer's balance and history open from Parties; receipts show points redeemed, earned and the balance.

## Privacy
The message body excludes prescriber and diagnosis details. Opt-outs ("STOP") on WhatsApp and SMS are honoured automatically and recorded. Consent for WhatsApp and SMS is recorded per customer with who recorded it and when.

## Status
The Graph API and SMS gateways are mocked in tests (signup, sends, failures, webhooks, retries). No real Meta or DLT credentials have been tested.
