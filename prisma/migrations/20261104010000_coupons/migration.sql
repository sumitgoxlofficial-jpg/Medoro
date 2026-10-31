-- Subscription coupon codes (staff console) and the coupon used on each online payment.
ALTER TABLE "OnlinePayment" ADD COLUMN "couponCode" TEXT;
ALTER TABLE "OnlinePayment" ADD COLUMN "discountPaise" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "plans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "Coupon" FROM %I', r.rolname);
  END LOOP;
END $$;
