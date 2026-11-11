-- AlterTable
ALTER TABLE "HrChat" ADD COLUMN     "about" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "photo" TEXT,
ADD COLUMN     "sysKey" TEXT;

-- AlterTable
ALTER TABLE "HrChatMember" ADD COLUMN     "typingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrProfile" ADD COLUMN     "chatAvatar" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "HrChatReaction" (
    "messageId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "HrChatReaction_pkey" PRIMARY KEY ("messageId","staffId","emoji")
);

-- CreateTable
CREATE TABLE "HrChatVote" (
    "messageId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,

    CONSTRAINT "HrChatVote_pkey" PRIMARY KEY ("messageId","staffId","option")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrChat_sysKey_key" ON "HrChat"("sysKey");


-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrChatReaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrChatVote" ENABLE ROW LEVEL SECURITY;
