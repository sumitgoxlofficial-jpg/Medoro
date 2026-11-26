-- Performance review cycles and reviews (HRMS → My Review / Appraisals).
-- CreateTable
CREATE TABLE "HrReviewCycle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "selfDue" DATE NOT NULL,
    "managerDue" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrReview" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "managerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'self',
    "selfRating" INTEGER,
    "self" JSONB NOT NULL DEFAULT '{}',
    "selfAt" TIMESTAMP(3),
    "mgrRating" INTEGER,
    "mgr" JSONB NOT NULL DEFAULT '{}',
    "mgrAt" TIMESTAMP(3),
    "mgrBy" TEXT NOT NULL DEFAULT '',
    "finalRating" INTEGER,
    "hrNote" TEXT NOT NULL DEFAULT '',
    "finalAt" TIMESTAMP(3),
    "finalBy" TEXT NOT NULL DEFAULT '',
    "ackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrReview_staffId_idx" ON "HrReview"("staffId");

-- CreateIndex
CREATE INDEX "HrReview_managerId_idx" ON "HrReview"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "HrReview_cycleId_staffId_key" ON "HrReview"("cycleId", "staffId");

-- AddForeignKey
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "HrReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrReviewCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrReview" ENABLE ROW LEVEL SECURITY;
