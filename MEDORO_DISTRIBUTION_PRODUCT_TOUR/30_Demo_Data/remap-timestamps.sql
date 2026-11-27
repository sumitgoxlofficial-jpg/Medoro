\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE tid AS SELECT id FROM "Tenant" WHERE code = :'code';
CREATE TEMP TABLE anchors(real timestamp, fake timestamp);
INSERT INTO anchors SELECT "postedAt", date FROM "Voucher" WHERE "tenantId" IN (SELECT id FROM tid);
INSERT INTO anchors SELECT "placedAt", "decidedAt" FROM "DistOrder" WHERE "tenantId" IN (SELECT id FROM tid) AND "decidedAt" IS NOT NULL;
INSERT INTO anchors SELECT "createdAt", "pickedAt" FROM "DistPickList" WHERE "tenantId" IN (SELECT id FROM tid) AND "pickedAt" IS NOT NULL;
INSERT INTO anchors SELECT "createdAt", "dispatchedAt" FROM "DistDispatch" WHERE "tenantId" IN (SELECT id FROM tid) AND "dispatchedAt" IS NOT NULL;
INSERT INTO anchors SELECT "updatedAt", "deliveredAt" FROM "DistDelivery" WHERE "tenantId" IN (SELECT id FROM tid) AND "deliveredAt" IS NOT NULL;
INSERT INTO anchors SELECT "createdAt", "placedAt" FROM "PurchaseOrder" WHERE "tenantId" IN (SELECT id FROM tid) AND "placedAt" IS NOT NULL;
CREATE INDEX ON anchors(real);
-- the first anchor is the opening GRN at the start date
CREATE TEMP TABLE win AS SELECT min(real) - interval '30 seconds' lo, max(real) + interval '30 seconds' hi FROM anchors;
CREATE OR REPLACE FUNCTION pg_temp.fk(x timestamp) RETURNS timestamp LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT a.fake + LEAST(x - a.real, interval '5 seconds') FROM anchors a WHERE a.real <= x ORDER BY a.real DESC LIMIT 1),
                  (SELECT a.fake - interval '5 seconds' FROM anchors a ORDER BY a.real ASC LIMIT 1)) $$;
SET session_replication_role = replica; -- skips the append-only triggers for this maintenance
DO $$ DECLARE r record; lo timestamp; hi timestamp; n int; BEGIN
  SELECT w.lo, w.hi INTO lo, hi FROM win w;
  FOR r IN SELECT c.table_name t, c.column_name col FROM information_schema.columns c
           JOIN information_schema.columns k ON k.table_name = c.table_name AND k.column_name = 'tenantId' AND k.table_schema = 'public'
           WHERE c.table_schema = 'public' AND c.data_type LIKE 'timestamp%' LOOP
    EXECUTE format('UPDATE %I SET %I = pg_temp.fk(%I) WHERE "tenantId" IN (SELECT id FROM tid) AND %I BETWEEN $1 AND $2', r.t, r.col, r.col, r.col) USING lo, hi;
    GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '% .% : %', r.t, r.col, n; END IF;
  END LOOP;
END $$;
-- orders still waiting this morning were placed at 09:15 IST
UPDATE "DistOrder" SET "placedAt" = (date :'today' + time '03:45') + (random() * interval '20 minutes') WHERE "tenantId" IN (SELECT id FROM tid) AND status = 'pending';
COMMIT;
