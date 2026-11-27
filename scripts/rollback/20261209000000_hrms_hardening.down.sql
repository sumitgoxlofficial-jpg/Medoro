-- Rollback for prisma/migrations/20261209000000_hrms_hardening. Drops only what that migration added; no row of
-- business data is touched. Run in one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback/20261209000000_hrms_hardening.down.sql
-- then deploy the previous application version. `prisma migrate deploy` re-applies the migration later.
DROP TRIGGER IF EXISTS hr_payslip_append_only ON "HrPayslip";
DROP TRIGGER IF EXISTS hr_salary_revision_append_only ON "HrSalaryRevision";
DROP INDEX IF EXISTS "StaffAudit_at_idx";
DROP INDEX IF EXISTS "StaffAudit_staffId_at_idx";
DROP INDEX IF EXISTS "HrProfile_managerId_idx";
DROP INDEX IF EXISTS "HrProfile_dept_idx";
-- Prisma only marks failed migrations as rolled back, so the history row is removed here.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261209000000_hrms_hardening';
