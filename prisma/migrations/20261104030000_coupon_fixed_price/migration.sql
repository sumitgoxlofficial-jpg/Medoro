-- A coupon can set a fixed price (GST included) instead of a percentage, e.g. ₹1 for a test payment.
ALTER TABLE "Coupon" ADD COLUMN "payPaise" INTEGER;
