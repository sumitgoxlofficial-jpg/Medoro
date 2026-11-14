-- HR can send an Aadhaar or PAN proof back with a reason; the employee sees it on their KYC step.
ALTER TABLE "HrProfile" ADD COLUMN "kycNote" TEXT NOT NULL DEFAULT '';
