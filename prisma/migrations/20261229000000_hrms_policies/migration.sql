-- Company policy handbook and acknowledgements (HRMS → Company policies / Policies).
-- CreateTable
CREATE TABLE "HrPolicy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "publishedBy" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPolicyAck" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPolicyAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrPolicyAck_staffId_idx" ON "HrPolicyAck"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "HrPolicyAck_policyId_staffId_version_key" ON "HrPolicyAck"("policyId", "staffId", "version");

-- AddForeignKey
ALTER TABLE "HrPolicyAck" ADD CONSTRAINT "HrPolicyAck_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "HrPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

