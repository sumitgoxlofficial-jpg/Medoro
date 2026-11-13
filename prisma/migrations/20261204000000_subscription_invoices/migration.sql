-- Invoices for subscription payments (no GST is charged). Each paid payment gets one number from a sequence; the
-- buyer's email is kept so the invoice can be sent to the person who paid.
ALTER TABLE "OnlinePayment" ADD COLUMN "invoiceNo" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "buyerEmail" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "invoiceSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "OnlinePayment_invoiceNo_key" ON "OnlinePayment"("invoiceNo");

CREATE SEQUENCE "OnlinePayment_invoice_seq" START 1;

-- Payments made before invoices existed get numbers in the order they were paid.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY COALESCE("paidAt", "createdAt"), id) AS n, COALESCE("paidAt", "createdAt") AS at
  FROM "OnlinePayment" WHERE status IN ('paid', 'refunded', 'duplicate') AND "amountPaise" > 0
)
UPDATE "OnlinePayment" p
SET "invoiceNo" = 'MED-' || to_char(numbered.at AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' || lpad(numbered.n::text, 5, '0')
FROM numbered WHERE p.id = numbered.id;

SELECT setval('"OnlinePayment_invoice_seq"', GREATEST((SELECT COUNT(*) FROM "OnlinePayment" WHERE "invoiceNo" IS NOT NULL), 1), (SELECT COUNT(*) FROM "OnlinePayment" WHERE "invoiceNo" IS NOT NULL) > 0);
