-- UPI & Bank alert counts a Drive counter reports with its sync health (numbers only, no amounts or names),
-- for the owner's daily email: counter UPI missing from the bank statement, possible duplicates, unmatched credits.
ALTER TABLE "DriveDevice" ADD COLUMN "finAlerts" JSONB;
ALTER TABLE "DriveDevice" ADD COLUMN "finAlertsAt" TIMESTAMP(3);
