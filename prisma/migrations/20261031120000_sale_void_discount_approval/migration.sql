-- CreateTable
CREATE TABLE "SaleVoid" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT,
    "refunds" JSONB NOT NULL,
    "cashRefundPaise" BIGINT NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleVoid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "discountPct" DECIMAL(65,30) NOT NULL,
    "cartHash" TEXT NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaleVoid_saleId_key" ON "SaleVoid"("saleId");

-- CreateIndex
CREATE INDEX "SaleVoid_tenantId_branchId_at_idx" ON "SaleVoid"("tenantId", "branchId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApproval_tokenHash_key" ON "DiscountApproval"("tokenHash");

-- CreateIndex
CREATE INDEX "DiscountApproval_tenantId_createdAt_idx" ON "DiscountApproval"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "SaleVoid" ADD CONSTRAINT "SaleVoid_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Voids are append-only like sales: a void is never edited or removed.
CREATE TRIGGER sale_void_append_only BEFORE UPDATE OR DELETE ON "SaleVoid"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER salevoid_notify AFTER INSERT OR UPDATE OR DELETE ON "SaleVoid" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "SaleVoid" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountApproval" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "SaleVoid" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON TABLE "DiscountApproval" FROM %I', r.rolname);
  END LOOP;
END $$;
