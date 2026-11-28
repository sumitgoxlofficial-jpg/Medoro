-- Enterprise HRMS Phase 1: data-integrity hardening. Backward compatible: adds triggers and indexes only;
-- no table, column or row is changed or removed.

-- Payslips and salary revisions are financial history: once written they are never edited or deleted
-- (the application only ever inserts them). Same guard as StaffAudit, vouchers and stock movements.
CREATE TRIGGER hr_payslip_append_only BEFORE UPDATE OR DELETE ON "HrPayslip"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER hr_salary_revision_append_only BEFORE UPDATE OR DELETE ON "HrSalaryRevision"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Audit-log lookups (newest first, and per person) and reporting-line / department queries
-- (My Team, visibility rules, approvals) had no index.
CREATE INDEX "StaffAudit_at_idx" ON "StaffAudit"("at");
CREATE INDEX "StaffAudit_staffId_at_idx" ON "StaffAudit"("staffId", "at");
CREATE INDEX "HrProfile_managerId_idx" ON "HrProfile"("managerId");
CREATE INDEX "HrProfile_dept_idx" ON "HrProfile"("dept");
