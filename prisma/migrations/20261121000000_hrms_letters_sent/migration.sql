-- CreateTable
CREATE TABLE "HrLetter" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lastDay" TEXT NOT NULL DEFAULT '',
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "HrLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrLetter_staffId_readAt_idx" ON "HrLetter"("staffId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrLetter_staffId_type_lastDay_key" ON "HrLetter"("staffId", "type", "lastDay");


-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrLetter" ENABLE ROW LEVEL SECURITY;
