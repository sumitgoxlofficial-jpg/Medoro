-- Rollback for prisma/migrations/20261211000000_hrms_rbac_approvals. Drops the Phase 3 tables and column.
-- Individual access grants and approval history recorded since the deployment are lost; turn off the two new
-- Settings first so nobody is mid-way through two-step set-up.
DROP TABLE IF EXISTS "HrApprovalStep";
DROP TABLE IF EXISTS "HrApproval";
DROP TABLE IF EXISTS "HrAccessGrant";
DROP TABLE IF EXISTS "HrDelegation";
DROP FUNCTION IF EXISTS medoro_block_delete() CASCADE;
ALTER TABLE "HrProfile" DROP COLUMN IF EXISTS "totpPending";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261211000000_hrms_rbac_approvals';
