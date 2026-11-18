# MEDORO Distribution — documentation

MEDORO Distribution is the wholesale pharmaceutical distribution ERP inside the MEDORO codebase, alongside MEDORO
Pharmacy. It serves distributors, stockists, super stockists and C&F agents: chemist ordering, batch-wise stock across
godowns, GST invoicing, schemes, expiry claims, dispatch, collections, credit control, books, GST returns, MIS and
business intelligence.

| Document | What it covers |
|---|---|
| [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md) | What already existed, what was reused, what had to be added, and the guardrails the new code respects |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Product separation, database design, transaction rules, concurrency, security model |
| [MODULES.md](MODULES.md) | The 35 modules of the brief: where each lives and its real status |
| [WORKFLOWS.md](WORKFLOWS.md) | Order-to-cash, procure-to-stock, expiry-to-credit, step by step with the checks applied |
| [INTEGRATIONS.md](INTEGRATIONS.md) | GST, e-invoice, e-way bill, banks, licences: configured vs. simulated vs. unavailable |
| [TESTING.md](TESTING.md) | Unit, integration and end-to-end tests, how to run them, and the results recorded |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Migration, environment variables, Vercel/Supabase, hosting policy, rollout |

Entry points: distributor app `/dist`, chemist portal `/portal`, distributor sign-up `/distributor-signup`.
