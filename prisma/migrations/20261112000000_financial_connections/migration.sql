-- UPI & Bank Connect, phases 3–6 framework: connections to banks, Account Aggregator partners and payment providers,
-- their consent history, sync jobs and logs, single-use authorisation states, and a sealed inbox that carries fetched
-- transactions to Drive counters (nothing readable is kept). No connector is live until a partner is signed.
CREATE TABLE "FinConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "displayName" TEXT NOT NULL,
    "accountMasked" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "encryptedSecret" BYTEA,
    "consentExpiresAt" TIMESTAMP(3),
    "syncEveryMin" INTEGER,
    "cursor" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinConnection_kind_check" CHECK ("kind" IN ('bank', 'aa', 'provider')),
    CONSTRAINT "FinConnection_status_check" CHECK ("status" IN ('pending', 'active', 'expired', 'revoked', 'error', 'disconnected'))
);
CREATE INDEX "FinConnection_tenantId_status_idx" ON "FinConnection"("tenantId", "status");

CREATE TABLE "FinConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "externalId" TEXT,
    "purpose" TEXT,
    "fetchFrom" TIMESTAMP(3),
    "fetchTo" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinConsent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinConsent_event_check" CHECK ("event" IN ('requested', 'approved', 'rejected', 'paused', 'revoked', 'expired', 'renewed'))
);
CREATE INDEX "FinConsent_connectionId_idx" ON "FinConsent"("connectionId");
ALTER TABLE "FinConsent" ADD CONSTRAINT "FinConsent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FinConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TRIGGER fin_consent_append_only BEFORE UPDATE ON "FinConsent" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

CREATE TABLE "FinSyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "FinSyncJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinSyncJob_trigger_check" CHECK ("trigger" IN ('initial', 'schedule', 'manual', 'webhook')),
    CONSTRAINT "FinSyncJob_status_check" CHECK ("status" IN ('queued', 'running', 'done', 'failed'))
);
CREATE INDEX "FinSyncJob_status_runAfter_idx" ON "FinSyncJob"("status", "runAfter");
CREATE INDEX "FinSyncJob_connectionId_idx" ON "FinSyncJob"("connectionId");
ALTER TABLE "FinSyncJob" ADD CONSTRAINT "FinSyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FinConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Counts only: no amounts, names or account details.
CREATE TABLE "FinSyncLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    CONSTRAINT "FinSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinSyncLog_tenantId_startedAt_idx" ON "FinSyncLog"("tenantId", "startedAt");
CREATE TRIGGER fin_sync_log_append_only BEFORE UPDATE ON "FinSyncLog" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- A sign-in or consent redirect in progress: single use, bound to the user and pharmacy, 10 minutes.
CREATE TABLE "FinAuthState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "FinAuthState_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinAuthState_expiresAt_idx" ON "FinAuthState"("expiresAt");

-- Fetched transactions waiting for a Drive counter, sealed with that device's key; deleted when a counter takes
-- them, or after 14 days.
CREATE TABLE "FinInbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinInbox_tenantId_deviceId_batchId_key" ON "FinInbox"("tenantId", "deviceId", "batchId");
CREATE INDEX "FinInbox_tenantId_batchId_idx" ON "FinInbox"("tenantId", "batchId");
CREATE INDEX "FinInbox_createdAt_idx" ON "FinInbox"("createdAt");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "FinConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinSyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinSyncLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinInbox" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "FinConnection", "FinConsent", "FinSyncJob", "FinSyncLog", "FinAuthState", "FinInbox" FROM %I', r.rolname);
  END LOOP;
END $$;
