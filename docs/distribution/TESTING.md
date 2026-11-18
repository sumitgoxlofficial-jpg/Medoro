# Testing

## Suites

| Suite | File(s) | What it proves |
|---|---|---|
| Rule unit tests (39) | `src/domain/distribution/rules/rules.test.ts` | Wholesale GST pricing & round-off, inter-state IGST, rate tiers & special rates, retailer margin, schemes (slabs, dates, min qty, chemist lists, best of product/company), credit control (limit, pending orders, overdue + grace, blocked, expired/missing licence, cash-only), expiry bands, claim windows, expected credit, expiry loss, FEFO with reservations / whole packs / short-dated skip / shortage report, paid-free split, FIFO outstanding & ageing, licence checks, order state machine, reorder quantity, dead stock, credit risk score, scheme impact, trend, portal stock visibility, plan entitlements, permission computation, hosting policy |
| Lifecycle integration (7) | `tests/integration/dist-lifecycle.test.ts` | Distribution tenant & roles; approve → pick → pack → invoice with scheme, FEFO and exact GST; idempotent replays; reservations; **6 concurrent approvals never over-allocate**; credit hold + override permission + audited reason; direct billing with IGST, same-day cancel restoring stock and balance, DB-level immutability; expired licence refusal |
| Flows integration (9) | `tests/integration/dist-flows.test.ts` | Credit notes (saleable/damaged, GST reduction, limits), breakage claim → ack → credit → reconciliation, near-expiry window refusal, GSTR-1/3B docs, expiry workbench, dispatch → POD → door collection → office collection → statement to zero, overpayment refusal, FIFO ageing, all 14 MIS reports, dashboard, assistant, reorder → **draft** PO only, salesman can't draft POs, full portal flow with hidden stock/MRP and cross-chemist invoice isolation, hidden product refusal, **two-distributor isolation**, role boundaries, read-only support, lapsed subscription, salesman assignment |
| Operations integration (3) | `tests/integration/dist-ops.test.ts` | Multiple godowns (allocation only from the order's godown; transfer then approve), **reconciliation invariants** (balanced trial balance, debtors control = sum of chemist balances = receivables, IGST net of credit notes, stock movements explain every batch), backup content and tenant deletion |
| End-to-end (3) | `e2e/dist/distribution.dist.ts` | Through the UI on a production build: distributor sign-up → owner TOTP enrolment → masters → GRN (total check) → order → approve → mobile pick → pack → invoice → dispatch → POD + collection → credit note → reports/GST/insights; chemist portal register → connect → approve → order → appears for approval |
| Existing guardrails | `security`, `hosting`, `restore`, `rls-readiness`, `backup`, `deletion`, `i18n-coverage`, … | Still green with the new tables |

## Running

```bash
# unit + integration (needs PostgreSQL; TEST_DATABASE_URL defaults to medoro_test on localhost)
pnpm test
pnpm vitest run src/domain/distribution tests/integration/dist-*.test.ts   # just distribution

# end-to-end on a production build, self-hosted configuration
pnpm build
SETUP_OPEN=1 pnpm start -p 3400 &
E2E_BASE_URL=http://localhost:3400 npx playwright test --project=dist --trace off
```

## Results recorded for this change

* `pnpm vitest run` (whole repository): **185 files, 1,177 tests passed**, 0 failed.
* `pnpm typecheck`, `pnpm lint`: clean.
* `next build`: succeeds (in this container it needed `NODE_OPTIONS=--max-old-space-size=6144`; the base commit's type
  check already uses ~2.8 GB, more than this change's ~2.5 GB, so this is the container's default heap, not a regression).
* Playwright `dist` project against `next start`: **3 passed**.
* Offline / sync conflicts: not applicable — Distribution has no offline mode (see MODULES.md).
