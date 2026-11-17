-- Medoro 2.0 security hardening: sales returns, stock-outs (write-offs, supplier returns) and goods receipts are records of
-- things that happened. No code updates or deletes them (corrections are new rows), so the database now refuses it too,
-- the same way it already does for sales, payments, vouchers, ledger lines and stock movements.
-- Forward-only: adds triggers; no data or column changes. TRUNCATE (account deletion, test resets) is not a row operation and is unaffected.
CREATE TRIGGER sales_return_append_only BEFORE UPDATE OR DELETE ON "SalesReturn" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER stock_out_append_only BEFORE UPDATE OR DELETE ON "StockOut" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER grn_append_only BEFORE UPDATE OR DELETE ON "Grn" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
CREATE TRIGGER grn_item_append_only BEFORE UPDATE OR DELETE ON "GrnItem" FOR EACH ROW EXECUTE FUNCTION medoro_block_change();
