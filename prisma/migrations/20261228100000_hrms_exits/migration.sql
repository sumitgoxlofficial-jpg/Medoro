-- Resignations, exit interviews and clearance checklists (HRMS → Exits).
CREATE TABLE "HrExit" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT NOT NULL DEFAULT '',
    "proposedLastDay" DATE,
    "lastDay" DATE,
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "interview" JSONB NOT NULL DEFAULT '{}',
    "interviewAt" TIMESTAMP(3),
    "clearance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrExit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrExit_staffId_createdAt_idx" ON "HrExit"("staffId", "createdAt");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrExit" ENABLE ROW LEVEL SECURITY;
