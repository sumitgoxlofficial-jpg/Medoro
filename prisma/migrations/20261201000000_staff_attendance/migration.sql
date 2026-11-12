CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "inAt" TIMESTAMP(3),
    "outAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "editedBy" TEXT,
    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffAttendance_tenantId_userId_day_key" ON "StaffAttendance"("tenantId", "userId", "day");
CREATE INDEX "StaffAttendance_tenantId_branchId_day_idx" ON "StaffAttendance"("tenantId", "branchId", "day");
ALTER TABLE public."StaffAttendance" ENABLE ROW LEVEL SECURITY;
