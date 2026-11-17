-- Medoro 2.0 recall intelligence. Forward-only: new nullable columns on "Recall" and one new table. Existing rows are untouched.
ALTER TABLE "Recall" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "Recall" ADD COLUMN "noticeNo" TEXT;
ALTER TABLE "Recall" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Recall" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "Recall" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Recall" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Recall" ADD COLUMN "resolutionNote" TEXT;

CREATE TABLE "RecallDisposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recallId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "stockOutNo" TEXT,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecallDisposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecallDisposal_tenantId_recallId_idx" ON "RecallDisposal"("tenantId", "recallId");
ALTER TABLE "RecallDisposal" ENABLE ROW LEVEL SECURITY;
-- Disposal history is never edited or deleted.
CREATE TRIGGER recall_disposal_append_only BEFORE UPDATE OR DELETE ON "RecallDisposal"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
