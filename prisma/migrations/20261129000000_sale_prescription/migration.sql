CREATE TABLE "SalePrescription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalePrescription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalePrescription_saleId_key" ON "SalePrescription"("saleId");
CREATE INDEX "SalePrescription_tenantId_idx" ON "SalePrescription"("tenantId");
ALTER TABLE public."SalePrescription" ENABLE ROW LEVEL SECURITY;
