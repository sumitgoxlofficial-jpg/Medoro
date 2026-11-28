# Enterprise HRMS 2.0 — deployment, backup, retention and rollback

Nothing here deploys by itself. Merging to `main` **is** a production deployment (Vercel deploys only `main`, and
`scripts/vercel-build.sh` runs `prisma migrate deploy` over `DIRECT_URL` for production builds), so it needs the owner's
explicit approval.

## Migrations (in order, all backward compatible)
| Migration | Adds | Changes existing data? |
|---|---|---|
| `20261209000000_hrms_hardening` | append-only triggers on `HrPayslip`, `HrSalaryRevision`; 4 indexes | No |
| `20261210000000_hrms_org` | `HrEmploymentEvent` (FK, append-only) | No |
| `20261211000000_hrms_rbac_approvals` | `HrAccessGrant`, `HrApproval`, `HrApprovalStep`, `HrDelegation`; `HrProfile.totpPending` (nullable) | No |
| `20261212000000_hrms_workforce` | `HrDevice`, `HrDeviceCode`, `HrWorkEvent`, `HrMonitorAck` (append-only), `HrActivityDispute`, `HrAppCategory` | No |
| `20261213000000_hrms_kpis` | `HrKpi`, `HrKpiResult`, `HrInsight` | No |
| `20261214000000_hrms_shifts` | `HrShift`, `HrShiftAssignment` | No |
| `20261215000000_hrms_learning_engagement` | `HrCourse`, `HrCourseEnrolment`, `HrCourseAttempt` (append-only), `HrSurvey`, `HrSurveyResponse` (append-only) | No |

Every new table has row-level security enabled (not reachable through a hosted data API) and is excluded from pharmacy
restores (`src/domain/system/restore.ts`). New tables use real foreign keys; the older HR tables don't yet (see
`scripts/hrms-integrity-check.sql`).

## Before deploying
1. **Back up** production: Supabase point-in-time recovery, or `pg_dump --format=custom "$DIRECT_URL" > medoro-$(date +%F).dump`.
   Test the restore into a scratch database (`pg_restore --clean --no-owner -d "$SCRATCH_URL" medoro-*.dump`).
2. Run `psql "$REPLICA_URL" -f scripts/hrms-integrity-check.sql` and keep the output (read-only).
3. Deploy to a preview with its own database (`PREVIEW_DATABASE=1`) and smoke test (below).

## New settings (all off by default: behaviour doesn't change until the super admin opts in)
Settings → *Security & approvals*: two-step sign-in for HR/Finance/super admin; salary changes through approval.
Settings → *Workforce agent*: record activity from enrolled company PCs; idle minutes. Tell the team first.

## New environment variables (all optional)
| Variable | For |
|---|---|
| `AGENT_UPDATE_VERSION`, `AGENT_UPDATE_URL`, `AGENT_UPDATE_SHA256`, `AGENT_UPDATE_SIGNING_KEY` | Offering a signed agent update (see `agent/README.md`). Without them `/api/agent/update` answers 204. |
| `APP_URL` | Already used; the agent's tray links to `<APP_URL>/staff/hrms/myactivity`. |

## Scheduled jobs (in the existing `/api/cron/tick`)
Escalation of approval steps overdue by 48 h (every tick); daily: workforce activity retention (90 days) and spent
enrolment codes, KPI recomputation + suggestions for the current period, required-course reminders.

## Smoke test after deploying
New joiner with a temporary password sees only the password step; HR can't edit their own record; the super admin opens
Org chart, Approvals, Workforce devices, KPIs, Shifts & roster, Learning, Engagement and Management; payroll readiness for
the current month lists sensible items; `GET /api/agent/status` without a token answers 401.

## Data retention
| Data | Kept |
|---|---|
| Workforce activity spans | 90 days, then deleted daily |
| Enrolment codes | deleted a day after expiry (15 minutes) |
| Selfies / idle records (existing) | 30 / 90 days |
| Employment history, payslips, salary revisions, audit log, policy and monitoring acknowledgements, quiz attempts, survey responses | permanent (append-only) |
| Approvals, access grants, delegations, disputes, KPI results, suggestions, rosters | permanent (no deletes) |

## Rollback
Application: redeploy the previous Vercel deployment. Database: run the down scripts **newest first**, each in one
transaction, only as far back as needed:

```bash
for m in 20261215000000_hrms_learning_engagement 20261214000000_hrms_shifts 20261213000000_hrms_kpis 20261212000000_hrms_workforce 20261211000000_hrms_rbac_approvals 20261210000000_hrms_org 20261209000000_hrms_hardening; do
  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 -f "scripts/rollback/$m.down.sql" || break
done
```

Each script drops only what its migration added (data recorded in those tables since the deployment is lost; nothing
older is touched) and removes its row from `_prisma_migrations`, so a later `prisma migrate deploy` re-applies it.
This full cycle (apply all → roll all back → re-apply) is tested; see the Phase 8 report.
