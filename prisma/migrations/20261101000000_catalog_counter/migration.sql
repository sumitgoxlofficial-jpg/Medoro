-- AlterTable
-- Composition (salt) search and substitutes, and multi-unit stock.
-- Batch quantities have always been whole packs. packSize defaults to 1, so every existing quantity, sale,
-- return, transfer and count keeps its meaning: one stock unit = one pack. A medicine only switches to
-- loose stock units when someone sets its pack size, which rescales its batches through a "unit" movement.
ALTER TABLE "Medicine" ADD COLUMN     "composition" TEXT,
ADD COLUMN     "saltKey" TEXT,
ADD COLUMN     "packSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "packUnit" TEXT NOT NULL DEFAULT 'pack',
ADD COLUMN     "looseUnit" TEXT NOT NULL DEFAULT 'unit',
ADD COLUMN     "allowLoose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "caseSize" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "caseUnit" TEXT NOT NULL DEFAULT 'box';

-- Single-salt medicines get their composition from generic + strength, normalised the same way as
-- src/domain/inventory/salts.ts. Combinations are left for "Rebuild composition keys" in Inventory.
UPDATE "Medicine"
SET "composition" = trim(regexp_replace(generic, '\s+', ' ', 'g')) || ' ' || lower(regexp_replace(strength, '\s+', '', 'g')),
    "saltKey" = lower(trim(regexp_replace(generic, '\s+', ' ', 'g'))) || ' ' || lower(regexp_replace(strength, '\s+', '', 'g'))
WHERE generic !~ '[+,;&/]' AND strength ~* '^\s*[0-9]+(\.[0-9]*[1-9])?\s*(mg|mcg|g|ml|iu|%)\s*$';

-- CreateIndex
CREATE INDEX "Medicine_tenantId_saltKey_idx" ON "Medicine"("tenantId", "saltKey");

-- CreateTable
CREATE TABLE "MedicineRack" (
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineRack_pkey" PRIMARY KEY ("branchId","medicineId")
);

-- CreateIndex
CREATE INDEX "MedicineRack_tenantId_branchId_rack_idx" ON "MedicineRack"("tenantId", "branchId", "rack");

-- AddForeignKey
ALTER TABLE "MedicineRack" ADD CONSTRAINT "MedicineRack_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualification" TEXT,
    "regNo" TEXT,
    "clinic" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- Like every table: no access through a hosted data API (see 20261028150000_lock_data_api).
ALTER TABLE "MedicineRack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Doctor" ENABLE ROW LEVEL SECURITY;

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_tenantId_regNo_key" ON "Doctor"("tenantId", "regNo");

-- CreateIndex
CREATE INDEX "Doctor_tenantId_name_idx" ON "Doctor"("tenantId", "name");

-- AlterTable
-- Sales keep the free-text prescriber too, so older bills and offline bills read the same.
ALTER TABLE "Sale" ADD COLUMN     "doctorId" TEXT;

-- CreateIndex
CREATE INDEX "Sale_tenantId_doctorId_at_idx" ON "Sale"("tenantId", "doctorId", "at");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Loose lines carry qty, MRP and cost per loose unit; existing lines are whole packs at packSize 1.
ALTER TABLE "SaleItem" ADD COLUMN     "loose" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packSize" INTEGER NOT NULL DEFAULT 1;
