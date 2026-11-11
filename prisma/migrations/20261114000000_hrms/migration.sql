-- CreateEnum
CREATE TYPE "HrRole" AS ENUM ('employee', 'hr', 'admin', 'finance', 'sales');

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'employee';

-- AlterTable
ALTER TABLE "StaffSession" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'console';

-- CreateTable
CREATE TABLE "HrProfile" (
    "staffId" TEXT NOT NULL,
    "role" "HrRole" NOT NULL DEFAULT 'employee',
    "dept" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "empType" TEXT NOT NULL DEFAULT 'Full-time',
    "location" TEXT NOT NULL DEFAULT '',
    "managerId" TEXT,
    "joinDate" DATE,
    "ctc" INTEGER NOT NULL DEFAULT 0,
    "incentivePct" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "monthlyTarget" INTEGER NOT NULL DEFAULT 40,
    "personalEmail" TEXT NOT NULL DEFAULT '',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "profileDone" BOOLEAN NOT NULL DEFAULT false,
    "docsAcceptedAt" TIMESTAMP(3),
    "dob" DATE,
    "gender" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "emergencyName" TEXT NOT NULL DEFAULT '',
    "emergencyPhone" TEXT NOT NULL DEFAULT '',
    "bloodGroup" TEXT NOT NULL DEFAULT '',
    "bankHolder" TEXT NOT NULL DEFAULT '',
    "bankAccountSealed" BYTEA,
    "bankLast4" TEXT NOT NULL DEFAULT '',
    "bankIfsc" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "panSealed" BYTEA,
    "panMasked" TEXT NOT NULL DEFAULT '',
    "uan" TEXT NOT NULL DEFAULT '',
    "photo" TEXT,
    "presence" TEXT NOT NULL DEFAULT 'offline',
    "presenceNote" TEXT NOT NULL DEFAULT '',
    "presenceAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "onboarding" JSONB NOT NULL DEFAULT '[]',
    "leaveExtra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrProfile_pkey" PRIMARY KEY ("staffId")
);

-- CreateTable
CREATE TABLE "HrDepartment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "inAt" TIMESTAMP(3),
    "outAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "breakMin" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HrAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrBreak" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),

    CONSTRAINT "HrBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeave" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCorrection" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrClaim" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "billKey" TEXT,
    "billName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending_hr',
    "hrBy" TEXT,
    "adminBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "paidMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrHoliday" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'National holiday',

    CONSTRAINT "HrHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAnnouncement" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📢',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'Internal',
    "leadId" TEXT,
    "members" TEXT[],
    "deadline" DATE,
    "status" TEXT NOT NULL DEFAULT 'Planning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'task',
    "title" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "due" DATE,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "col" TEXT NOT NULL DEFAULT 'todo',
    "projectId" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayslip" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "workDays" INTEGER NOT NULL,
    "lopDays" INTEGER NOT NULL DEFAULT 0,
    "basic" INTEGER NOT NULL,
    "hra" INTEGER NOT NULL,
    "special" INTEGER NOT NULL,
    "incentive" INTEGER NOT NULL DEFAULT 0,
    "reimburse" INTEGER NOT NULL DEFAULT 0,
    "gross" INTEGER NOT NULL,
    "pf" INTEGER NOT NULL,
    "esi" INTEGER NOT NULL,
    "pt" INTEGER NOT NULL,
    "tds" INTEGER NOT NULL,
    "lop" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidOn" DATE,
    "runBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPayslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrJob" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCandidate" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "score" INTEGER,
    "stage" TEXT NOT NULL DEFAULT 'applied',
    "offer" JSONB,
    "referredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTicket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reply" TEXT NOT NULL DEFAULT '',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMeeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "link" TEXT NOT NULL DEFAULT '',
    "byId" TEXT NOT NULL,
    "attendees" TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrRecognition" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "badge" TEXT NOT NULL DEFAULT '🌟',
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrNotification" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "screen" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAllyUsage" (
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "prompts" INTEGER NOT NULL DEFAULT 0,
    "chars" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HrAllyUsage_pkey" PRIMARY KEY ("staffId","day")
);

-- CreateTable
CREATE TABLE "HrRecord" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "HrSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrDepartment_name_key" ON "HrDepartment"("name");

-- CreateIndex
CREATE INDEX "HrAttendance_day_idx" ON "HrAttendance"("day");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendance_staffId_day_key" ON "HrAttendance"("staffId", "day");

-- CreateIndex
CREATE INDEX "HrBreak_staffId_startAt_idx" ON "HrBreak"("staffId", "startAt");

-- CreateIndex
CREATE INDEX "HrLeave_staffId_fromDay_idx" ON "HrLeave"("staffId", "fromDay");

-- CreateIndex
CREATE INDEX "HrLeave_status_idx" ON "HrLeave"("status");

-- CreateIndex
CREATE INDEX "HrCorrection_status_idx" ON "HrCorrection"("status");

-- CreateIndex
CREATE INDEX "HrClaim_staffId_idx" ON "HrClaim"("staffId");

-- CreateIndex
CREATE INDEX "HrClaim_status_idx" ON "HrClaim"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HrHoliday_day_key" ON "HrHoliday"("day");

-- CreateIndex
CREATE INDEX "HrTask_assigneeId_status_idx" ON "HrTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "HrTask_projectId_idx" ON "HrTask"("projectId");

-- CreateIndex
CREATE INDEX "HrPayslip_month_idx" ON "HrPayslip"("month");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayslip_staffId_month_key" ON "HrPayslip"("staffId", "month");

-- CreateIndex
CREATE INDEX "HrCandidate_stage_idx" ON "HrCandidate"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "HrTicket_code_key" ON "HrTicket"("code");

-- CreateIndex
CREATE INDEX "HrTicket_staffId_idx" ON "HrTicket"("staffId");

-- CreateIndex
CREATE INDEX "HrMeeting_at_idx" ON "HrMeeting"("at");

-- CreateIndex
CREATE INDEX "HrRecognition_toId_idx" ON "HrRecognition"("toId");

-- CreateIndex
CREATE INDEX "HrNotification_staffId_readAt_idx" ON "HrNotification"("staffId", "readAt");

-- CreateIndex
CREATE INDEX "HrRecord_kind_createdAt_idx" ON "HrRecord"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "HrProfile" ADD CONSTRAINT "HrProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTask" ADD CONSTRAINT "HrTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "HrProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCandidate" ADD CONSTRAINT "HrCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HrJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same rule as every other table: row level security on, so a hosted Postgres data API can't read these.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'Hr%' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
