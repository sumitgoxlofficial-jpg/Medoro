# Medoro: feature test report

Statuses: **PASS** tested and working · **FAIL** tested and not working · **PARTIAL** some of it works · **BLOCKED** needs an external credential or device · **NOT TESTED**.

Evidence sources (all run during this audit):
- **E2E** = Playwright against a production build (`next build` + `next start`), real Chromium, fresh migrated PostgreSQL. Spec names are in `e2e/`.
- **INT** = Vitest integration tests against real PostgreSQL 16 (`tests/integration/`). **UNIT** = Vitest unit tests (`src/**/*.test.ts`).
- **AUDIT** = tests written for this audit (kept in the repo): `tests/integration/tenant-writes.test.ts`, `tests/integration/audit-stress.test.ts`, `src/domain/ai/clinical-refusal.test.ts`, `src/data/internal-links.test.ts`, `e2e/33-signup-email.spec.ts`.

Column "Defect / fix / retest" refers to the bug log ids.

## A. Dashboard
| Test case | Expected | Actual | Status | Defect / fix / retest |
|---|---|---|---|---|
| Today's sales, bills, margin, purchases, expenses, receivables, payables (E2E setup, 08, 28-drive-dashboard) | KPIs render from the database | Render; figures change after sales | PASS | – |
| Dashboard numbers equal database records (AUDIT: direct server fetches after each sale) | `bills` in the rendered payload = sales count in DB | Matched in every one of 13 sampled refreshes, including 70 ms after commit | PASS | – |
| Real-time update on another open screen (E2E 12) | Updates within seconds without reload | Before: 7/10 (the router dropped some refreshes). After the fix: 30/30 | PASS after fix | BUG-08 fixed |
| 14-day sales chart, collections by mode, branch performance, low stock, expiring batches, backup status | Shown with data | Shown | PASS | – |
| Date filters Today / 7D / 30D | Switch range | Switch (E2E 15 owner navigation) | PASS | – |
| Link navigation inside Intelligence (E2E 31) | Opens on first click | Next.js 15.5.29: 8/12. After upgrading to Next.js 16.4.6: 30/30 | PASS after fix | BUG-10 fixed |

## B. Medicine management
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Add medicine, receive batch, quarantine and release (E2E 04) | Saved; batch and movement created | As expected | PASS | – |
| Edit with optimistic version check (INT catalog, security) | Stale edit refused | Refused | PASS | – |
| Brand, salt/composition, HSN, GST, MRP, purchase price, barcode, rack, reorder level (INT catalog, catalogue; E2E 04) | Stored and used in POS search | As expected | PASS | – |
| Duplicate prevention (INT imports, catalog) | Duplicate refused / skipped on re-import | As expected | PASS | – |
| Bulk Excel/CSV import with per-row reasons, all-or-nothing (E2E 03, INT imports) | Bad file saves nothing | As expected | PASS | – |
| Search and filtering incl. salt, squashed brand, typo (INT catalog) | Finds brands | As expected | PASS | – |
| GST rate change for many medicines (E2E 04) | Only ticked ones move | As expected | PASS | – |

## C. Billing & POS (critical)
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Search, barcode scan, add/remove lines, held carts (E2E 06) | Works | Works | PASS | – |
| Keyboard F2 (search), Enter, F9 (complete) (E2E 06, 15) | Works | Works | PASS | – |
| FEFO batch selection; expired/quarantined/over-quantity refused even if the client sends them (INT sales) | Refused server-side | Refused | PASS | – |
| Schedule H1 prescriber rule, discount cap, manager PIN override (E2E 06) | Enforced | Enforced | PASS | – |
| Cash, UPI, card, split, customer credit within limit; over-limit refused (E2E 06) | As described | As described | PASS | – |
| MRP-inclusive GST, CGST/SGST split, round-off (AUDIT: 5 mixed 12%/5% carts with discounts vs an independent formula) | Equal to the paisa | Equal in all 5 | PASS | – |
| IGST for B2B inter-state (INT gst, invoices) | IGST instead of CGST/SGST | As expected | PASS | – |
| Invoice PDF, thermal 80 mm, A4 (E2E 06, UNIT pdf) | Generated | Generated | PASS | – |
| Invoice numbering gapless and unique under contention (AUDIT: 25 concurrent sales, 2 counters) | No gaps, no duplicates | Gapless and unique | PASS | – |
| No oversell (AUDIT: 25 concurrent sales on 10 units) | Exactly 10 succeed, stock 0, losers get a clear stock message | Exactly 10, stock 0, clear message | PASS | – |
| No deadlock with opposite lock order (AUDIT: 16 three-line carts in opposite batch order) | All succeed | All 16 succeeded | PASS | – |
| Duplicate submit (E2E 06 double-click; INT idempotency) | One bill, one stock deduction | One | PASS | – |
| Sales returns, credit notes, refunds; concurrent returns of the same line (E2E 07; AUDIT) | One return succeeds, stock restored once | One of 4 succeeded | PASS | – |
| Void today's bill (E2E 07) | Stock back, payment refunded, VOID | As expected | PASS | – |
| Receipt dialog usable on a 1280×720 screen (E2E 23) | Close button reachable | Was hidden under the header (dialog trapped in an animated card) → fixed | PASS after fix | BUG-03 fixed, E2E 23 passes |

