# API

Two families:

* **Staff API** at `/staff/api/growth/*`: needs a staff session cookie. The cookie `medoro_staff` is scoped to `/staff`,
  so the API lives under that path rather than `/api/growth` (widening the cookie to `/` would send the staff session
  with every pharmacy request). The paths below map 1:1 to the requested `/api/growth/*` list.
* **Public endpoints** at `/api/growth/*`: webhooks and unsubscribe, authenticated by signatures/tokens, no cookie.

Every staff request: session + Growth role + permission checked on the server; non-GET requests must come from this site
(Origin / Sec-Fetch-Site, else 403); 600 requests per 10 minutes per person; Zod validation. Responses are
`{ "success": true, ...data }` or `{ "success": false, "error": "…" }` with 400 (invalid input), 401 (no session),
403 (role/CSRF), 404, 409 (already done), 422 (rule refused), 429, 500.

| Method & path (under `/staff/api/growth`) | Permission | Body / query |
|---|---|---|
| `GET /leads` | leads.view | q, state, district, city, pin, website, verification, stage, staffId (`none` = unassigned), sourceId, minScore, sort, page, pageSize |
| `POST /leads` | leads.create | name, phone, email, website, address, city, district, state, pin, category, ownerName, sourceUrl |
| `GET /leads/{id}` | leads.view | full detail: facts, evidence, score breakdown, calls, follow-ups, consents, timeline |
| `PATCH /leads/{id}` | leads.edit | same fields + `updatedAt` (optimistic concurrency) |
| `POST /leads/import` | leads.import | multipart: `file`, `mapping` (JSON), `source` (JSON incl. `confirmLawful: true`), `preview=1` |
| `GET /leads/export` | leads.export | filters + `purpose` (required, audited); returns CSV |
| `POST /leads/verify` | leads.verify | `{leadId, action: verify\|website_check\|invalid\|clear_invalid, kind, method, detail, url, reason}` |
| `POST /leads/score` | leads.verify | `{leadIds: [...]}` |
| `GET /admin/assignments` | assign | overview + history (`leadId`, `staffId`) |
| `POST /admin/assignments` | assign | `mode`: `assign` {leadIds\|filter, staffId, dueAt, reassign} · `distribute` {leadIds\|filter, staffIds, split: equal\|balance} · `territory` · `withdraw` {leadIds, reason} · `reassign_from` {fromStaffId, toStaffIds} |
| `PATCH /admin/assignments/{id}` | assign | `{action: deadline\|withdraw\|reassign, dueAt, staffId, reason}` |
| `GET /my-leads`, `GET /my-leads/{id}` | calls.make | own assigned leads only |
| `GET /employee/dashboard` | calls.make | MY WORK numbers |
| `GET /admin/employee-performance` | performance.view | from, to (YYYY-MM-DD), staffId |
| `POST /calls/launch` | calls.make | `{leadId}` |
| `POST /calls/{id}/report` | calls.make | see below; `Idempotency-Key` header or `idempotencyKey` |
| `GET /calls/history` | calls.make | staffId, from, to, outcome (`unreported`), leadId, page |
| `GET /follow-ups` · `POST /follow-ups` | calls.make | view: today\|upcoming\|overdue\|done\|all · {leadId, dueAt, note} |
| `PATCH /follow-ups/{id}` | calls.make | {action: complete\|reschedule\|cancel, dueAt, note} |
| `POST /admin/employee-targets` | targets.set | {staffId, period: daily\|weekly, calls, connected, conversions, effectiveFrom} |
| `GET /campaigns` · `POST /campaigns` | campaigns.manage | {name, channel, templateId, audience (lead filters), dailyCap} → pending approval |
| `POST /messages` | messages.send | {leadId, channel, templateId \| text} |
| `GET /conversations` | inbox.view | channel, unread=1, or id= for one thread |
| `GET /consent` · `POST /consent` | consent.record | leadId · {leadId, channel, purpose, scope, lawfulBasis, evidence, source} or {revokeId, note} |
| `POST /suppression` | consent.record | {value, channel, reason, leadId} or {liftId, note} (compliance admins) |
| `GET /dashboard`, `GET /analytics` | analytics.view | from, to, staffId, state |

### Calling

```http
POST /staff/api/growth/calls/launch      {"leadId":"…"}
→ {"success":true,"callSessionId":"SESSION_UUID","phone":"+919876543210","dialerUri":"tel:+919876543210","reused":false}

POST /staff/api/growth/calls/SESSION_UUID/report
{"outcome":"INTERESTED","interestLevel":"high","notes":"Interested in Medoro pharmacy billing software.",
 "followUpAt":"2026-11-07T10:00:00+05:30","numberConfirmed":true,"softwareStatus":"paper","consentChannels":["whatsapp"]}
```
Outcomes: NOT_CALLED, NO_ANSWER, BUSY, CONNECTED, INTERESTED, NOT_INTERESTED, WRONG_NUMBER, FOLLOW_UP_REQUIRED,
DEMO_SCHEDULED (needs `demo: {at, mode}`), CONVERTED (needs `conversion: {product, cycle, amountRupees, reference}`),
DO_NOT_CONTACT. Interest: none, low, medium, high. A second report for the same session returns 409; a retry with the
same idempotency key returns `{duplicate: true}`.

## Public endpoints

| Path | Purpose | Authentication |
|---|---|---|
| `GET/POST /api/growth/wa/webhook` | Meta webhook for Medoro's platform number: delivery status, replies, STOP, template status | verify token (GET), `X-Hub-Signature-256` HMAC with the app secret (POST) |
| `POST /api/growth/email/events` | `{type: bounce\|complaint\|reply\|delivered, email, providerId?, text?}` | `x-medoro-signature` = HMAC-SHA256(raw body, `GROWTH_EMAIL_WEBHOOK_SECRET`) |
| `GET/POST /api/growth/unsubscribe?l=&c=&t=` | Confirmation page and opt-out | HMAC token per lead and channel |
