-- AlterTable
ALTER TABLE "HrMeeting" ADD COLUMN     "googleEventId" TEXT;

-- CreateTable
CREATE TABLE "HrGoogle" (
    "staffId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenSealed" BYTEA NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrGoogle_pkey" PRIMARY KEY ("staffId")
);

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrGoogle" ENABLE ROW LEVEL SECURITY;
