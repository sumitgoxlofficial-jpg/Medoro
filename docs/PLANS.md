# Plans and what they unlock

The rules live in one file, `src/lib/plans.ts`, and mirror the pricing table on the website. The server enforces them
(`requireFeature` / `requireRoom` in `src/server/context.ts`); screens explain them (`UpgradeNote`, and the "What your plan
includes" card on Subscription).

| | Starter | Professional | Multi-branch |
|---|---|---|---|
| Branches / counters / users | 1 / 2 / 3 | 1 / 5 / 10 | 5 / 15 / 25 (+1 branch per "branch" add-on) |
| Billing, stock, expiry alerts, purchases and suppliers, WhatsApp invoices, backups | yes | yes | yes |
| Accounts: day book, P&L, ledgers, expenses, GST summaries and returns (`accounts`) | | yes | yes |
| Customer credit and statements (`credit`) | | yes | yes |
| Supplier invoice scanner (`scanner`) | | yes | yes |
| Roles, permissions, "View as" and the audit trail (`roles`) | | yes | yes |
| Offline billing on the shop network (`offline`) | | yes | yes |
| Branch transfers, central purchasing, consolidated reports, anomaly review (`transfers`, `central`, `consolidated`, `anomaly`) | | | yes |

## When everything is open
The 7-day free trial (`status = trial`), a copy that runs under no licence server (self-hosted, never limited), and an install
that has not yet received a plan from the licence server. A **cancelled** plan keeps its plan's features until it ends. After
the trial or paid period the existing subscription phases apply (grace, then read-only).

## What stays free on every plan
Registers kept by law (Schedule H1 register, HSN summary, sales register), supplier statements, e-invoice and e-way bill,
cheques, bank reconciliation, UPI & Bank Connect, the AI assistant's built-in rules (the smart model is the separate AI add-on).
These are not in the pricing table; to put one behind a plan, add a feature in `plans.ts` and call `requireFeature`.

## Over a limit
Existing users, counters and branches keep working (a downgrade never locks people out). Adding one more is refused with
the plan to upgrade to. Open invites count towards the user limit.

## Where it is enforced
Accounting services and the GST/accounting-report exports (`accounts`, `consolidated`), customer sales on credit, credit
limits and customer statements (`credit`), the invoice upload (`scanner`), role and permission edits, "View as" and the audit
trail (`roles`), enabling an offline counter (`offline`), transfer requests (`transfers`), central buying (`central`),
anomaly review (`anomaly`), and inviting, reactivating or adding users, counters and branches (limits). Counters on the
Google Drive (device) side are a separate registry and are not limited by plan yet.
