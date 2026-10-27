-- CreateTable
CREATE TABLE "RestoreRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "appliedBy" TEXT,
    "safetyBackupId" TEXT,
    "error" TEXT,

    CONSTRAINT "RestoreRun_pkey" PRIMARY KEY ("id")
);

-- Full restores replace a pharmacy's rows, which the append-only triggers normally block.
-- Only the restore transaction sets medoro.restore = 'on' (SET LOCAL, so it ends with the transaction).
CREATE OR REPLACE FUNCTION medoro_block_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('medoro.restore', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION medoro_sale_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medoro.restore', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'SaleItem is append-only (DELETE blocked)';
  END IF;
  IF (NEW."saleId", NEW."batchId", NEW."medicineId", NEW.qty, NEW."mrpPaise", NEW."discountPaise",
      NEW."taxablePaise", NEW."gstRate", NEW."costPaise")
     IS DISTINCT FROM
     (OLD."saleId", OLD."batchId", OLD."medicineId", OLD.qty, OLD."mrpPaise", OLD."discountPaise",
      OLD."taxablePaise", OLD."gstRate", OLD."costPaise")
     OR NEW."returnedQty" < OLD."returnedQty" OR NEW."returnedQty" > NEW.qty THEN
    RAISE EXCEPTION 'SaleItem: only returnedQty may increase, up to qty';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
