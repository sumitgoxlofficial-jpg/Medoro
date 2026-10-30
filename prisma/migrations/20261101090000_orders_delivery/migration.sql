-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('new', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled', 'returned');

-- AlterEnum
ALTER TYPE "PayMode" ADD VALUE 'cod';

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "slotDate" DATE,
    "slot" TEXT,
    "notes" TEXT,
    "payMode" TEXT NOT NULL,
    "payRef" TEXT,
    "discountPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "prescriber" TEXT,
    "rxPath" TEXT,
    "rxMime" TEXT,
    "waConsent" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrderStatus" NOT NULL DEFAULT 'new',
    "estimatePaise" BIGINT NOT NULL DEFAULT 0,
    "saleId" TEXT,
    "invoiceNo" TEXT,
    "totalPaise" BIGINT,
    "riderId" TEXT,
    "otpHash" TEXT,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "proof" TEXT,
    "receivedBy" TEXT,
    "collectedPaise" BIGINT NOT NULL DEFAULT 0,
    "collectedMode" TEXT,
    "settlementId" TEXT,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DeliveryOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderIds" TEXT[],
    "expectedPaise" BIGINT NOT NULL,
    "countedPaise" BIGINT NOT NULL,
    "shiftId" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_saleId_key" ON "DeliveryOrder"("saleId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_tenantId_branchId_status_idx" ON "DeliveryOrder"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "DeliveryOrder_tenantId_riderId_status_idx" ON "DeliveryOrder"("tenantId", "riderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_tenantId_no_key" ON "DeliveryOrder"("tenantId", "no");

-- CreateIndex
CREATE INDEX "DeliveryEvent_orderId_at_idx" ON "DeliveryEvent"("orderId", "at");

-- CreateIndex
CREATE INDEX "RiderSettlement_tenantId_branchId_at_idx" ON "RiderSettlement"("tenantId", "branchId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "RiderSettlement_tenantId_no_key" ON "RiderSettlement"("tenantId", "no");

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Order history and rider cash handovers are append-only, like sales and vouchers.
CREATE TRIGGER delivery_event_append_only BEFORE UPDATE OR DELETE ON "DeliveryEvent"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER rider_settlement_append_only BEFORE UPDATE OR DELETE ON "RiderSettlement"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Live updates for the Orders, Deliveries and Owner screens.
CREATE TRIGGER deliveryorder_notify AFTER INSERT OR UPDATE OR DELETE ON "DeliveryOrder" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER deliveryevent_notify AFTER INSERT OR UPDATE OR DELETE ON "DeliveryEvent" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER ridersettlement_notify AFTER INSERT OR UPDATE OR DELETE ON "RiderSettlement" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();

-- Delivery staff: a "Delivery" role in every pharmacy, and the new permission for owners.
INSERT INTO "Role" ("id", "tenantId", "name", "permissions", "locked")
SELECT gen_random_uuid()::text, t.id, 'Delivery', ARRAY['delivery'], false FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."tenantId" = t.id AND r.name = 'Delivery');
UPDATE "Role" SET permissions = array_append(permissions, 'delivery') WHERE name = 'Owner' AND NOT ('delivery' = ANY(permissions));

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "DeliveryOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryOrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiderSettlement" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "DeliveryOrder" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON TABLE "DeliveryOrderItem" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON TABLE "DeliveryEvent" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON TABLE "RiderSettlement" FROM %I', r.rolname);
  END LOOP;
END $$;