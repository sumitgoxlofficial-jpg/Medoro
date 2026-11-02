-- Delivery status of WhatsApp messages sent from Drive counters through Meta: message id and status only, kept 7 days.
CREATE TABLE "CounterMsgStatus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CounterMsgStatus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CounterMsgStatus_tenantId_wamid_key" ON "CounterMsgStatus"("tenantId", "wamid");
CREATE INDEX "CounterMsgStatus_createdAt_idx" ON "CounterMsgStatus"("createdAt");
ALTER TABLE "CounterMsgStatus" ENABLE ROW LEVEL SECURITY;
