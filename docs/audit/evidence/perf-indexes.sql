-- Synthetic volume for a hosted multi-tenant database: 1,000 pharmacies, ~1 year of shifts and WhatsApp messages.
\timing off
BEGIN;
INSERT INTO "Shift" (id, "tenantId", "branchId", counter, "openedBy", "openingPaise", "openedAt", "closedAt")
SELECT gen_random_uuid()::text, 't' || (g % 1000), 'b' || (g % 1000), 'c' || (g % 3), 'x', 0, now() - (g || ' minutes')::interval, now()
FROM generate_series(1, 400000) g;
INSERT INTO "Shift" (id, "tenantId", "branchId", counter, "openedBy", "openingPaise") VALUES ('probe-shift', 't42', 'b42', 'c1', 'x', 0);
INSERT INTO "WaMessage" (id, "tenantId", "invoiceId", "invoiceNo", recipient, "idempotencyKey", wamid, status, "updatedAt")
SELECT gen_random_uuid()::text, 't' || (g % 1000), 'inv' || g, 'N' || g, '9800000000', 'k' || g, 'wamid.' || g, 'sent', now()
FROM generate_series(1, 600000) g;
COMMIT;
ANALYZE "Shift"; ANALYZE "WaMessage";
\echo '=== BEFORE: open-shift lookup (every sale commit)'
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON) SELECT id FROM "Shift" WHERE "tenantId" = 't42' AND "branchId" = 'b42' AND "closedAt" IS NULL AND counter = 'c1' LIMIT 1;
\echo '=== BEFORE: WhatsApp status webhook lookup'
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON) SELECT id FROM "WaMessage" WHERE "tenantId" = 't42' AND wamid = 'wamid.123042' LIMIT 1;
\echo '=== BEFORE: messages for an invoice'
EXPLAIN (ANALYZE, COSTS OFF, SUMMARY ON) SELECT id FROM "WaMessage" WHERE "tenantId" = 't42' AND "invoiceId" = 'inv123042';
