-- Rollback for prisma/migrations/20261213000000_hrms_kpis: drops KPI definitions, results and suggestions.
DROP TABLE IF EXISTS "HrKpiResult";
DROP TABLE IF EXISTS "HrKpi";
DROP TABLE IF EXISTS "HrInsight";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261213000000_hrms_kpis';
