-- HRMS Sales Training Academy: programme content, batches, assignments, progress evidence, attempts, practicals and certificates.
-- CreateTable
CREATE TABLE "TrProgramme" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'published',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrSession" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'session',
    "moduleSlug" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TrSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrModule" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'sales',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'published',

    CONSTRAINT "TrModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrLesson" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "durationMin" INTEGER NOT NULL DEFAULT 10,
    "videoKind" TEXT NOT NULL DEFAULT 'none',
    "videoRef" TEXT NOT NULL DEFAULT '',
    "videoSeconds" INTEGER NOT NULL DEFAULT 0,
    "completionPct" INTEGER NOT NULL DEFAULT 90,
    "slides" JSONB NOT NULL DEFAULT '[]',
    "transcript" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL DEFAULT '{}',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrLessonVersion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrLessonVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrQuestion" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lessonId" TEXT,
    "area" TEXT NOT NULL DEFAULT 'product',
    "order" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "answer" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'published',

    CONSTRAINT "TrQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrScenario" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '',
    "situation" TEXT NOT NULL DEFAULT '',
    "script" JSONB NOT NULL DEFAULT '[]',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'published',

    CONSTRAINT "TrScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrBatch" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainingDate" DATE NOT NULL,
    "trainerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrAssignment" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "attendance" TEXT NOT NULL DEFAULT '',
    "attendanceById" TEXT NOT NULL DEFAULT '',
    "attendanceAt" TIMESTAMP(3),
    "extraAttempts" INTEGER NOT NULL DEFAULT 0,
    "trainerFeedback" TEXT NOT NULL DEFAULT '',
    "trainerDecision" TEXT NOT NULL DEFAULT '',
    "trainerById" TEXT NOT NULL DEFAULT '',
    "trainerAt" TIMESTAMP(3),
    "hrDecision" TEXT NOT NULL DEFAULT '',
    "hrById" TEXT NOT NULL DEFAULT '',
    "hrAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrProgress" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "segs" TEXT NOT NULL DEFAULT '',
    "slideSecs" JSONB NOT NULL DEFAULT '[]',
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "lastPos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastBeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TrProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrAttempt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lessonId" TEXT,
    "attemptNo" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "pct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "areas" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrPractical" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scenarioId" TEXT,
    "attemptNo" INTEGER NOT NULL,
    "submission" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatorId" TEXT NOT NULL DEFAULT '',
    "rubric" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "maxScore" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN,
    "feedback" TEXT NOT NULL DEFAULT '',
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "TrPractical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrCertificate" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "certNo" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "programmeTitle" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "trainerName" TEXT NOT NULL,
    "completedOn" DATE NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TrCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrProgramme_slug_key" ON "TrProgramme"("slug");

-- CreateIndex
CREATE INDEX "TrSession_programmeId_order_idx" ON "TrSession"("programmeId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TrModule_programmeId_slug_key" ON "TrModule"("programmeId", "slug");

-- CreateIndex
CREATE INDEX "TrLesson_programmeId_idx" ON "TrLesson"("programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrLesson_moduleId_slug_key" ON "TrLesson"("moduleId", "slug");

-- CreateIndex
CREATE INDEX "TrLessonVersion_lessonId_version_idx" ON "TrLessonVersion"("lessonId", "version");

-- CreateIndex
CREATE INDEX "TrQuestion_programmeId_scope_idx" ON "TrQuestion"("programmeId", "scope");

-- CreateIndex
CREATE INDEX "TrQuestion_lessonId_idx" ON "TrQuestion"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "TrScenario_programmeId_slug_key" ON "TrScenario"("programmeId", "slug");

-- CreateIndex
CREATE INDEX "TrBatch_trainerId_idx" ON "TrBatch"("trainerId");

-- CreateIndex
CREATE INDEX "TrAssignment_batchId_idx" ON "TrAssignment"("batchId");

-- CreateIndex
CREATE INDEX "TrAssignment_staffId_idx" ON "TrAssignment"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "TrAssignment_programmeId_staffId_key" ON "TrAssignment"("programmeId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "TrProgress_assignmentId_lessonId_key" ON "TrProgress"("assignmentId", "lessonId");

-- CreateIndex
CREATE INDEX "TrAttempt_assignmentId_kind_idx" ON "TrAttempt"("assignmentId", "kind");

-- CreateIndex
CREATE INDEX "TrPractical_assignmentId_kind_idx" ON "TrPractical"("assignmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TrCertificate_assignmentId_key" ON "TrCertificate"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrCertificate_certNo_key" ON "TrCertificate"("certNo");

-- CreateIndex
CREATE UNIQUE INDEX "TrCertificate_verifyCode_key" ON "TrCertificate"("verifyCode");

-- CreateIndex
CREATE INDEX "TrCertificate_staffId_idx" ON "TrCertificate"("staffId");


-- HR gets the new Sales Academy module where Roles & Permissions were already saved (new installs get it from the defaults).
UPDATE "HrSetting" SET "value" = jsonb_set("value", '{hr}', ("value"->'hr') || '["training"]'::jsonb)
WHERE "key" = 'perms' AND jsonb_typeof("value"->'hr') = 'array' AND NOT ("value"->'hr') ? 'training';

-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."TrProgramme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrLesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrLessonVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrScenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrPractical" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrCertificate" ENABLE ROW LEVEL SECURITY;
