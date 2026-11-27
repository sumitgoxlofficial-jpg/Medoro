-- Enterprise HRMS Phase 4: workforce agent devices, enrolment codes, activity spans, policy acknowledgements, disputes, app categories. New tables only.
-- CreateTable
CREATE TABLE "HrDevice" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'windows',
    "agentVersion" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "ownership" TEXT NOT NULL DEFAULT 'company',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolledBy" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HrDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrDeviceCode" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrDeviceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrWorkEvent" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "app" TEXT,
    "day" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrWorkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrMonitorAck" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrMonitorAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrActivityDispute" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "fromTime" TEXT NOT NULL,
    "toTime" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reply" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrActivityDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAppCategory" (
    "app" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "setBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrAppCategory_pkey" PRIMARY KEY ("app")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrDevice_tokenHash_key" ON "HrDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "HrDevice_staffId_revokedAt_idx" ON "HrDevice"("staffId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrDeviceCode_codeHash_key" ON "HrDeviceCode"("codeHash");

-- CreateIndex
CREATE INDEX "HrWorkEvent_staffId_day_idx" ON "HrWorkEvent"("staffId", "day");

-- CreateIndex
CREATE INDEX "HrWorkEvent_day_idx" ON "HrWorkEvent"("day");

-- CreateIndex
CREATE UNIQUE INDEX "HrWorkEvent_deviceId_clientId_key" ON "HrWorkEvent"("deviceId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "HrMonitorAck_staffId_version_key" ON "HrMonitorAck"("staffId", "version");

-- CreateIndex
CREATE INDEX "HrActivityDispute_status_createdAt_idx" ON "HrActivityDispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HrActivityDispute_staffId_day_idx" ON "HrActivityDispute"("staffId", "day");

-- AddForeignKey
ALTER TABLE "HrDevice" ADD CONSTRAINT "HrDevice_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrWorkEvent" ADD CONSTRAINT "HrWorkEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrWorkEvent" ADD CONSTRAINT "HrWorkEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "HrDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Acknowledgements are a consent record: never edited or deleted.
CREATE TRIGGER hr_monitor_ack_append_only BEFORE UPDATE OR DELETE ON "HrMonitorAck" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
ALTER TABLE "HrDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrDeviceCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrWorkEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrMonitorAck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrActivityDispute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrAppCategory" ENABLE ROW LEVEL SECURITY;
