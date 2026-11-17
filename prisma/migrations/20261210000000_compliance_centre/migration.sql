-- Medoro 2.0 compliance centre. Forward-only: four new tables, nothing existing is altered.
CREATE TABLE "ComplianceItem" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT, "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
    "number" TEXT, "holder" TEXT, "authority" TEXT, "issuedOn" DATE, "expiresOn" DATE, "notes" TEXT,
    "remindDays" INTEGER[], "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplianceItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComplianceItem_tenantId_branchId_idx" ON "ComplianceItem"("tenantId", "branchId");

CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "itemId" TEXT, "inspectionId" TEXT, "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL, "storagePath" TEXT NOT NULL, "mime" TEXT NOT NULL, "sha256" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComplianceDocument_tenantId_itemId_idx" ON "ComplianceDocument"("tenantId", "itemId");
CREATE INDEX "ComplianceDocument_tenantId_inspectionId_idx" ON "ComplianceDocument"("tenantId", "inspectionId");

CREATE TABLE "ComplianceInspection" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "inspectedOn" DATE NOT NULL, "authority" TEXT NOT NULL,
    "inspector" TEXT, "outcome" TEXT NOT NULL, "findings" TEXT NOT NULL, "actionDue" DATE, "actionsClosedOn" DATE, "closingNote" TEXT,
    "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplianceInspection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComplianceInspection_tenantId_branchId_inspectedOn_idx" ON "ComplianceInspection"("tenantId", "branchId", "inspectedOn");

CREATE TABLE "ComplianceReminder" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "threshold" INTEGER NOT NULL, "forExpiry" DATE NOT NULL,
    "outcome" TEXT NOT NULL, "detail" TEXT, "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplianceReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplianceReminder_itemId_threshold_forExpiry_key" ON "ComplianceReminder"("itemId", "threshold", "forExpiry");

ALTER TABLE "ComplianceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceInspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceReminder" ENABLE ROW LEVEL SECURITY;
-- Reminder history and uploaded-document records are never edited or deleted.
CREATE TRIGGER compliance_reminder_append_only BEFORE UPDATE OR DELETE ON "ComplianceReminder" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER compliance_document_append_only BEFORE UPDATE OR DELETE ON "ComplianceDocument" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
