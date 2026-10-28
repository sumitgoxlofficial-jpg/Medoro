-- Live updates across devices: after a change commits, Postgres tells every app server which
-- pharmacy (and branch) changed. Identical notifications in one transaction are delivered once.
CREATE OR REPLACE FUNCTION medoro_notify_change() RETURNS trigger AS $$
DECLARE r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  PERFORM pg_notify('medoro_change', json_build_object('t', TG_TABLE_NAME, 'tenant', r->>'tenantId', 'branch', r->>'branchId')::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sale_notify AFTER INSERT OR UPDATE OR DELETE ON "Sale" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER batch_notify AFTER INSERT OR UPDATE OR DELETE ON "Batch" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER medicine_notify AFTER INSERT OR UPDATE OR DELETE ON "Medicine" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER customer_notify AFTER INSERT OR UPDATE OR DELETE ON "Customer" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER supplier_notify AFTER INSERT OR UPDATE OR DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER voucher_notify AFTER INSERT OR UPDATE OR DELETE ON "Voucher" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER heldcart_notify AFTER INSERT OR UPDATE OR DELETE ON "HeldCart" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER transfer_notify AFTER INSERT OR UPDATE OR DELETE ON "Transfer" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER purchaseorder_notify AFTER INSERT OR UPDATE OR DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER grn_notify AFTER INSERT OR UPDATE OR DELETE ON "Grn" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER salesreturn_notify AFTER INSERT OR UPDATE OR DELETE ON "SalesReturn" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER shift_notify AFTER INSERT OR UPDATE OR DELETE ON "Shift" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER recall_notify AFTER INSERT OR UPDATE OR DELETE ON "Recall" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER stockcount_notify AFTER INSERT OR UPDATE OR DELETE ON "StockCount" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER stockout_notify AFTER INSERT OR UPDATE OR DELETE ON "StockOut" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER wamessage_notify AFTER INSERT OR UPDATE OR DELETE ON "WaMessage" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER backupmanifest_notify AFTER INSERT OR UPDATE OR DELETE ON "BackupManifest" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER campaign_notify AFTER INSERT OR UPDATE OR DELETE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER supplierbill_notify AFTER INSERT OR UPDATE OR DELETE ON "SupplierBill" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER integration_notify AFTER INSERT OR UPDATE OR DELETE ON "Integration" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER invite_notify AFTER INSERT OR UPDATE OR DELETE ON "Invite" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER user_notify AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER branch_notify AFTER INSERT OR UPDATE OR DELETE ON "Branch" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER counter_notify AFTER INSERT OR UPDATE OR DELETE ON "Counter" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
CREATE TRIGGER role_notify AFTER INSERT OR UPDATE OR DELETE ON "Role" FOR EACH ROW EXECUTE FUNCTION medoro_notify_change();
