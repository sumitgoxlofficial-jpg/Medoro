-- One email can have a Medoro team profile and a reference partner profile, each with its own sign-in.
ALTER TABLE "StaffUser" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'team';
UPDATE "StaffUser" SET "kind" = 'partner' WHERE "role" = 'partner';
DROP INDEX "StaffUser_email_key";
CREATE UNIQUE INDEX "StaffUser_email_kind_key" ON "StaffUser"("email", "kind");
