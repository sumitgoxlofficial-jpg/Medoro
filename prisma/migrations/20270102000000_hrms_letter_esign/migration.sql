-- CreateTable
CREATE TABLE "HrLetterSign" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3) NOT NULL,
    "signerName" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "sigType" TEXT NOT NULL,
    "sigPng" BYTEA NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "docHash" TEXT NOT NULL,
    "signedHash" TEXT NOT NULL,
    "signedPdf" BYTEA NOT NULL,
    "trail" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "HrLetterSign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrLetterSign_staffId_type_key" ON "HrLetterSign"("staffId", "type");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrLetterSign" ENABLE ROW LEVEL SECURITY;
