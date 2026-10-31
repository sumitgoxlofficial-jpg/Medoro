-- The AI Pharmacy Manager add-on, bought online on a hosted server, runs until this time.
ALTER TABLE "SubscriptionMeta" ADD COLUMN "aiUntil" TIMESTAMP(3);
