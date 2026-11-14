-- AlterTable
ALTER TABLE "HrProfile" ADD COLUMN "responsibilities" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "HrPromotion" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "effective" TEXT NOT NULL,
    "fromDesig" TEXT NOT NULL,
    "toDesig" TEXT NOT NULL,
    "fromDept" TEXT NOT NULL,
    "toDept" TEXT NOT NULL,
    "fromManagerId" TEXT,
    "toManagerId" TEXT,
    "fromCtc" INTEGER NOT NULL,
    "toCtc" INTEGER NOT NULL,
    "responsibilities" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "HrPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrPromotion_staffId_effective_key" ON "HrPromotion"("staffId", "effective");

-- CreateIndex
CREATE INDEX "HrPromotion_appliedAt_effective_idx" ON "HrPromotion"("appliedAt", "effective");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrPromotion" ENABLE ROW LEVEL SECURITY;
