-- CreateEnum
CREATE TYPE "GrowthRole" AS ENUM ('manager', 'sales', 'analyst');

-- CreateEnum
CREATE TYPE "LeadVerification" AS ENUM ('UNVERIFIED', 'BUSINESS_VERIFIED', 'PHONE_VERIFIED', 'EMAIL_VERIFIED', 'WEBSITE_VERIFIED', 'PARTIALLY_VERIFIED', 'INVALID', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW_LEAD', 'RESEARCH_PENDING', 'QUALIFIED', 'ASSIGNED', 'CONTACT_PERMISSION_PENDING', 'CONTACT_AUTHORIZED', 'FIRST_CONTACT', 'INTERESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'TRIAL_STARTED', 'NEGOTIATION', 'CONVERTED', 'LOST', 'FOLLOW_UP_LATER', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "LeadCategory" AS ENUM ('RETAIL', 'INDEPENDENT', 'CHAIN', 'HOSPITAL', 'MEDICINE_RETAILER', 'OTHER');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('NOT_CALLED', 'NO_ANSWER', 'BUSY', 'CONNECTED', 'INTERESTED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'FOLLOW_UP_REQUIRED', 'DEMO_SCHEDULED', 'CONVERTED', 'DO_NOT_CONTACT');

-- CreateTable
CREATE TABLE "GrowthTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GrowthTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthMember" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "role" "GrowthRole" NOT NULL,
    "teamId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTerritory" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT NOT NULL DEFAULT '',
    "pin" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTerritory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCallingTarget" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "setBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeCallingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDailyPerformance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "launches" INTEGER NOT NULL DEFAULT 0,
    "reported" INTEGER NOT NULL DEFAULT 0,
    "connected" INTEGER NOT NULL DEFAULT 0,
    "interested" INTEGER NOT NULL DEFAULT 0,
    "demos" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDailyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "licence" TEXT NOT NULL DEFAULT '',
    "attribution" TEXT NOT NULL DEFAULT '',
    "termsUrl" TEXT NOT NULL DEFAULT '',
    "allowsExport" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyLead" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "category" "LeadCategory" NOT NULL DEFAULT 'RETAIL',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ownerVerified" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "phoneRaw" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "district" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "pin" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "sourceId" TEXT,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification" "LeadVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "businessVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "websiteVerifiedAt" TIMESTAMP(3),
    "locationVerifiedAt" TIMESTAMP(3),
    "invalidReason" TEXT,
    "duplicateOfId" TEXT,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoredAt" TIMESTAMP(3),
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW_LEAD',
    "lostReason" TEXT,
    "softwareStatus" TEXT NOT NULL DEFAULT '',
    "assignedStaffId" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "pipelineLeadId" TEXT,
    "importJobId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "PharmacyLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyContact" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "phone" TEXT,
    "email" TEXT NOT NULL DEFAULT '',
    "provenance" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PharmacyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvidence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "byStaffId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadImportJob" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "possibleDuplicates" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "rows" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LeadImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeLeadKey" TEXT,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endReason" TEXT,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignmentHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStaffId" TEXT,
    "toStaffId" TEXT,
    "byStaffId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL DEFAULT '',
    "refId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "phone" TEXT NOT NULL,
    "launchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'launched',
    "reportedAt" TIMESTAMP(3),
    "outcome" "CallOutcome",
    "interestLevel" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "numberConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "softwareStatus" TEXT NOT NULL DEFAULT '',
    "demoRequested" BOOLEAN NOT NULL DEFAULT false,
    "followUpAt" TIMESTAMP(3),
    "reportKey" TEXT,
    "userAgent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "callId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDeal" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'm',
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoBooking" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'phone',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DemoBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'm',
    "amountPaise" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "callId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dailyCap" INTEGER NOT NULL DEFAULT 200,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageConversation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "unread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT,
    "staffId" TEXT,
    "campaignId" TEXT,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "lawfulBasis" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeNote" TEXT,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionRecord" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "leadId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedBy" TEXT,
    "liftNote" TEXT,

    CONSTRAINT "SuppressionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secrets" BYTEA,
    "lastError" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventOutbox" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthAuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT '',
    "entityId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "ip" TEXT,

    CONSTRAINT "GrowthAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "GrowthSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthTeam_name_key" ON "GrowthTeam"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthMember_staffId_key" ON "GrowthMember"("staffId");

-- CreateIndex
CREATE INDEX "EmployeeTerritory_state_district_pin_idx" ON "EmployeeTerritory"("state", "district", "pin");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTerritory_staffId_state_district_pin_key" ON "EmployeeTerritory"("staffId", "state", "district", "pin");

-- CreateIndex
CREATE INDEX "EmployeeCallingTarget_staffId_period_effectiveFrom_idx" ON "EmployeeCallingTarget"("staffId", "period", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDailyPerformance_staffId_day_key" ON "EmployeeDailyPerformance"("staffId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_key_key" ON "LeadSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyLead_code_key" ON "PharmacyLead"("code");

-- CreateIndex
CREATE INDEX "PharmacyLead_state_district_city_idx" ON "PharmacyLead"("state", "district", "city");

-- CreateIndex
CREATE INDEX "PharmacyLead_pin_idx" ON "PharmacyLead"("pin");

-- CreateIndex
CREATE INDEX "PharmacyLead_phone_idx" ON "PharmacyLead"("phone");

-- CreateIndex
CREATE INDEX "PharmacyLead_domain_idx" ON "PharmacyLead"("domain");

-- CreateIndex
CREATE INDEX "PharmacyLead_stage_idx" ON "PharmacyLead"("stage");

-- CreateIndex
CREATE INDEX "PharmacyLead_verification_idx" ON "PharmacyLead"("verification");

-- CreateIndex
CREATE INDEX "PharmacyLead_assignedStaffId_idx" ON "PharmacyLead"("assignedStaffId");

-- CreateIndex
CREATE INDEX "PharmacyLead_nextFollowUpAt_idx" ON "PharmacyLead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "PharmacyLead_createdAt_idx" ON "PharmacyLead"("createdAt");

-- CreateIndex
CREATE INDEX "PharmacyLead_sourceId_sourceRef_idx" ON "PharmacyLead"("sourceId", "sourceRef");

-- CreateIndex
CREATE INDEX "PharmacyContact_leadId_idx" ON "PharmacyContact"("leadId");

-- CreateIndex
CREATE INDEX "LeadEvidence_leadId_kind_at_idx" ON "LeadEvidence"("leadId", "kind", "at");

-- CreateIndex
CREATE INDEX "LeadScore_leadId_at_idx" ON "LeadScore"("leadId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LeadImportJob_code_key" ON "LeadImportJob"("code");

-- CreateIndex
CREATE INDEX "LeadDuplicateCandidate_status_idx" ON "LeadDuplicateCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDuplicateCandidate_leadId_matchId_key" ON "LeadDuplicateCandidate"("leadId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAssignment_activeLeadKey_key" ON "LeadAssignment"("activeLeadKey");

-- CreateIndex
CREATE INDEX "LeadAssignment_staffId_active_idx" ON "LeadAssignment"("staffId", "active");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignmentHistory_leadId_at_idx" ON "LeadAssignmentHistory"("leadId", "at");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_at_idx" ON "LeadNote"("leadId", "at");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_at_idx" ON "LeadActivity"("leadId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_reportKey_key" ON "CallSession"("reportKey");

-- CreateIndex
CREATE INDEX "CallSession_staffId_launchedAt_idx" ON "CallSession"("staffId", "launchedAt");

-- CreateIndex
CREATE INDEX "CallSession_leadId_launchedAt_idx" ON "CallSession"("leadId", "launchedAt");

-- CreateIndex
CREATE INDEX "CallSession_reportedAt_idx" ON "CallSession"("reportedAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_staffId_status_dueAt_idx" ON "FollowUpTask"("staffId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_leadId_status_idx" ON "FollowUpTask"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDeal_leadId_key" ON "SalesDeal"("leadId");

-- CreateIndex
CREATE INDEX "DemoBooking_staffId_at_idx" ON "DemoBooking"("staffId", "at");

-- CreateIndex
CREATE INDEX "DemoBooking_leadId_idx" ON "DemoBooking"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionRecord_leadId_key" ON "ConversionRecord"("leadId");

-- CreateIndex
CREATE INDEX "ConversionRecord_staffId_at_idx" ON "ConversionRecord"("staffId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_channel_name_language_key" ON "MessageTemplate"("channel", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCampaign_code_key" ON "SalesCampaign"("code");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_providerId_idx" ON "CampaignRecipient"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_leadId_key" ON "CampaignRecipient"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "MessageConversation_leadId_idx" ON "MessageConversation"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageConversation_channel_address_key" ON "MessageConversation"("channel", "address");

-- CreateIndex
CREATE INDEX "MessageEvent_conversationId_at_idx" ON "MessageEvent"("conversationId", "at");

-- CreateIndex
CREATE INDEX "MessageEvent_providerId_idx" ON "MessageEvent"("providerId");

-- CreateIndex
CREATE INDEX "ContactConsent_leadId_channel_purpose_idx" ON "ContactConsent"("leadId", "channel", "purpose");

-- CreateIndex
CREATE INDEX "SuppressionRecord_valueHash_idx" ON "SuppressionRecord"("valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_kind_key" ON "IntegrationConnection"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "EventOutbox_processedAt_createdAt_idx" ON "EventOutbox"("processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "GrowthMember" ADD CONSTRAINT "GrowthMember_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowthMember" ADD CONSTRAINT "GrowthMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "GrowthTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTerritory" ADD CONSTRAINT "EmployeeTerritory_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCallingTarget" ADD CONSTRAINT "EmployeeCallingTarget_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyLead" ADD CONSTRAINT "PharmacyLead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyContact" ADD CONSTRAINT "PharmacyContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvidence" ADD CONSTRAINT "LeadEvidence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "PharmacyLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SalesCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessageConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active primary assignment per lead, enforced by the database. ("activeLeadKey" @unique is the
-- Prisma-visible twin of this rule; the partial index below states it directly.)
CREATE UNIQUE INDEX "LeadAssignment_one_active_primary" ON "LeadAssignment"("leadId") WHERE "active" AND "primary";

-- Timeline, evidence, assignment history and the audit log are append-only.
CREATE TRIGGER lead_activity_append_only BEFORE UPDATE OR DELETE ON "LeadActivity"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER lead_evidence_append_only BEFORE UPDATE OR DELETE ON "LeadEvidence"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER lead_assignment_history_append_only BEFORE UPDATE OR DELETE ON "LeadAssignmentHistory"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER growth_audit_append_only BEFORE UPDATE OR DELETE ON "GrowthAuditLog"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Sources Medoro ships with. Each import can name its own source too.
INSERT INTO "LeadSource" ("id", "key", "name", "kind", "licence", "attribution", "termsUrl", "allowsExport", "updatedAt") VALUES
  (gen_random_uuid(), 'osm', 'OpenStreetMap (Overpass API)', 'open_data', 'ODbL 1.0', '© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright', true, now()),
  (gen_random_uuid(), 'upload', 'Uploaded business list', 'upload', '', '', '', true, now()),
  (gen_random_uuid(), 'manual', 'Added by Medoro staff', 'manual', '', '', '', true, now()),
  (gen_random_uuid(), 'submitted', 'Submitted by the pharmacy', 'submitted', '', '', '', true, now());

-- Like every Medoro table: row level security on, so a hosted data API (Supabase anon/authenticated) gets no rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GrowthTeam','GrowthMember','EmployeeTerritory','EmployeeCallingTarget','EmployeeDailyPerformance','LeadSource','PharmacyLead','PharmacyContact',
    'LeadEvidence','LeadScore','LeadImportJob','LeadDuplicateCandidate','LeadAssignment','LeadAssignmentHistory','LeadNote','LeadActivity','CallSession','FollowUpTask',
    'SalesDeal','DemoBooking','ConversionRecord','MessageTemplate','SalesCampaign','CampaignRecipient','MessageConversation','MessageEvent','ContactConsent',
    'SuppressionRecord','IntegrationConnection','BackgroundJob','EventOutbox','GrowthAuditLog','GrowthSetting'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