## D. Inventory & expiry
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Batch stock, FEFO, expiry page, stock count variance (E2E 04) | Works | Works | PASS | – |
| Expired blocking, quarantine, recall (INT sales, inventory, recall-intel; E2E 04, 31) | Blocked | Blocked | PASS | – |
| Adjustments, write-off, return to supplier, branch transfer request/approve/receive (E2E 04; INT stockops) | Works | Works | PASS | – |
| 30/60/90/180-day expiry windows, valuation, low stock (INT, E2E) | Shown | Shown | PASS | – |
| Stock conservation (AUDIT: every batch quantity = sum of its movements) | No drift | No drift | PASS | – |

## E. Purchases & GRN
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| PO → place → GRN against PO with printed-total check → supplier payment (E2E 05) | Stock and supplier balance updated | As expected | PASS | – |
| Free quantity, PTR/PTS, scheme/trade/cash discount, landed cost, IGST for out-of-state supplier (INT purchasing, purchase-money) | Correct | Correct | PASS | – |
| Supplier e-bill import with column mapper (INT purchasing; E2E 20-drive-stock-import) | Imported and matched | As expected | PASS | – |
| Supplier invoice scanning (remote OCR) | Needs `OCR_REMOTE_URL` | Manual review path tested; remote OCR not configured | BLOCKED | – |
| Purchase returns, supplier claims, cheques (INT stockflows, cheques-bank) | Works | Works | PASS | – |

## F. GST & accounting
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| P&L, day book, expense + reversal (E2E 08) | Works, reversal never edits | As expected | PASS | – |
| Every CSV report downloads with a header (E2E 08) | All download | All download | PASS | – |
| Trial balance debits = credits; ledger lines balanced (AUDIT) | Equal | Equal | PASS | – |
| GSTR-1 JSON, GSTR-3B, HSN summary, CGST/SGST/IGST (INT gst, gst-rates; E2E 22-device-books GSTR-1 download) | Correct sections and totals | As expected | PASS | – |
| Tally XML export (INT gst) | Generated | Generated | PASS | – |
| Financial-year invoice series (INT sales: `MAI2627-…`) | Per branch per FY | As expected | PASS | – |
| E-invoice / e-way bill against NIC/GSP | Needs `EINVOICE_*` credentials | Not exercised against a sandbox | BLOCKED | – |

## G. Customers
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Registration, credit limit, ledger statement, outstanding (INT parties; E2E 06) | Works | Works | PASS | – |
| Loyalty earn/redeem/reverse/expire (INT loyalty; E2E 23) | Works | Works | PASS | – |
| Consent per purpose and channel, erasure, export (INT privacy, compliance; E2E 10) | Works | Works | PASS | – |

## H. WhatsApp
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Send logic, retries with backoff, invalid number, revoked token, STOP opt-out, signed webhook (INT whatsapp, whatsapp-phone, messaging) | As designed | Pass against Meta-shaped responses in tests | PARTIAL | – |
| Real send to an authorised test number with delivery/read receipts | Needs a Meta app, WABA, phone number id and test number | Not run (no credentials in this environment) | BLOCKED | – |
| Unsigned webhook on production (`POST /api/wa/webhook` with `{}`) | Ignored | 200 "ok", nothing processed (no matching account); a matching account requires a valid HMAC | PASS | – |

## I. Google Drive backup
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Create, verify, restore to a test copy (E2E 11) | Works | Works | PASS | – |
| AES-256-GCM with recovery key, wrong key fails, restore swap after typing pharmacy code (INT backup, restore) | Works | Works | PASS | – |
| Drive upload, device restore with recovery code (E2E 18, 19, 25 with the built-in fake Drive) | Works | Works | PASS (fake Drive) | – |
| Real Google OAuth connect, token expiry, disconnect, scope check against Google | Needs a Google OAuth client | Not run | BLOCKED | – |

## J. Offline application (critical)
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Bill offline, post on reconnect (E2E 13: network cut in the browser) | Provisional bill, posted later with a real invoice number | As expected | PASS | – |
| Over-quota offline sale becomes a conflict; resolve paths; no double posting on resend (INT offline) | As designed | As designed | PASS | – |
| Device counter offline billing with PIN, day-end (E2E 20-device-counter) | Works | Works | PASS | – |
| Two counters stay in step; removed counter shut out (E2E 21) | Works | Works | PASS | – |
| Real Windows/Android devices, long offline periods | – | Not available here | NOT TESTED | – |

