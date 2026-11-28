-- Enterprise HRMS Phase 2: employment history. New table only; nothing existing changes.
CREATE TABLE "HrEmploymentEvent" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effective" DATE NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "byId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrEmploymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrEmploymentEvent_staffId_at_idx" ON "HrEmploymentEvent"("staffId", "at");
CREATE INDEX "HrEmploymentEvent_type_effective_idx" ON "HrEmploymentEvent"("type", "effective");
ALTER TABLE "HrEmploymentEvent" ADD CONSTRAINT "HrEmploymentEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History: never edited or deleted.
CREATE TRIGGER hr_employment_event_append_only BEFORE UPDATE OR DELETE ON "HrEmploymentEvent"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Not reachable through a hosted data API (same as every other table, see lock_data_api).
ALTER TABLE "HrEmploymentEvent" ENABLE ROW LEVEL SECURITY;
