-- Online payments to Medoro from self-hosted and desktop installations (licence server).
CREATE TABLE "CpOnlinePayment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "plan" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "couponCode" TEXT,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'created',
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "CpOnlinePayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CpOnlinePayment_orderId_key" ON "CpOnlinePayment"("orderId");
CREATE UNIQUE INDEX "CpOnlinePayment_paymentId_key" ON "CpOnlinePayment"("paymentId");
CREATE INDEX "CpOnlinePayment_customerId_createdAt_idx" ON "CpOnlinePayment"("customerId", "createdAt");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "CpOnlinePayment" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "CpOnlinePayment" FROM %I', r.rolname);
  END LOOP;
END $$;
