-- Sliding-window rate limit for AI questions, shared across app instances.
CREATE TABLE "AiAsk" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAsk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiAsk_userId_at_idx" ON "AiAsk"("userId", "at");

-- Not reachable through a hosted data API (see lock_data_api).
ALTER TABLE "AiAsk" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE "AiAsk" FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON SEQUENCE "AiAsk_id_seq" FROM %I', r.rolname);
  END LOOP;
END $$;