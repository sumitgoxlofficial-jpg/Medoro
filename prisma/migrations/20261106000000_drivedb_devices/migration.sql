-- DriveDB (Drive mode): devices allowed to sync a pharmacy's encrypted data through Medoro's relay.
-- Only the device's public key and status are kept here; the data and its keys live in the owner's Google Drive.
CREATE TABLE "DriveDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "publicKey" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    CONSTRAINT "DriveDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriveDevice_tenantId_deviceId_key" ON "DriveDevice"("tenantId", "deviceId");
CREATE INDEX "DriveDevice_tenantId_status_idx" ON "DriveDevice"("tenantId", "status");
ALTER TABLE "DriveDevice" ENABLE ROW LEVEL SECURITY;
