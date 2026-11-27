-- Enterprise HRMS Phase 3: per-person access, approvals with steps, delegation, two-step sign-in set-up. New tables and one nullable column only.
-- AlterTable
ALTER TABLE "HrProfile" ADD COLUMN     "totpPending" TEXT;

-- CreateTable
CREATE TABLE "HrAccessGrant" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "HrAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "HrApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "approverId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "HrApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDelegation" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "HrDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrAccessGrant_staffId_revokedAt_idx" ON "HrAccessGrant"("staffId", "revokedAt");

-- CreateIndex
CREATE INDEX "HrApproval_status_kind_idx" ON "HrApproval"("status", "kind");

-- CreateIndex
CREATE INDEX "HrApproval_requesterId_createdAt_idx" ON "HrApproval"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "HrApproval_subjectId_idx" ON "HrApproval"("subjectId");

-- CreateIndex
CREATE INDEX "HrApprovalStep_status_approverId_idx" ON "HrApprovalStep"("status", "approverId");

-- CreateIndex
CREATE INDEX "HrApprovalStep_status_dueAt_idx" ON "HrApprovalStep"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrApprovalStep_approvalId_seq_key" ON "HrApprovalStep"("approvalId", "seq");

-- CreateIndex
CREATE INDEX "HrDelegation_fromId_toDay_idx" ON "HrDelegation"("fromId", "toDay");

-- CreateIndex
CREATE INDEX "HrDelegation_toId_toDay_idx" ON "HrDelegation"("toId", "toDay");

-- AddForeignKey
ALTER TABLE "HrAccessGrant" ADD CONSTRAINT "HrAccessGrant_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrApprovalStep" ADD CONSTRAINT "HrApprovalStep_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "HrApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Access changes and decisions are history: the grant row itself is only ever revoked (revokedAt), never edited
-- otherwise, so updates are allowed but deletes are not.
CREATE OR REPLACE FUNCTION medoro_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % keeps history (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_access_grant_no_delete BEFORE DELETE ON "HrAccessGrant" FOR EACH ROW EXECUTE FUNCTION medoro_block_delete();
CREATE TRIGGER hr_approval_no_delete BEFORE DELETE ON "HrApproval" FOR EACH ROW EXECUTE FUNCTION medoro_block_delete();

ALTER TABLE "HrAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrApprovalStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrDelegation" ENABLE ROW LEVEL SECURITY;
