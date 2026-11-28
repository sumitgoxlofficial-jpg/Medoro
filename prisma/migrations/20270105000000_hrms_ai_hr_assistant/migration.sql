-- AI HR Assistant: calls, transcripts, outcomes, HR actions, consent, knowledge, scenarios, evaluations. New tables only.
-- CreateTable
CREATE TABLE "AiHrCall" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "channel" TEXT NOT NULL DEFAULT 'browser',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "context" JSONB NOT NULL DEFAULT '{}',
    "state" JSONB NOT NULL DEFAULT '{}',
    "suppressReason" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiHrCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrCallAttempt" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrCallAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrTurn" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "who" TEXT NOT NULL,
    "textSealed" BYTEA NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'hinglish',
    "intent" TEXT NOT NULL DEFAULT '',
    "sttMs" INTEGER,
    "llmMs" INTEGER,
    "ttsMs" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrCallResponse" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "reasonCategory" TEXT NOT NULL DEFAULT '',
    "employeeResponse" TEXT NOT NULL DEFAULT '',
    "expectedArrival" TEXT NOT NULL DEFAULT '',
    "leaveRequestIntent" BOOLEAN NOT NULL DEFAULT false,
    "overtimeResponse" TEXT NOT NULL DEFAULT '',
    "callbackRequested" BOOLEAN NOT NULL DEFAULT false,
    "callbackTime" TEXT NOT NULL DEFAULT '',
    "humanEscalationRequired" BOOLEAN NOT NULL DEFAULT false,
    "employeeRequestedStop" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "said" JSONB NOT NULL DEFAULT '[]',
    "inferred" JSONB NOT NULL DEFAULT '{}',
    "recommended" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrCallResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrAction" (
    "id" TEXT NOT NULL,
    "callId" TEXT,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrConsent" (
    "staffId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'allowed',
    "source" TEXT NOT NULL DEFAULT 'employee',
    "reason" TEXT NOT NULL DEFAULT '',
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrConsent_pkey" PRIMARY KEY ("staffId")
);

-- CreateTable
CREATE TABLE "AiHrKnowledgeDoc" (
    "id" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveFrom" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiHrKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrScenario" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "utterance" TEXT NOT NULL,
    "callReason" TEXT NOT NULL,
    "expect" JSONB NOT NULL DEFAULT '{}',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrEvalRun" (
    "id" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "split" TEXT NOT NULL DEFAULT 'all',
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "failures" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiHrEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHrWebhookEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "callId" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHrWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiHrCall_eventKey_key" ON "AiHrCall"("eventKey");

-- CreateIndex
CREATE INDEX "AiHrCall_status_nextAttemptAt_idx" ON "AiHrCall"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiHrCall_staffId_createdAt_idx" ON "AiHrCall"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "AiHrCall_reason_day_idx" ON "AiHrCall"("reason", "day");

-- CreateIndex
CREATE INDEX "AiHrCallAttempt_callId_idx" ON "AiHrCallAttempt"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "AiHrTurn_callId_seq_key" ON "AiHrTurn"("callId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AiHrCallResponse_callId_key" ON "AiHrCallResponse"("callId");

-- CreateIndex
CREATE INDEX "AiHrAction_status_createdAt_idx" ON "AiHrAction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiHrAction_staffId_idx" ON "AiHrAction"("staffId");

-- CreateIndex
CREATE INDEX "AiHrKnowledgeDoc_status_scope_idx" ON "AiHrKnowledgeDoc"("status", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AiHrKnowledgeDoc_docKey_version_key" ON "AiHrKnowledgeDoc"("docKey", "version");

-- AddForeignKey
ALTER TABLE "AiHrCall" ADD CONSTRAINT "AiHrCall_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHrCallAttempt" ADD CONSTRAINT "AiHrCallAttempt_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AiHrCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHrTurn" ADD CONSTRAINT "AiHrTurn_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AiHrCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHrCallResponse" ADD CONSTRAINT "AiHrCallResponse_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AiHrCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHrAction" ADD CONSTRAINT "AiHrAction_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AiHrCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHrConsent" ADD CONSTRAINT "AiHrConsent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- History that must not disappear: attempts, HR actions, evaluation runs.
CREATE TRIGGER ai_hr_attempt_no_delete BEFORE DELETE ON "AiHrCallAttempt" FOR EACH ROW EXECUTE FUNCTION medoro_block_delete();
CREATE TRIGGER ai_hr_action_no_delete BEFORE DELETE ON "AiHrAction" FOR EACH ROW EXECUTE FUNCTION medoro_block_delete();
ALTER TABLE "AiHrCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrCallAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrTurn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrCallResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrKnowledgeDoc" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrScenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrEvalRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHrWebhookEvent" ENABLE ROW LEVEL SECURITY;
