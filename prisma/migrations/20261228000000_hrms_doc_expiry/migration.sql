-- Document expiry dates and reminder progress (HRMS → My profile → KYC & certificates).
ALTER TABLE "HrDocument" ADD COLUMN "expiresOn" DATE;
ALTER TABLE "HrDocument" ADD COLUMN "expiryStage" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "HrDocument_expiresOn_idx" ON "HrDocument"("expiresOn");
