-- Drive mode monitoring: when each device last synced with Google Drive, and its last sync error (text only, no data).
ALTER TABLE "DriveDevice" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "DriveDevice" ADD COLUMN "lastError" TEXT;
ALTER TABLE "DriveDevice" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
