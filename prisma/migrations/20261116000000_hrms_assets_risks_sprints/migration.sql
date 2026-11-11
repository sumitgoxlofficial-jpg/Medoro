-- AlterTable
ALTER TABLE "HrTask" ADD COLUMN     "sprintId" TEXT;

-- CreateTable
CREATE TABLE "HrAsset" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Laptop',
    "assigneeId" TEXT,
    "issuedOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRisk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'Medium',
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mitigation" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startOn" DATE NOT NULL,
    "endOn" DATE NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrAsset_tag_key" ON "HrAsset"("tag");

-- CreateIndex
CREATE INDEX "HrAsset_assigneeId_idx" ON "HrAsset"("assigneeId");

-- CreateIndex
CREATE INDEX "HrRisk_projectId_idx" ON "HrRisk"("projectId");

-- CreateIndex
CREATE INDEX "HrSprint_projectId_idx" ON "HrSprint"("projectId");

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrRisk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrSprint" ENABLE ROW LEVEL SECURITY;
