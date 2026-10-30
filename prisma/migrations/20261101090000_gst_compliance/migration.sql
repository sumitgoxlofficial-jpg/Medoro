-- AlterTable
-- B2B customers: GSTIN, place of supply and billing address for tax invoices, GSTR-1 and e-invoices.
ALTER TABLE "Customer" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "pincode" TEXT;

-- AlterTable
-- Inter-state sales book IGST. Existing sales were all intra-state, so the defaults describe them.
ALTER TABLE "Sale" ADD COLUMN     "igstPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "customerGstin" TEXT;

-- CreateTable
CREATE TABLE "EInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDt" TEXT,
    "signedQr" TEXT,
    "signedInv" TEXT,
    "ewbNo" TEXT,
    "ewbDate" TEXT,
    "ewbValid" TEXT,
    "request" JSONB NOT NULL,
    "response" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EInvoice_tenantId_docType_docId_idx" ON "EInvoice"("tenantId", "docType", "docId");

-- IRP results are statutory records: never edited or deleted. Cancellations are new rows.
CREATE TRIGGER einvoice_append_only BEFORE UPDATE OR DELETE ON "EInvoice"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "EInvoice" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "EInvoice" FROM %I', r.rolname);
  END LOOP;
END $$;