## K. AI assistant
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Answers from real data with the user's permissions; Hindi/Hinglish; rate limit; confirmation tokens single-use, bound to user, re-checked at confirm (INT ai, ai-gateway; E2E 14, 26) | As designed | As designed | PASS | – |
| Draft PO / expense / stock adjustment / refund only after confirmation (INT ai) | No write without a token | As designed | PASS | – |
| Refuses clinical/dosage questions (AUDIT: 20 realistic questions) | All refused | **Before:** 18 of 20 got through the rule gate. **After fix:** 20/20 refused, 0 of 33 business questions wrongly refused | PASS after fix | BUG-02 fixed |
| Local (Ollama) / remote model answers | Needs a model endpoint | Planner tested with a stub model in INT | BLOCKED (live model) | – |

## L. Staff / counter app and roles
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Cashier sign-in with pharmacy code, employee ID, PIN, counter (E2E 02) | Works | Works | PASS | – |
| Accountant: Accounts hidden from every menu (E2E 02) | Hidden | Hidden | PASS | – |
| Permission toggle enforced on the server; "View as" narrows only (E2E 09; INT admin) | Enforced | Enforced | PASS | – |
| Cashier discount cap; refunds/voids need rights (E2E 06, 07; INT sales, void) | Enforced | Enforced | PASS | – |
| Lockout after 5 wrong passwords, TOTP, recovery codes, trusted PC (E2E 02) | Works | Works | PASS | – |
| Forgot password by emailed code (E2E 02 with mail sink) | Works | Works | PASS | – |
| Session revocation (INT auth-recovery) | Revoked session refused | Refused | PASS | – |
| A revoked session's live stream is closed within 60 s (`src/app/api/events/route.ts`) | Stream sends `signedout` | Code reviewed only, no test | NOT TESTED | – |

## M. Subscription & payments
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| Plan prices ₹999 / ₹2,499 / ₹4,499 / AI ₹499 (code vs live site) | Same everywhere | Same | PASS | – |
| 7-day trial | 7 days | `TRIAL_DAYS = 7`; README said 14 → corrected | PASS | BUG-07 fixed (doc) |
| Trial ending banner → grace → read-only, exports still work (E2E 17) | As described | As described | PASS | – |
| Plan limits enforced on the server (INT plans) | Over-limit refused | Refused | PASS | – |
| Razorpay signature check, amount check, duplicate payment refund, payment.failed (INT razorpay, online-pay, customer-pay) | As designed | Pass with Razorpay-shaped payloads | PARTIAL | – |
| Webhook without signature on production | 401 | 401 "bad signature" | PASS | – |
| Real Razorpay test-mode payment, cancellation, upgrade/downgrade | Needs Razorpay test keys | Not run | BLOCKED | – |

## N. Sign-up and website flows
| Test case | Expected | Actual | Status | Defect |
|---|---|---|---|---|
| First-run setup wizard → MFA → dashboard (E2E setup) | Works | Works | PASS | – |
| Distributor sign-up, CI-style server (E2E dist) | Works | Works | PASS | – |
| Email-confirmed sign-up, public server (AUDIT E2E 33) | Code required; wrong code refused | As expected | PASS (new test) | – |
| Distributor sign-up on a setup-token server with email configured (AUDIT E2E 33) | Form opens | **Before:** dead end ("Sign-up is not open on this server"). **After:** form opens | PASS after fix | BUG-05 fixed |
| Partner join form accessible name (E2E 16 with email configured) | Field named "Email" | Was "Email Send code" → fixed | PASS after fix | BUG-04 fixed |
| Website `/start` lead form (E2E 17) | Lead created | Created | PASS | – |

## O. Other modules (covered by the existing suites, all passing)
Orders & home delivery (INT orders; E2E 23 COD), estimates (INT), doctors & referrals (INT), barcode labels (UNIT), cheques & bank reconciliation (INT; E2E 28-device-money), UPI & Bank Connect statement matching (INT bank-bills; E2E 28), compliance centre and recalls (E2E 31), staff attendance (INT), staff console and licence server (E2E 16; INT staff, licence, partners), Growth intelligence (E2E 29; INT growth), HRMS (E2E 30; INT hrms-*), Medoro Distribution and chemist portal (E2E dist; INT dist-*), tenant isolation (see the security audit).

## Final regression run
Vitest 1,189/1,189; Playwright 72 passed, 2 skipped, 1 failed in the CI configuration (the 3 pass with the email sink). Full table: [MEDORO_BUG_FIX_LOG.md](MEDORO_BUG_FIX_LOG.md#final-regression-run).
