ALTER TABLE "HrProfile" ADD COLUMN "taxRegime" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "HrProfile" ADD COLUMN "taxDeclared" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HrProfile" ADD COLUMN "esiNo" TEXT NOT NULL DEFAULT '';

CREATE TABLE "HrSalaryRevision" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fromCtc" INTEGER NOT NULL,
    "toCtc" INTEGER NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrSalaryRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrSalaryRevision_staffId_at_idx" ON "HrSalaryRevision"("staffId", "at");
