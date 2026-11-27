-- Rollback for prisma/migrations/20261214000000_hrms_shifts. Deploy the previous app version first (check-in reads the
-- roster). Lateness then falls back to each person's own shift start or Settings.
DROP TABLE IF EXISTS "HrShiftAssignment";
DROP TABLE IF EXISTS "HrShift";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261214000000_hrms_shifts';
