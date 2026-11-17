-- Medoro 2.0 Integration Health Centre: last explicit test per pharmacy and integration, and the scheduler heartbeat.
-- Forward-only: two new tables, nothing existing is altered.
CREATE TABLE "IntegrationHealth" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationHealth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationHealth_tenantId_key_key" ON "IntegrationHealth"("tenantId", "key");

CREATE TABLE "SystemHeartbeat" (
    "key" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SystemHeartbeat_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "IntegrationHealth" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemHeartbeat" ENABLE ROW LEVEL SECURITY;
