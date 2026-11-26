-- AlterTable
ALTER TABLE "HrProfile" ADD COLUMN     "waAlerts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waAlertsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HrWaMessage" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "waId" TEXT NOT NULL DEFAULT '',
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "HrWaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrWaMessage_status_nextAt_idx" ON "HrWaMessage"("status", "nextAt");

-- CreateIndex
CREATE INDEX "HrWaMessage_staffId_createdAt_idx" ON "HrWaMessage"("staffId", "createdAt");


-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrWaMessage" ENABLE ROW LEVEL SECURITY;
