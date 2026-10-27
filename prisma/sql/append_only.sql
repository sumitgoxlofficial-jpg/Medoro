
-- Append-only tables: posted records are corrected with reversals, credit notes or
-- adjustment movements, never edited. These triggers enforce that at the database.
CREATE OR REPLACE FUNCTION medoro_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER ledger_line_append_only BEFORE UPDATE OR DELETE ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER voucher_append_only BEFORE UPDATE OR DELETE ON "Voucher"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER sale_append_only BEFORE UPDATE OR DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER payment_append_only BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION medoro_block_change();

-- Sale items: only returnedQty may change, and only upwards.
CREATE OR REPLACE FUNCTION medoro_sale_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SaleItem is append-only (DELETE blocked)';
  END IF;
  IF (NEW."saleId", NEW."batchId", NEW."medicineId", NEW.qty, NEW."mrpPaise", NEW."discountPaise",
      NEW."taxablePaise", NEW."gstRate", NEW."costPaise")
     IS DISTINCT FROM
     (OLD."saleId", OLD."batchId", OLD."medicineId", OLD.qty, OLD."mrpPaise", OLD."discountPaise",
      OLD."taxablePaise", OLD."gstRate", OLD."costPaise")
     OR NEW."returnedQty" < OLD."returnedQty" OR NEW."returnedQty" > NEW.qty THEN
    RAISE EXCEPTION 'SaleItem: only returnedQty may increase, up to qty';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sale_item_guard BEFORE UPDATE OR DELETE ON "SaleItem"
  FOR EACH ROW EXECUTE FUNCTION medoro_sale_item_guard();

-- Stock can never go negative.
ALTER TABLE "Batch" ADD CONSTRAINT batch_qty_nonnegative CHECK ("qtyAvailable" >= 0 AND "qtyQuarantined" >= 0);
