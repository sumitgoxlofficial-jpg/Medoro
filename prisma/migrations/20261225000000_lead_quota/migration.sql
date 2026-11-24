-- Monthly lead quota per salesperson (default 100, set by HR) and when a lead was assigned. Additive only.
ALTER TABLE "HrProfile" ADD COLUMN "monthlyLeadQuota" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Lead" ADD COLUMN "assignedAt" TIMESTAMP(3);
