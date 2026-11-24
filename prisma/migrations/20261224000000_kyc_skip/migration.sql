-- Let an employee skip the Aadhaar and PAN step during onboarding. Additive only.
ALTER TABLE "HrProfile" ADD COLUMN "kycSkippedAt" TIMESTAMP(3);
