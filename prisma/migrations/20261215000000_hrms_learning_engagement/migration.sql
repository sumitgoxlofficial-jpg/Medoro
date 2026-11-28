-- Enterprise HRMS Phase 7: courses for everyone, enrolments, quiz attempts, pulse surveys. New tables only.
-- CreateTable
CREATE TABLE "HrCourse" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "dept" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "dueDays" INTEGER NOT NULL DEFAULT 14,
    "passPct" INTEGER NOT NULL DEFAULT 70,
    "lessons" JSONB NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "HrCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCourseEnrolment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "assignedBy" TEXT,
    "dueOn" DATE NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lessonsRead" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "completedAt" TIMESTAMP(3),
    "reminded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCourseEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCourseAttempt" (
    "id" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCourseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSurvey" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT NOT NULL DEFAULT '',
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "dept" TEXT NOT NULL DEFAULT '',
    "questions" JSONB NOT NULL,
    "closesOn" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "respondentKey" TEXT NOT NULL,
    "staffId" TEXT,
    "dept" TEXT NOT NULL DEFAULT '',
    "answers" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrCourseEnrolment_staffId_completedAt_idx" ON "HrCourseEnrolment"("staffId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrCourseEnrolment_courseId_staffId_key" ON "HrCourseEnrolment"("courseId", "staffId");

-- CreateIndex
CREATE INDEX "HrCourseAttempt_enrolmentId_idx" ON "HrCourseAttempt"("enrolmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HrSurveyResponse_surveyId_respondentKey_key" ON "HrSurveyResponse"("surveyId", "respondentKey");

-- AddForeignKey
ALTER TABLE "HrCourseEnrolment" ADD CONSTRAINT "HrCourseEnrolment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "HrCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCourseEnrolment" ADD CONSTRAINT "HrCourseEnrolment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCourseAttempt" ADD CONSTRAINT "HrCourseAttempt_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "HrCourseEnrolment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSurveyResponse" ADD CONSTRAINT "HrSurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "HrSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER hr_course_attempt_append_only BEFORE UPDATE OR DELETE ON "HrCourseAttempt" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER hr_survey_response_append_only BEFORE UPDATE OR DELETE ON "HrSurveyResponse" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
ALTER TABLE "HrCourse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrCourseEnrolment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrCourseAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrSurvey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrSurveyResponse" ENABLE ROW LEVEL SECURITY;
