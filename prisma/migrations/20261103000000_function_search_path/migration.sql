-- Pin the search_path of Medoro's trigger functions (Supabase security advisor:
-- "function_search_path_mutable"). They only call built-ins, so pg_catalog is enough.
ALTER FUNCTION medoro_block_change() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION medoro_notify_change() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION medoro_sale_item_guard() SET search_path = pg_catalog, pg_temp;
