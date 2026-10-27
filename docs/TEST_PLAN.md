# Test Plan

Synthetic data only (`seed/synthetic.json`). Tools: Vitest (unit), Vitest with a test PostgreSQL in Testcontainers (integration), Playwright (end-to-end, keyboard, responsive), k6 (load), OWASP ZAP (DAST), axe-core (accessibility).

## Levels
- **Unit:** money and GST maths, FEFO allocator, reorder policy, expiry projection, anomaly rules, idempotency helpers, Zod contracts.
- **Integration:** services against real PostgreSQL inside transactions. Concurrency tests use parallel connections.
- **E2E:** Playwright against the dockerised stack, with mocked Meta, Google and OCR servers.
- **Security:** authz matrix tests (every route × every role), tenant-isolation fuzzing, ZAP baseline, dependency audit.

## Mandatory scenarios (brief §22)
| # | Scenario | Level | Key assertions |
|---|---|---|---|
| 1 | Create medicine, receive batch | Int + E2E | Batch row, +qty movement, audit |
| 2 | Sale updates correct stock | Int | FEFO batch decremented, movement −qty |
| 3 | Block expired stock | Unit + Int | Expired/quarantined batch rejected even if the client sends it |
| 4 | Concurrent oversell | Int | 2 parallel sales of the last unit → exactly one succeeds |
| 5 | Money & tax | Unit | Property tests: Σ lines = total; CGST+SGST = tax; round-off ≤ ₹0.50 |
| 6 | No duplicate sale/invoice | Int | Same idempotency key twice → one sale; invoice sequence has no gaps or duplicates |
| 7 | Returns reconcile stock | Int | Sealed → restock same batch; damaged → no restock; credit note posted |
| 8 | Tenant & branch isolation | Int | Every repository read with a foreign tenant → 0 rows / 403 |
| 9 | Permissions | Int | Generated matrix of role × action |
| 10 | Receipts | Unit + E2E | PDF contains GSTIN, invoice no., tax split; thermal layout snapshot |
| 11 | WhatsApp send + webhooks | Int (mock) | queued→sent→delivered→read; signature check |
| 12 | WA failure/retry, no dupes | Int | Retryable error retries ≤3; wamid present → no resend |
| 13 | Drive connect/disconnect | Int (mock) | Token stored encrypted; revoke on disconnect |
| 14 | Encrypt, restore, verify backup | Int | Round-trip restore to staging; hash match; wrong key fails |
| 15 | Offline queue reconciliation | Int | Over-quota offline sale → conflict; resolve paths |
| 16 | AI read-only queries | Int | Correct tool chosen; output matches service |
| 17 | AI confirmation required | Int | Write tool without a confirm token → rejected |
| 18 | Unauthorised AI tool | Int | Cashier invoking create_draft_purchase_order → denied + audited |
| 19 | Strict mode no egress | E2E | Network sandbox: zero requests to Medoro domains with pharmacy payloads |
| 20 | OCR review & approval | E2E (mock OCR) | No stock until approval; totals mismatch blocks approval |
| 21 | Expiry & reorder recs | Unit | Synthetic velocity → expected projected loss and suggestion |
| 22 | Subscription lifecycle | Int | trial→active→grace→read-only; offline licence 30-day window |
| 23 | Keyboard & responsive | E2E | F2/F4/F9 flow; 1440, 1024 and 390 px screenshots; axe has no serious issues |

## Release gates
- No open critical or high security, financial-integrity or data-loss defects.
- Coverage ≥ 90% on `domain/sales`, `domain/inventory`, `domain/accounting`, `lib/money`.
- p95 sale commit < 300 ms at 20 concurrent counters (k6).
- A backup restore drill passes on the release candidate.
