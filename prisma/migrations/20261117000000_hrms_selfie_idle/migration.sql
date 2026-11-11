-- CreateTable
CREATE TABLE "HrSelfie" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSelfie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrIdle" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrIdle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrSelfie_at_idx" ON "HrSelfie"("at");

-- CreateIndex
CREATE UNIQUE INDEX "HrSelfie_staffId_day_kind_key" ON "HrSelfie"("staffId", "day", "kind");

-- CreateIndex
CREATE INDEX "HrIdle_staffId_day_idx" ON "HrIdle"("staffId", "day");

-- CreateIndex
CREATE INDEX "HrIdle_day_idx" ON "HrIdle"("day");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrSelfie" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrIdle" ENABLE ROW LEVEL SECURITY;
