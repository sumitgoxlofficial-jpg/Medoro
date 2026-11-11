-- CreateTable
CREATE TABLE "HrChat" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "dmKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrChatMember" (
    "chatId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "fromSeq" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrChatMember_pkey" PRIMARY KEY ("chatId","staffId")
);

-- CreateTable
CREATE TABLE "HrChatMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" BYTEA NOT NULL,
    "image" BYTEA,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrChat_dmKey_key" ON "HrChat"("dmKey");

-- CreateIndex
CREATE INDEX "HrChat_lastAt_idx" ON "HrChat"("lastAt");

-- CreateIndex
CREATE INDEX "HrChatMember_staffId_idx" ON "HrChatMember"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "HrChatMessage_seq_key" ON "HrChatMessage"("seq");

-- CreateIndex
CREATE INDEX "HrChatMessage_chatId_seq_idx" ON "HrChatMessage"("chatId", "seq");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrChat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrChatMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrChatMessage" ENABLE ROW LEVEL SECURITY;
