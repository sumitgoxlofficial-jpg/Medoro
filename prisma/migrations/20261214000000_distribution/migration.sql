-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "product" TEXT NOT NULL DEFAULT 'pharmacy';

-- CreateTable
CREATE TABLE "DistCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "gstin" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPrincipal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT,
    "agreementNo" TEXT,
    "divisions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" DATE,
    "endDate" DATE,
    "marginPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "claimBeforeDays" INTEGER NOT NULL DEFAULT 90,
    "claimAfterDays" INTEGER NOT NULL DEFAULT 180,
    "claimCreditPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistPrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistProduct" (
    "medicineId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT,
    "principalId" TEXT,
    "division" TEXT,
    "ptrPaise" BIGINT NOT NULL,
    "ptsPaise" BIGINT NOT NULL DEFAULT 0,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "portalVisible" BOOLEAN NOT NULL DEFAULT true,
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistProduct_pkey" PRIMARY KEY ("medicineId")
);

-- CreateTable
CREATE TABLE "DistSpecialRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "ratePaise" BIGINT NOT NULL,
    "validTo" DATE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistSpecialRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistScheme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "medicineId" TEXT,
    "companyId" TEXT,
    "buyQty" INTEGER NOT NULL DEFAULT 0,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "discPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "customerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "portal" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistTerritory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DistTerritory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistSalesman" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "territoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthlyTargetPaise" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistSalesman_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistChemist" (
    "customerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerName" TEXT,
    "dl20b" TEXT,
    "dl21b" TEXT,
    "dlExpiry" DATE,
    "creditDays" INTEGER NOT NULL DEFAULT 21,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "territoryId" TEXT,
    "salesmanId" TEXT,
    "priceTier" TEXT NOT NULL DEFAULT 'ptr',
    "status" TEXT NOT NULL DEFAULT 'active',
    "statusNote" TEXT,
    "kycVerifiedAt" TIMESTAMP(3),
    "kycVerifiedBy" TEXT,
    "portalAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistChemist_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "DistRack" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "coldChain" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DistRack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "salesmanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "placedByType" TEXT NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "estimatePaise" BIGINT NOT NULL DEFAULT 0,
    "creditCheck" JSONB,
    "overrideBy" TEXT,
    "overrideReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "invoiceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DistOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "ratePaise" BIGINT NOT NULL,
    "discPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "schemeId" TEXT,

    CONSTRAINT "DistOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPickList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pickerId" TEXT,
    "boxes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "packedBy" TEXT,

    CONSTRAINT "DistPickList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPickLine" (
    "id" TEXT NOT NULL,
    "pickListId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rack" TEXT,
    "units" INTEGER NOT NULL,
    "paidUnits" INTEGER NOT NULL,
    "pickedUnits" INTEGER,
    "pickedAt" TIMESTAMP(3),
    "pickedBy" TEXT,

    CONSTRAINT "DistPickLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT NOT NULL,
    "salesmanId" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "placeOfSupply" TEXT,
    "customerGstin" TEXT,
    "igst" BOOLEAN NOT NULL DEFAULT false,
    "grossPaise" BIGINT NOT NULL,
    "discPaise" BIGINT NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL,
    "sgstPaise" BIGINT NOT NULL,
    "igstPaise" BIGINT NOT NULL,
    "roundOffPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "costPaise" BIGINT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "ratePaise" BIGINT NOT NULL,
    "mrpPaise" BIGINT NOT NULL,
    "discPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discPaise" BIGINT NOT NULL,
    "schemeId" TEXT,
    "taxablePaise" BIGINT NOT NULL,
    "gstRate" INTEGER NOT NULL,
    "taxPaise" BIGINT NOT NULL,
    "costPaise" BIGINT NOT NULL,

    CONSTRAINT "DistInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistInvoiceCancel" (
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistInvoiceCancel_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateTable
CREATE TABLE "DistReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "taxPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "creditPct" DECIMAL(5,2) NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "taxPaise" BIGINT NOT NULL,

    CONSTRAINT "DistReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistDispatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "vehicleNo" TEXT,
    "driverName" TEXT,
    "deliveryUser" TEXT,
    "route" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DistDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "dispatchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "receiverName" TEXT,
    "podNote" TEXT,
    "failReason" TEXT,
    "collectedPaise" BIGINT NOT NULL DEFAULT 0,
    "collectMode" TEXT,
    "receiptNo" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistCollection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "mode" TEXT NOT NULL,
    "ref" TEXT,
    "salesmanId" TEXT,
    "deliveryId" TEXT,
    "byUser" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistChemistAccount" (
    "id" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "gstin" TEXT,
    "dl20b" TEXT NOT NULL,
    "dl21b" TEXT NOT NULL,
    "dlExpiry" DATE NOT NULL,
    "address" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistChemistAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistPortalSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DistPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "shareKyc" BOOLEAN NOT NULL DEFAULT true,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "DistConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DistCompany_tenantId_name_key" ON "DistCompany"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DistPrincipal_tenantId_companyId_key" ON "DistPrincipal"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "DistProduct_tenantId_companyId_idx" ON "DistProduct"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DistSpecialRate_tenantId_customerId_medicineId_key" ON "DistSpecialRate"("tenantId", "customerId", "medicineId");

-- CreateIndex
CREATE INDEX "DistScheme_tenantId_medicineId_idx" ON "DistScheme"("tenantId", "medicineId");

-- CreateIndex
CREATE UNIQUE INDEX "DistScheme_tenantId_code_key" ON "DistScheme"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DistTerritory_tenantId_code_key" ON "DistTerritory"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DistSalesman_tenantId_code_key" ON "DistSalesman"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DistSalesman_tenantId_userId_key" ON "DistSalesman"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "DistChemist_tenantId_territoryId_idx" ON "DistChemist"("tenantId", "territoryId");

-- CreateIndex
CREATE INDEX "DistChemist_tenantId_salesmanId_idx" ON "DistChemist"("tenantId", "salesmanId");

-- CreateIndex
CREATE UNIQUE INDEX "DistRack_branchId_code_key" ON "DistRack"("branchId", "code");

-- CreateIndex
CREATE INDEX "DistOrder_tenantId_status_idx" ON "DistOrder"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DistOrder_tenantId_customerId_idx" ON "DistOrder"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DistOrder_tenantId_no_key" ON "DistOrder"("tenantId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "DistOrder_tenantId_idempotencyKey_key" ON "DistOrder"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DistPickList_orderId_key" ON "DistPickList"("orderId");

-- CreateIndex
CREATE INDEX "DistPickList_tenantId_status_idx" ON "DistPickList"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DistPickList_tenantId_no_key" ON "DistPickList"("tenantId", "no");

-- CreateIndex
CREATE INDEX "DistInvoice_tenantId_customerId_date_idx" ON "DistInvoice"("tenantId", "customerId", "date");

-- CreateIndex
CREATE INDEX "DistInvoice_tenantId_date_idx" ON "DistInvoice"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DistInvoice_tenantId_no_key" ON "DistInvoice"("tenantId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "DistInvoice_tenantId_idempotencyKey_key" ON "DistInvoice"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DistReturn_tenantId_invoiceId_idx" ON "DistReturn"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "DistReturn_tenantId_no_key" ON "DistReturn"("tenantId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "DistDispatch_tenantId_no_key" ON "DistDispatch"("tenantId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "DistDelivery_invoiceId_key" ON "DistDelivery"("invoiceId");

-- CreateIndex
CREATE INDEX "DistDelivery_tenantId_status_idx" ON "DistDelivery"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DistDelivery_dispatchId_idx" ON "DistDelivery"("dispatchId");

-- CreateIndex
CREATE INDEX "DistCollection_tenantId_customerId_idx" ON "DistCollection"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DistChemistAccount_email_key" ON "DistChemistAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DistChemistAccount_phone_key" ON "DistChemistAccount"("phone");

-- CreateIndex
CREATE INDEX "DistPortalSession_accountId_idx" ON "DistPortalSession"("accountId");

-- CreateIndex
CREATE INDEX "DistConnection_accountId_idx" ON "DistConnection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "DistConnection_tenantId_accountId_key" ON "DistConnection"("tenantId", "accountId");

-- AddForeignKey
ALTER TABLE "DistOrderLine" ADD CONSTRAINT "DistOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistPickLine" ADD CONSTRAINT "DistPickLine_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "DistPickList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistInvoiceLine" ADD CONSTRAINT "DistInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "DistInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistReturnLine" ADD CONSTRAINT "DistReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "DistReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ForecastSnapshot_branchId_medicineId_generatedOn_horizonDays_ke" RENAME TO "ForecastSnapshot_branchId_medicineId_generatedOn_horizonDay_key";


-- ───────────── Distribution: immutable financial records ─────────────
-- Invoices, their lines, cancellations, credit notes and collections are never edited or deleted: corrections are
-- cancellations, credit notes and reversing vouchers (docs/distribution/ARCHITECTURE.md).
CREATE TRIGGER dist_invoice_append_only BEFORE UPDATE OR DELETE ON "DistInvoice" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER dist_invoice_line_append_only BEFORE UPDATE OR DELETE ON "DistInvoiceLine" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER dist_invoice_cancel_append_only BEFORE UPDATE OR DELETE ON "DistInvoiceCancel" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER dist_return_append_only BEFORE UPDATE OR DELETE ON "DistReturn" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER dist_return_line_append_only BEFORE UPDATE OR DELETE ON "DistReturnLine" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER dist_collection_append_only BEFORE UPDATE OR DELETE ON "DistCollection" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Business-rule checks the application also enforces.
ALTER TABLE "DistInvoiceLine" ADD CONSTRAINT dist_invoice_line_qty CHECK (qty >= 0 AND "freeQty" >= 0 AND qty + "freeQty" > 0 AND "ratePaise" >= 0 AND "taxablePaise" >= 0 AND "taxPaise" >= 0);
ALTER TABLE "DistOrderLine" ADD CONSTRAINT dist_order_line_qty CHECK (qty > 0 AND "freeQty" >= 0 AND "ratePaise" >= 0);
ALTER TABLE "DistPickLine" ADD CONSTRAINT dist_pick_line_units CHECK (units > 0 AND "paidUnits" >= 0 AND "paidUnits" <= units);
ALTER TABLE "DistReturnLine" ADD CONSTRAINT dist_return_line_qty CHECK (qty > 0 AND "creditPct" >= 0 AND "creditPct" <= 100);
ALTER TABLE "DistProduct" ADD CONSTRAINT dist_product_prices CHECK ("ptrPaise" >= 0 AND "ptsPaise" >= 0);
ALTER TABLE "DistScheme" ADD CONSTRAINT dist_scheme_window CHECK ("validTo" >= "validFrom" AND "discPct" >= 0 AND "discPct" <= 100);
ALTER TABLE "Tenant" ADD CONSTRAINT tenant_product_known CHECK (product IN ('pharmacy', 'distribution'));
