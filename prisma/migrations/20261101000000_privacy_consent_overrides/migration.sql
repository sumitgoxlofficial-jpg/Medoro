-- AlterTable
-- Per-user permission overrides on top of the role.
ALTER TABLE "User" ADD COLUMN     "permGrants" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "permRevokes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
-- Consent by purpose and channel: waOptIn stays the transactional WhatsApp consent.
ALTER TABLE "Customer" ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingWa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingSms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Schedule H1 register fields captured on the sale.
ALTER TABLE "Sale" ADD COLUMN     "prescriberReg" TEXT,
ADD COLUMN     "patientName" TEXT;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_tenantId_customerId_at_idx" ON "ConsentRecord"("tenantId", "customerId", "at");

-- Existing transactional WhatsApp opt-ins become the first consent records.
INSERT INTO "ConsentRecord" ("id", "tenantId", "customerId", "purpose", "channel", "granted", "method", "source", "userName", "at")
SELECT gen_random_uuid()::text, "tenantId", "id", 'transactional', 'whatsapp', true, 'counter', 'migration', "optInMethod", COALESCE("optInAt", "createdAt")
FROM "Customer" WHERE "waOptIn";

-- Consent evidence is append-only (restores may still replace it, see restore_runs).
CREATE TRIGGER consent_record_append_only BEFORE UPDATE OR DELETE ON "ConsentRecord"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "ConsentRecord" FROM %I', r.rolname);
  END LOOP;
END $$;
