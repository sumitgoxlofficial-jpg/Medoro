-- WhatsApp opt-outs of Drive mode pharmacies (no customer rows on the server): a keyed hash of the number only.
CREATE TABLE "WaOptOut" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaOptOut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WaOptOut_tenantId_phoneHash_key" ON "WaOptOut"("tenantId", "phoneHash");
ALTER TABLE "WaOptOut" ENABLE ROW LEVEL SECURITY;
