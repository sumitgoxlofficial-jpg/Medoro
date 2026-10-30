-- AlterEnum
ALTER TYPE "PayMode" ADD VALUE 'loyalty';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptInAt" TIMESTAMP(3),
ADD COLUMN     "smsOptInMethod" TEXT,
ADD COLUMN     "waInvalidAt" TIMESTAMP(3),
ADD COLUMN     "waInvalidReason" TEXT;

-- AlterTable
ALTER TABLE "WaMessage" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "errorKind" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "message" TEXT;

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "valuePaise" BIGINT NOT NULL DEFAULT 0,
    "saleId" TEXT,
    "returnId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaMessage_status_nextAttemptAt_idx" ON "WaMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_tenantId_customerId_idx" ON "LoyaltyLedger"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_saleId_idx" ON "LoyaltyLedger"("saleId");

-- Points change only by new rows (earn, redeem, reverse, restore, expire), never by editing old ones.
CREATE TRIGGER loyalty_ledger_append_only BEFORE UPDATE OR DELETE ON "LoyaltyLedger"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "LoyaltyLedger" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "LoyaltyLedger" FROM %I', r.rolname);
  END LOOP;
END $$;
