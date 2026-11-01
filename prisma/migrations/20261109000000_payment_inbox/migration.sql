-- Drive mode customer payments: a Razorpay payment that arrived while no counter was online, sealed for each
-- approved device (only that device can open it). Deleted as soon as a counter records it.
CREATE TABLE "PaymentInbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentInbox_tenantId_deviceId_paymentId_key" ON "PaymentInbox"("tenantId", "deviceId", "paymentId");
CREATE INDEX "PaymentInbox_tenantId_paymentId_idx" ON "PaymentInbox"("tenantId", "paymentId");
ALTER TABLE "PaymentInbox" ENABLE ROW LEVEL SECURITY;
