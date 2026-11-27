-- Rollback for prisma/migrations/20261215000000_hrms_learning_engagement: drops courses, enrolments, attempts, surveys
-- and responses. Deploy the previous app version first (Ally reads courses).
DROP TABLE IF EXISTS "HrCourseAttempt";
DROP TABLE IF EXISTS "HrCourseEnrolment";
DROP TABLE IF EXISTS "HrCourse";
DROP TABLE IF EXISTS "HrSurveyResponse";
DROP TABLE IF EXISTS "HrSurvey";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261215000000_hrms_learning_engagement';
