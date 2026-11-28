-- Enterprise HRMS: read-only integrity report (Phase 1).
-- Most HR tables keep the employee as a plain text column without a foreign key. Before Phase 2 adds foreign keys,
-- run this against a copy or replica of production to see how many rows point at a person who doesn't exist.
-- It only reads: nothing is changed. Run:  psql "$DATABASE_URL" -f scripts/hrms-integrity-check.sql
-- Columns can hold "" (nobody) or the super admin's system id; those are not counted as orphans.
\echo 'Rows whose person column points at no StaffUser (expected: no rows listed)'
SELECT * FROM (
  SELECT 'HrAllyUsage' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrAllyUsage" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrAnnouncement' AS "table", 'byId' AS "column", count(*) AS orphans FROM "HrAnnouncement" x WHERE x."byId" IS NOT NULL AND x."byId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."byId")
  UNION ALL
  SELECT 'HrAsset' AS "table", 'assigneeId' AS "column", count(*) AS orphans FROM "HrAsset" x WHERE x."assigneeId" IS NOT NULL AND x."assigneeId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."assigneeId")
  UNION ALL
  SELECT 'HrAttendance' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrAttendance" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrBreak' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrBreak" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrChatBackup' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrChatBackup" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrChatMember' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrChatMember" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrChatMessage' AS "table", 'senderId' AS "column", count(*) AS orphans FROM "HrChatMessage" x WHERE x."senderId" IS NOT NULL AND x."senderId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."senderId")
  UNION ALL
  SELECT 'HrChatReaction' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrChatReaction" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrChatVote' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrChatVote" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrClaim' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrClaim" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrCorrection' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrCorrection" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrDocument' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrDocument" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrExit' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrExit" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrGoogle' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrGoogle" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrIdle' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrIdle" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrLeave' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrLeave" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrLetter' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrLetter" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrMeeting' AS "table", 'byId' AS "column", count(*) AS orphans FROM "HrMeeting" x WHERE x."byId" IS NOT NULL AND x."byId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."byId")
  UNION ALL
  SELECT 'HrNotification' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrNotification" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrPayslip' AS "table", 'runBy' AS "column", count(*) AS orphans FROM "HrPayslip" x WHERE x."runBy" IS NOT NULL AND x."runBy" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."runBy")
  UNION ALL
  SELECT 'HrPayslip' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrPayslip" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrPolicyAck' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrPolicyAck" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrProfile' AS "table", 'managerId' AS "column", count(*) AS orphans FROM "HrProfile" x WHERE x."managerId" IS NOT NULL AND x."managerId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."managerId")
  UNION ALL
  SELECT 'HrProfile' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrProfile" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrPromotion' AS "table", 'byId' AS "column", count(*) AS orphans FROM "HrPromotion" x WHERE x."byId" IS NOT NULL AND x."byId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."byId")
  UNION ALL
  SELECT 'HrPromotion' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrPromotion" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrReview' AS "table", 'managerId' AS "column", count(*) AS orphans FROM "HrReview" x WHERE x."managerId" IS NOT NULL AND x."managerId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."managerId")
  UNION ALL
  SELECT 'HrReview' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrReview" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrRisk' AS "table", 'ownerId' AS "column", count(*) AS orphans FROM "HrRisk" x WHERE x."ownerId" IS NOT NULL AND x."ownerId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."ownerId")
  UNION ALL
  SELECT 'HrSalaryRevision' AS "table", 'byId' AS "column", count(*) AS orphans FROM "HrSalaryRevision" x WHERE x."byId" IS NOT NULL AND x."byId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."byId")
  UNION ALL
  SELECT 'HrSalaryRevision' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrSalaryRevision" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrSelfie' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrSelfie" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrTask' AS "table", 'assigneeId' AS "column", count(*) AS orphans FROM "HrTask" x WHERE x."assigneeId" IS NOT NULL AND x."assigneeId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."assigneeId")
  UNION ALL
  SELECT 'HrTask' AS "table", 'byId' AS "column", count(*) AS orphans FROM "HrTask" x WHERE x."byId" IS NOT NULL AND x."byId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."byId")
  UNION ALL
  SELECT 'HrTicket' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrTicket" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'HrWaMessage' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "HrWaMessage" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'StaffAudit' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "StaffAudit" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'StaffPayout' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "StaffPayout" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'TrAssignment' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "TrAssignment" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
  UNION ALL
  SELECT 'TrBatch' AS "table", 'trainerId' AS "column", count(*) AS orphans FROM "TrBatch" x WHERE x."trainerId" IS NOT NULL AND x."trainerId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."trainerId")
  UNION ALL
  SELECT 'TrCertificate' AS "table", 'staffId' AS "column", count(*) AS orphans FROM "TrCertificate" x WHERE x."staffId" IS NOT NULL AND x."staffId" <> '' AND NOT EXISTS (SELECT 1 FROM "StaffUser" u WHERE u.id = x."staffId")
) r WHERE orphans > 0 ORDER BY 1, 2;

\echo 'Duplicate payslips per person and month (expected: none; a unique index also prevents them)'
SELECT "staffId", month, count(*) FROM "HrPayslip" GROUP BY 1, 2 HAVING count(*) > 1;

\echo 'Reporting-line loops (a person who is their own manager)'
SELECT "staffId" FROM "HrProfile" WHERE "managerId" = "staffId";

\echo 'Active employees without an HR profile'
SELECT u."empNo", u.name FROM "StaffUser" u LEFT JOIN "HrProfile" p ON p."staffId" = u.id
 WHERE u.kind = 'team' AND u.role <> 'partner' AND u.status = 'active' AND u."deletedAt" IS NULL AND p."staffId" IS NULL;

\echo 'Append-only guards on HR history (expected: 3 rows)'
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname IN ('staff_audit_append_only', 'hr_payslip_append_only', 'hr_salary_revision_append_only');
