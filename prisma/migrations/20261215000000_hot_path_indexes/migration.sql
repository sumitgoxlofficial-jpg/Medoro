-- Hot-path indexes found by the audit (docs/audit/MEDORO_PERFORMANCE_REPORT.md): the open-shift lookup taken on every
-- sale commit, WhatsApp status webhooks (by wamid) and per-invoice message lookups, and the offline-conflict badge.
-- Additive only. Plain CREATE INDEX (Prisma runs migrations in a transaction); the tables are small on hosted servers.

-- CreateIndex
CREATE INDEX "OfflineOp_tenantId_status_idx" ON "OfflineOp"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Shift_tenantId_branchId_closedAt_idx" ON "Shift"("tenantId", "branchId", "closedAt");

-- CreateIndex
CREATE INDEX "WaMessage_tenantId_wamid_idx" ON "WaMessage"("tenantId", "wamid");

-- CreateIndex
CREATE INDEX "WaMessage_tenantId_invoiceId_idx" ON "WaMessage"("tenantId", "invoiceId");

