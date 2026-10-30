-- AlterEnum
-- Short-closed purchase orders: the remaining quantity is no longer receivable.
ALTER TYPE "PoStatus" ADD VALUE 'closed';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "placedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "closedReason" TEXT;

-- AlterTable
-- Inter-state purchases book IGST; debit notes against the GRN follow the same split.
ALTER TABLE "Grn" ADD COLUMN     "igst" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "stateCode" TEXT;