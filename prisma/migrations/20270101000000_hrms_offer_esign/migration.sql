-- CreateTable
CREATE TABLE "HrOfferSign" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "email" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "sentById" TEXT,
    "sentByName" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpTries" INTEGER NOT NULL DEFAULT 0,
    "otpVerifiedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT NOT NULL DEFAULT '',
    "signerPhone" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "sigType" TEXT NOT NULL DEFAULT '',
    "sigPng" BYTEA,
    "ip" TEXT,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "signedHash" TEXT,
    "signedPdf" BYTEA,
    "staffId" TEXT,
    "hireError" TEXT NOT NULL DEFAULT '',
    "trail" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "HrOfferSign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrOfferSign_candidateId_key" ON "HrOfferSign"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "HrOfferSign_tokenHash_key" ON "HrOfferSign"("tokenHash");

-- AddForeignKey
ALTER TABLE "HrOfferSign" ADD CONSTRAINT "HrOfferSign_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HrCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrOfferSign" ENABLE ROW LEVEL SECURITY;
