-- Rollback for prisma/migrations/20261212000000_hrms_workforce. Switch off Settings → Workforce agent first; enrolled
-- agents then get 404/401 and stop. Recorded activity, devices, acknowledgements and disputes are lost.
DROP TABLE IF EXISTS "HrWorkEvent";
DROP TABLE IF EXISTS "HrDevice";
DROP TABLE IF EXISTS "HrDeviceCode";
DROP TABLE IF EXISTS "HrMonitorAck";
DROP TABLE IF EXISTS "HrActivityDispute";
DROP TABLE IF EXISTS "HrAppCategory";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261212000000_hrms_workforce';
