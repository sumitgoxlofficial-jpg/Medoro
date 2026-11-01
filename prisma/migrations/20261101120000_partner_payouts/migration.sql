-- Reference partners: Google sign-in, RazorpayX payouts.
ALTER TABLE "StaffUser" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "StaffUser_googleSub_key" ON "StaffUser"("googleSub");
ALTER TABLE "StaffBank" ADD COLUMN "rzpFundAccountId" TEXT;

CREATE TABLE "StaffPayout" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "tdsPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "saleIds" TEXT[],
    "method" TEXT NOT NULL,
    "rzpPayoutId" TEXT,
    "status" TEXT NOT NULL,
    "utr" TEXT,
    "failure" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffPayout_ref_key" ON "StaffPayout"("ref");
CREATE UNIQUE INDEX "StaffPayout_rzpPayoutId_key" ON "StaffPayout"("rzpPayoutId");
CREATE INDEX "StaffPayout_staffId_createdAt_idx" ON "StaffPayout"("staffId", "createdAt");

-- No hosted data API access; the app connects as the table owner.
ALTER TABLE "StaffPayout" ENABLE ROW LEVEL SECURITY;
