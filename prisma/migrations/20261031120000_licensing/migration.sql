-- AlterTable
ALTER TABLE "SubscriptionMeta" ADD COLUMN     "checkError" TEXT,
ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "inbox" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "licenceId" TEXT,
ADD COLUMN     "signedDoc" TEXT,
ADD COLUMN     "supportSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CpCustomer" ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "licenceId" TEXT,
ADD COLUMN     "licenceToken" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "email" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CpSale" ADD COLUMN     "payRef" TEXT;

-- AlterTable
ALTER TABLE "RemoteAccessRequest" ADD COLUMN     "link" TEXT;

-- CreateTable
CREATE TABLE "LicenceOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "LicenceOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpBillingEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "number" TEXT,
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "gstPaise" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "saleId" TEXT,
    "requestId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "CpBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LicenceOutbox_tenantId_sentAt_idx" ON "LicenceOutbox"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CpBillingEvent_number_key" ON "CpBillingEvent"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CpBillingEvent_requestId_key" ON "CpBillingEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CpCustomer_licenceId_key" ON "CpCustomer"("licenceId");

-- AddForeignKey
ALTER TABLE "CpBillingEvent" ADD CONSTRAINT "CpBillingEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CpCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "LicenceOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CpBillingEvent" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "LicenceOutbox" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON TABLE "CpBillingEvent" FROM %I', r.rolname);
  END LOOP;
END $$;
