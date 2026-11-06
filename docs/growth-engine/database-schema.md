# Database schema

Migration: `prisma/migrations/20261113000000_growth_intelligence/migration.sql`. **Additive only**: 9 enums and 33 new
tables; no existing column is changed or dropped. `StaffUser` gains relation fields in Prisma only (no column).

Conventions: UUID primary keys, `createdAt`/`updatedAt`, foreign keys inside the module, indexes for every list filter,
soft deletion (`deletedAt`, `erasedAt`) on leads, contacts and notes, idempotency keys where retries are possible.

## Tables (requested name → implemented as)

| Requested | Table | Notes |
|---|---|---|
| GrowthTeam | `GrowthTeam` | name, managerId |
| GrowthEmployee | `GrowthMember` | one per `StaffUser`; role, team, active |
| GrowthRole | enum `GrowthRole` | manager, sales, analyst (super admin = staff role) |
| GrowthPermission | `ROLE_PERMS` in `constants.ts` | code-level matrix, checked server-side (same pattern as the pharmacy app's role grants) |
| PharmacyLead | `PharmacyLead` | all requested fields, per-dimension verification timestamps, stage, score, denormalised `assignedStaffId` |
| PharmacyContact | `PharmacyContact` | provenance per contact |
| LeadSource | `LeadSource` | licence, attribution, terms URL, `allowsExport`; four built-ins seeded |
| LeadEvidence | `LeadEvidence` | **append-only** |
| LeadImportJob | `LeadImportJob` | counts, error report, pending rows (cleared when done) |
| — | `LeadDuplicateCandidate` | duplicate review queue |
| LeadAssignment | `LeadAssignment` | `active`, `primary`, deadline, end reason |
| LeadAssignmentHistory | `LeadAssignmentHistory` | **append-only** |
| LeadScore | `LeadScore` | snapshot with breakdown JSON on every change |
| LeadNote | `LeadNote` | |
| LeadActivity | `LeadActivity` | timeline, **append-only** |
| CallSession | `CallSession` | dialer launch + report; unique `reportKey` (idempotency) |
| FollowUpTask | `FollowUpTask` | status, `escalatedAt` |
| EmployeeCallingTarget | `EmployeeCallingTarget` | daily/weekly, effective from a date |
| EmployeeDailyPerformance | `EmployeeDailyPerformance` | nightly roll-up, unique (staff, day) |
| EmployeeTerritory | `EmployeeTerritory` | state / district / PIN |
| SalesCampaign, CampaignRecipient | same | recipient unique per campaign |
| MessageTemplate | `MessageTemplate` | unique (channel, name, language) |
| MessageConversation, MessageEvent | same | unique (channel, address) |
| ContactConsent | `ContactConsent` | channel, purpose, scope, lawful basis, evidence, revocation |
| SuppressionRecord | `SuppressionRecord` | SHA-256 of the phone/email + masked hint |
| SalesDeal, DemoBooking, ConversionRecord | same | conversion unique per lead |
| IntegrationConnection | `IntegrationConnection` | secrets sealed with `HOST_KEY` (AES-256-GCM) |
| BackgroundJob, EventOutbox | same | unique job idempotency key |
| GrowthAuditLog | `GrowthAuditLog` | **append-only** |
| — | `GrowthSetting` | contact policy |

## One active primary assignment per lead

Enforced twice by the database:

1. `CREATE UNIQUE INDEX "LeadAssignment_one_active_primary" ON "LeadAssignment"("leadId") WHERE "active" AND "primary";`
   (partial index; Prisma 6 cannot declare it, so it lives in the migration SQL. `prisma migrate diff` shows no drift.)
2. `activeLeadKey` (`@unique`, = leadId while active, NULL otherwise), the Prisma-visible twin.

Bulk assignment runs in one transaction; a concurrent assignment trips the index and the whole batch rolls back.

## Append-only

`LeadActivity`, `LeadEvidence`, `LeadAssignmentHistory`, `GrowthAuditLog` use the existing `medoro_block_change()` trigger.

## Applying

```bash
pnpm prisma migrate deploy
```
Run it on staging first (see deployment.md). The migration also enables row level security on every new table and seeds
the four built-in lead sources.
