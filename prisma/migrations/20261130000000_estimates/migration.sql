CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "validUntil" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Estimate_tenantId_no_key" ON "Estimate"("tenantId", "no");
CREATE INDEX "Estimate_tenantId_branchId_createdAt_idx" ON "Estimate"("tenantId", "branchId", "createdAt");
ALTER TABLE public."Estimate" ENABLE ROW LEVEL SECURITY;
