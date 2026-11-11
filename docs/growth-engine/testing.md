# Testing

## Commands

```bash
pnpm typecheck && pnpm lint
pnpm prisma validate
pnpm test                                   # unit + integration against PostgreSQL (TEST_DATABASE_URL)
pnpm build
pnpm test:e2e e2e/29-growth.spec.ts         # needs a production build and the e2e environment (docs/TEST_PLAN.md)
```

## What is covered

| File | Covers |
|---|---|
| `src/staff/growth/growth.test.ts` (24 tests) | E.164 normalisation and `tel:` URIs; name keys, similarity, domains, states; record normalisation; column mapping; score rules and provenance; verification status; equal/balance split (300 → 100 each); stage transitions; SSRF guard; Overpass query escaping and OSM mapping; follow-up recommendations; template rendering; permission matrix; **static isolation**: no pharmacy table access, no merchant Drive/storage imports |
| `tests/integration/growth.test.ts` (23 tests, real PostgreSQL) | Roles (partners excluded); lead creation and duplicate refusal; possible-duplicate queue and safe merge with append-only history; CSV and XLSX import with preview, invalid rows, in-file and existing duplicates, formula-safe error report, lawful-source confirmation; evidence-only verification and the website check incl. private-IP refusal; 300-lead import as a background job and equal distribution; database refusal of a second active assignment; manager and employee scope; call launch → `tel:` URI, double-tap reuse, foreign report refused, required follow-up, idempotent report, duplicate report refused, follow-up/stage/consent/score in one transaction; dialer opens vs reported calls in performance, targets, MY WORK; reassignment keeping history and moving follow-ups; inactive employee hand-over; territories; DNC and wrong-number suppression; authorised-only policy; follow-up escalation once; lost reason, conversion revenue, hand-off to the commission pipeline; consent-gated messages; campaign approval, consent skipping, batch send; WhatsApp webhook signature, delivery, reply and STOP; signed email events; unsubscribe token; erasure and re-import block; export permission, audit and rate limit; AI facts never invented, Hindi draft; job backoff, dead letter and retry; OSM discovery idempotency; withdrawal; append-only audit; **JSON API**: 401 without session, CSRF 403, exact launch response, 400 on bad input, 403 for wrong role |
| `tests/integration/hrms.test.ts` (16 tests) | HRMS sign-in and lockout, HR-created profiles, forced password change, one-time passwords, sealed bank/PAN, permissions, leave and claim rules, payroll maths and processing, payslip access, tasks and performance, lead import to won sale, GST invoices, deactivation |
| `e2e/29-growth.spec.ts` (Playwright) | Admin imports a CSV through the UI and distributes; an employee on a Pixel 7 viewport opens the calling workspace, taps CALL PHARMACY (the `tel:` link is captured), submits the report; the follow-up exists; the employee can't open admin screens; all 23 Growth screens render for the admin |

Existing guard tests also cover the module: restore classification (`restore.test.ts`) and row level security on every
table (`hosting.test.ts`).

## Not covered by automated tests

Live calls to Meta, email providers and Overpass (stubbed in tests); a real phone's dialer (the `tel:` link is asserted,
not dialled); the existing Google OAuth and Drive suites were run unchanged as part of `pnpm test` but nothing in them
exercises Growth.
