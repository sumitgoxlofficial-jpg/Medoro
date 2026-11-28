-- Enterprise HRMS Phase 5: KPIs per department/designation, results with evidence, advisory insights. New tables only.
-- CreateTable
CREATE TABLE "HrKpi" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dept" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "better" TEXT NOT NULL DEFAULT 'higher',
    "target" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'month',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrKpiResult" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "value" DOUBLE PRECISION,
    "target" DOUBLE PRECISION NOT NULL,
    "weight" INTEGER NOT NULL,
    "score" INTEGER,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "explanation" TEXT NOT NULL,
    "manualNote" TEXT NOT NULL DEFAULT '',
    "enteredBy" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrKpiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrInsight" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrKpi_active_idx" ON "HrKpi"("active");

-- CreateIndex
CREATE INDEX "HrKpiResult_staffId_periodStart_idx" ON "HrKpiResult"("staffId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "HrKpiResult_kpiId_staffId_periodStart_key" ON "HrKpiResult"("kpiId", "staffId", "periodStart");

-- CreateIndex
CREATE INDEX "HrInsight_status_staffId_idx" ON "HrInsight"("status", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "HrInsight_staffId_key_periodStart_key" ON "HrInsight"("staffId", "key", "periodStart");

-- AddForeignKey
ALTER TABLE "HrKpiResult" ADD CONSTRAINT "HrKpiResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "HrKpi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrKpiResult" ADD CONSTRAINT "HrKpiResult_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HrKpi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrKpiResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrInsight" ENABLE ROW LEVEL SECURITY;
