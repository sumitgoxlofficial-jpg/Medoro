-- Purchase pricing: PTR/PTS/MRP, free-goods schemes and discounts on PO and GRN lines.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "freeQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ptsPaise" BIGINT,
ADD COLUMN     "mrpPaise" BIGINT,
ADD COLUMN     "scheme" TEXT,
ADD COLUMN     "schemePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tradePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cashPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "Grn" ADD COLUMN     "itc" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gstBase" TEXT NOT NULL DEFAULT 'net';

ALTER TABLE "GrnItem" ADD COLUMN     "ptsPaise" BIGINT,
ADD COLUMN     "mrpPaise" BIGINT,
ADD COLUMN     "scheme" TEXT,
ADD COLUMN     "schemePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tradePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cashPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "basePaise" BIGINT,
ADD COLUMN     "gstPaise" BIGINT,
ADD COLUMN     "costPaise" BIGINT;

-- Expiry-return window and saved digital-bill column mapping per supplier.
ALTER TABLE "Supplier" ADD COLUMN     "returnWindowDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "ebillMapping" JSONB;

CREATE TABLE "SupplierItemMap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierItemMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierItemMap_tenantId_supplierId_code_key" ON "SupplierItemMap"("tenantId", "supplierId", "code");

CREATE TABLE "SupplierClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "stockOutId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL,
    "claimPaise" BIGINT NOT NULL,
    "creditPaise" BIGINT NOT NULL DEFAULT 0,
    "writeOffPaise" BIGINT NOT NULL DEFAULT 0,
    "writeOffReason" TEXT,
    "credits" JSONB NOT NULL DEFAULT '[]',
    "raisedBy" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "SupplierClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierClaim_tenantId_no_key" ON "SupplierClaim"("tenantId", "no");
CREATE INDEX "SupplierClaim_tenantId_supplierId_status_idx" ON "SupplierClaim"("tenantId", "supplierId", "status");

CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "chequeDate" DATE NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depositedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "bounceReason" TEXT,
    "chargePaise" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Cheque_tenantId_direction_partyId_no_key" ON "Cheque"("tenantId", "direction", "partyId", "no");
CREATE INDEX "Cheque_tenantId_status_chequeDate_idx" ON "Cheque"("tenantId", "status", "chequeDate");

CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "lines" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "ref" TEXT,
    "amountPaise" BIGINT NOT NULL,
    "balancePaise" BIGINT,
    "row" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "ledgerLineId" TEXT,
    "matchedBy" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,

    CONSTRAINT "BankLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankLine_ledgerLineId_key" ON "BankLine"("ledgerLineId");
CREATE INDEX "BankLine_tenantId_date_idx" ON "BankLine"("tenantId", "date");
CREATE UNIQUE INDEX "BankLine_tenantId_fingerprint_key" ON "BankLine"("tenantId", "fingerprint");
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "SupplierItemMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cheque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankLine" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "SupplierItemMap", "SupplierClaim", "Cheque", "BankStatement", "BankLine" FROM %I', r.rolname);
  END LOOP;
END $$;
