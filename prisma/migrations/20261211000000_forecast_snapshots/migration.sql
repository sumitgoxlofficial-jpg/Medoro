-- Medoro 2.0 forecast accuracy tracking. Forward-only: one new table.
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "generatedOn" DATE NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "predicted" DOUBLE PRECISION NOT NULL,
    "lo" DOUBLE PRECISION NOT NULL,
    "hi" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ForecastSnapshot_branchId_medicineId_generatedOn_horizonDays_key" ON "ForecastSnapshot"("branchId", "medicineId", "generatedOn", "horizonDays");
CREATE INDEX "ForecastSnapshot_tenantId_branchId_generatedOn_idx" ON "ForecastSnapshot"("tenantId", "branchId", "generatedOn");
ALTER TABLE "ForecastSnapshot" ENABLE ROW LEVEL SECURITY;
-- A forecast is never edited after the fact: that would defeat measuring how good it was.
CREATE TRIGGER forecast_snapshot_append_only BEFORE UPDATE OR DELETE ON "ForecastSnapshot" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
