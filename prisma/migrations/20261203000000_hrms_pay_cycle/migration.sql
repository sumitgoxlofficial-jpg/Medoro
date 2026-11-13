-- 0 = paid by calendar month (everyone so far); 1-31 = the cycle starts on that day of the month (new joiners: their joining day)
ALTER TABLE "HrProfile" ADD COLUMN "payCycleDay" INTEGER NOT NULL DEFAULT 0;
-- HR confirmed the saved bank account is the employee's own, when the holder's name doesn't match theirs
ALTER TABLE "HrProfile" ADD COLUMN "bankConfirmedAt" TIMESTAMP(3);
ALTER TABLE "HrPayslip" ADD COLUMN "periodFrom" DATE;
ALTER TABLE "HrPayslip" ADD COLUMN "periodTo" DATE;
ALTER TABLE "HrPayslip" ADD COLUMN "payDate" DATE;
