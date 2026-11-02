-- Bill-level bank matching on the server: the credit bill a bank credit paid, and bills rejected for it.
ALTER TABLE "BankLine" ADD COLUMN "saleId" TEXT;
ALTER TABLE "BankLine" ADD COLUMN "rejectedSaleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
