-- Medoro 2.0 central medicine catalogue. Forward-only: one nullable column on "Medicine" and new tables. Nothing existing is rewritten.
ALTER TABLE "Medicine" ADD COLUMN "catalogueGid" TEXT;
CREATE INDEX "Medicine_tenantId_catalogueGid_idx" ON "Medicine"("tenantId", "catalogueGid");

CREATE SEQUENCE "catalogue_gid_seq" START 1;

CREATE TABLE "CatalogueMedicine" (
    "id" TEXT NOT NULL, "gid" TEXT NOT NULL, "brand" TEXT NOT NULL, "generic" TEXT NOT NULL, "composition" TEXT NOT NULL DEFAULT '', "saltKey" TEXT,
    "strength" TEXT NOT NULL, "form" TEXT NOT NULL, "manufacturer" TEXT NOT NULL, "packSize" INTEGER NOT NULL DEFAULT 1, "packLabel" TEXT NOT NULL DEFAULT '',
    "hsn" TEXT NOT NULL, "gstRate" INTEGER NOT NULL, "schedule" TEXT NOT NULL DEFAULT '', "dedupeKey" TEXT NOT NULL, "status" TEXT NOT NULL,
    "source" TEXT NOT NULL, "sourceRef" TEXT, "verifiedOn" DATE, "verifiedBy" TEXT, "supersededByGid" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogueMedicine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogueMedicine_gid_key" ON "CatalogueMedicine"("gid");
CREATE INDEX "CatalogueMedicine_saltKey_idx" ON "CatalogueMedicine"("saltKey");
CREATE INDEX "CatalogueMedicine_dedupeKey_idx" ON "CatalogueMedicine"("dedupeKey");
-- Two live entries can't describe the same product: brand, salt, strength, form, manufacturer and pack size. Deprecated entries are exempt.
CREATE UNIQUE INDEX "CatalogueMedicine_live_dedupeKey_key" ON "CatalogueMedicine"("dedupeKey") WHERE "status" <> 'deprecated';

CREATE TABLE "CatalogueBarcode" (
    "id" TEXT NOT NULL, "medicineId" TEXT NOT NULL, "barcode" TEXT NOT NULL, "verified" BOOLEAN NOT NULL DEFAULT false, "source" TEXT NOT NULL,
    "verifiedOn" DATE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogueBarcode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogueBarcode_barcode_key" ON "CatalogueBarcode"("barcode");
ALTER TABLE "CatalogueBarcode" ADD CONSTRAINT "CatalogueBarcode_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "CatalogueMedicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CatalogueChange" (
    "seq" BIGSERIAL NOT NULL, "gid" TEXT NOT NULL, "action" TEXT NOT NULL, "version" INTEGER NOT NULL, "data" JSONB NOT NULL, "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogueChange_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX "CatalogueChange_gid_idx" ON "CatalogueChange"("gid");

CREATE TABLE "CatalogueCorrection" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "gid" TEXT NOT NULL, "field" TEXT NOT NULL, "proposed" TEXT NOT NULL, "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open', "createdBy" TEXT NOT NULL, "createdByName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT, "resolvedAt" TIMESTAMP(3), "resolutionNote" TEXT,
    CONSTRAINT "CatalogueCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogueCorrection_tenantId_status_idx" ON "CatalogueCorrection"("tenantId", "status");
CREATE INDEX "CatalogueCorrection_status_createdAt_idx" ON "CatalogueCorrection"("status", "createdAt");

ALTER TABLE "CatalogueMedicine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogueBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogueChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogueCorrection" ENABLE ROW LEVEL SECURITY;
-- The change log is the catalogue's history: never edited or deleted.
CREATE TRIGGER catalogue_change_append_only BEFORE UPDATE OR DELETE ON "CatalogueChange" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
