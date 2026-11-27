-- Rollback for prisma/migrations/20261210000000_hrms_org: drops the employment-history table it created.
DROP TABLE IF EXISTS "HrEmploymentEvent";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261210000000_hrms_org';
