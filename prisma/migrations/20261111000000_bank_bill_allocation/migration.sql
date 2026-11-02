-- Self-hosted bill matching: a bank statement credit paid (part of) a credit bill. Each allocation posted a receipt
-- voucher (Dr Bank account / Cr Sundry debtors); undoing it posts a reversal and a negative allocation row.
CREATE TABLE "BankAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankLineId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerLineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rule" INTEGER,
    "reversesId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BankAllocation_amount_check" CHECK ("amountPaise" <> 0),
    CONSTRAINT "BankAllocation_kind_check" CHECK ("kind" IN ('auto', 'approved', 'manual', 'reversal'))
);
CREATE UNIQUE INDEX "BankAllocation_ledgerLineId_key" ON "BankAllocation"("ledgerLineId");
CREATE UNIQUE INDEX "BankAllocation_reversesId_key" ON "BankAllocation"("reversesId");
CREATE INDEX "BankAllocation_tenantId_bankLineId_idx" ON "BankAllocation"("tenantId", "bankLineId");
CREATE INDEX "BankAllocation_tenantId_saleId_idx" ON "BankAllocation"("tenantId", "saleId");
ALTER TABLE "BankAllocation" ADD CONSTRAINT "BankAllocation_bankLineId_fkey" FOREIGN KEY ("bankLineId") REFERENCES "BankLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER bank_allocation_append_only BEFORE UPDATE OR DELETE ON "BankAllocation" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- A suggestion a person rejected: not suggested again.
CREATE TABLE "BankMatchReject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankLineId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankMatchReject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankMatchReject_bankLineId_saleId_key" ON "BankMatchReject"("bankLineId", "saleId");
CREATE INDEX "BankMatchReject_tenantId_idx" ON "BankMatchReject"("tenantId");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "BankAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankMatchReject" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "BankAllocation", "BankMatchReject" FROM %I', r.rolname);
  END LOOP;
END $$;
