-- Subscription payments taken online on a hosted server (Razorpay Checkout).
CREATE TABLE "OnlinePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "plan" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlinePayment_orderId_key" ON "OnlinePayment"("orderId");
CREATE UNIQUE INDEX "OnlinePayment_paymentId_key" ON "OnlinePayment"("paymentId");
CREATE INDEX "OnlinePayment_tenantId_createdAt_idx" ON "OnlinePayment"("tenantId", "createdAt");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "OnlinePayment" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "OnlinePayment" FROM %I', r.rolname);
  END LOOP;
END $$;
