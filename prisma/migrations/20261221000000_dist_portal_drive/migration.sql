-- MEDORO Distribution in Drive mode, chemist portal (docs/DIST_DRIVE_PLAN.md, phase D5). Additive only.
-- The catalogue a distributor's device publishes for chemists (no bills, balances or purchase prices).
CREATE TABLE "DistPortalCatalog" (
    "tenantId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "tiers" JSONB NOT NULL DEFAULT '{}',
    "deviceId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistPortalCatalog_pkey" PRIMARY KEY ("tenantId")
);
-- Portal orders sealed for each of the distributor's devices; deleted once a device takes them in.
CREATE TABLE "DistOrderInbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistOrderInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistOrderInbox_tenantId_deviceId_orderKey_key" ON "DistOrderInbox"("tenantId", "deviceId", "orderKey");
CREATE INDEX "DistOrderInbox_tenantId_orderKey_idx" ON "DistOrderInbox"("tenantId", "orderKey");
-- The chemist's own view of a portal order and the status the distributor's device reports.
CREATE TABLE "DistPortalOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "estimatePaise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "orderNo" TEXT,
    "invoiceNo" TEXT,
    "invoiceTotalPaise" BIGINT,
    "reason" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DistPortalOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistPortalOrder_tenantId_orderKey_key" ON "DistPortalOrder"("tenantId", "orderKey");
CREATE INDEX "DistPortalOrder_tenantId_accountId_idx" ON "DistPortalOrder"("tenantId", "accountId");
ALTER TABLE "DistPortalCatalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DistOrderInbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DistPortalOrder" ENABLE ROW LEVEL SECURITY;
