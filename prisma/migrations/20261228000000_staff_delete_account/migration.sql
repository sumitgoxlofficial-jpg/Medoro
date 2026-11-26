-- HR can delete a deactivated employee's account; payroll and statutory records are kept.
ALTER TABLE "StaffUser" ADD COLUMN "deletedAt" TIMESTAMP(3);
