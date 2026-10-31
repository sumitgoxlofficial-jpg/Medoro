-- Payment lifecycle: failed attempts, duplicate payments refunded automatically, refunds on cancellation.
ALTER TABLE "OnlinePayment" ADD COLUMN "note" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "prevStatus" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "prevRenewsAt" TIMESTAMP(3);
ALTER TABLE "OnlinePayment" ADD COLUMN "refundId" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "CpOnlinePayment" ADD COLUMN "note" TEXT;
ALTER TABLE "CpOnlinePayment" ADD COLUMN "refundId" TEXT;
