-- Public careers page: richer job posts and online applications.
ALTER TABLE "HrJob" ADD COLUMN "slug" TEXT,
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'On-site',
ADD COLUMN "experience" TEXT NOT NULL DEFAULT '',
ADD COLUMN "salary" TEXT NOT NULL DEFAULT '',
ADD COLUMN "openings" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "skills" TEXT NOT NULL DEFAULT '',
ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "requirements" TEXT NOT NULL DEFAULT '',
ADD COLUMN "benefits" TEXT NOT NULL DEFAULT '',
ADD COLUMN "postedBy" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "HrJob_slug_key" ON "HrJob"("slug");

ALTER TABLE "HrCandidate" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'hr',
ADD COLUMN "verifiedBy" TEXT,
ADD COLUMN "linkedin" TEXT NOT NULL DEFAULT '',
ADD COLUMN "experience" TEXT NOT NULL DEFAULT '',
ADD COLUMN "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN "cover" TEXT NOT NULL DEFAULT '',
ADD COLUMN "resumeKey" TEXT,
ADD COLUMN "resumeName" TEXT,
ADD COLUMN "resumeType" TEXT;

-- Referrals already in the pipeline keep their origin.
UPDATE "HrCandidate" SET "source" = 'referral' WHERE "referredBy" IS NOT NULL;

CREATE INDEX "HrCandidate_email_idx" ON "HrCandidate"("email");
CREATE INDEX "HrCandidate_jobId_email_idx" ON "HrCandidate"("jobId", "email");
