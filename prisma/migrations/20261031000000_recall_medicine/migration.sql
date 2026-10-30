-- AlterTable
-- Recalls match on medicine + batch number; older notices keep matching on batch number only.
ALTER TABLE "Recall" ADD COLUMN     "medicineId" TEXT;
