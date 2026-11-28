-- Rollback for prisma/migrations/20270105000000_hrms_ai_hr_assistant. Deploy the previous app version first.
-- Drops only the AI HR tables (their data since deployment is lost); nothing older is touched.
DROP TABLE IF EXISTS "AiHrWebhookEvent";
DROP TABLE IF EXISTS "AiHrEvalRun";
DROP TABLE IF EXISTS "AiHrScenario";
DROP TABLE IF EXISTS "AiHrKnowledgeDoc";
DROP TABLE IF EXISTS "AiHrConsent";
DROP TABLE IF EXISTS "AiHrAction";
DROP TABLE IF EXISTS "AiHrCallResponse";
DROP TABLE IF EXISTS "AiHrTurn";
DROP TABLE IF EXISTS "AiHrCallAttempt";
DROP TABLE IF EXISTS "AiHrCall";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20270105000000_hrms_ai_hr_assistant';
