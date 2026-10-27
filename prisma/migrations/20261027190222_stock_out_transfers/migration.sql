-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "note" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT;

-- CreateTable
CREATE TABLE "StockOut" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "supplierId" TEXT,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "valuePaise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockOut_tenantId_no_key" ON "StockOut"("tenantId", "no");
