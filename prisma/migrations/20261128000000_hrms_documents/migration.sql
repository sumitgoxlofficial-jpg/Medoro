CREATE TABLE "HrDocument" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrDocument_staffId_idx" ON "HrDocument"("staffId");
