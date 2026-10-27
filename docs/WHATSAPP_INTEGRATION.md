# WhatsApp Business Integration

Uses the **official Meta WhatsApp Business Platform (Cloud API)** only. Unofficial automation is not permitted.

## Setup (per pharmacy)
1. Meta Business account (verified) plus a WhatsApp Business Account (WABA).
2. Embedded Signup from Settings → Integrations → WhatsApp → returns WABA ID, phone number ID and a system-user token.
3. The token is stored encrypted in the server vault on the customer's app host. It is never sent to browsers.
4. Webhook: `POST /api/wa/webhook`. Verification uses `hub.verify_token`. Payload signatures are checked with `X-Hub-Signature-256` using the app secret.
5. Templates: `invoice_document` (utility, document header), `payment_reminder`, `refill_reminder`, `store_update`. Each needs Meta approval.

## Invoice send flow
1. The sale commits (DB transaction complete).
2. The PDF is generated from the committed invoice (pdf-lib) and stored locally. In strict mode it isn't stored by Medoro.
3. The cashier sees the number and summary, reads the number back, and ticks consent.
4. `wa_messages` row inserted: status `queued`, idempotency key = `invoice_id + recipient`.
5. Worker: upload media → send a template message with a document header → store `wamid`.
6. Webhooks update status: `sent → delivered → read`, or `failed` with the error code.
7. Retries: at most 3 attempts with exponential backoff, and only for retryable errors. If a `wamid` already exists, the send isn't repeated.

## Failure handling
| Case | Behaviour |
|---|---|
| Invalid number / not on WhatsApp | `failed`, no retry, cashier prompted to fix the number |
| Token revoked / expired | Integration marked disconnected, owner alerted, queue paused |
| Rate limit | Backoff, retry |
| Webhook replay | Dedupe on `(wamid, status, timestamp)` |

## Auto-send
Optional, off by default. It sends only when the customer has recorded opt-in consent and an approved template exists.

## Privacy
The message body excludes prescriber and diagnosis details. Opt-outs ("STOP") are honoured automatically and recorded.

## Status: unverified
The prototype simulates statuses. No real Meta credentials have been tested.
