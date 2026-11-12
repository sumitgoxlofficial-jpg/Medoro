-- CreateTable
CREATE TABLE "HrChatBackup" (
    "staffId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenSealed" BYTEA NOT NULL,
    "fileId" TEXT NOT NULL DEFAULT '',
    "lastAt" TIMESTAMP(3),
    "lastCount" INTEGER NOT NULL DEFAULT 0,
    "lastBytes" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrChatBackup_pkey" PRIMARY KEY ("staffId")
);

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrChatBackup" ENABLE ROW LEVEL SECURITY;
