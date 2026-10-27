-- Staff audit, ticket messages and lead logs are history: never edited or deleted.
CREATE TRIGGER staff_audit_append_only BEFORE UPDATE OR DELETE ON "StaffAudit"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER ticket_message_append_only BEFORE UPDATE OR DELETE ON "TicketMessage"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER lead_log_append_only BEFORE UPDATE OR DELETE ON "LeadLog"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
