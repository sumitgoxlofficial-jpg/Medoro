-- Enterprise HRMS Phase 6: shifts and the roster. New tables only.
-- CreateTable
CREATE TABLE "HrShift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "graceMin" INTEGER NOT NULL DEFAULT 10,
    "breakMin" INTEGER NOT NULL DEFAULT 30,
    "workMin" INTEGER NOT NULL,
    "overnight" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShiftAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrShiftAssignment_staffId_fromDay_idx" ON "HrShiftAssignment"("staffId", "fromDay");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_shiftId_idx" ON "HrShiftAssignment"("shiftId");

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER hr_shift_assignment_no_delete BEFORE DELETE ON "HrShiftAssignment" FOR EACH ROW EXECUTE FUNCTION medoro_block_delete();
ALTER TABLE "HrShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrShiftAssignment" ENABLE ROW LEVEL SECURITY;
