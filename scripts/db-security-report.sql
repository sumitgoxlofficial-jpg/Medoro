-- Read-only report of the database-level security state Medoro relies on. Run it as the role the APP connects as:
--   psql "$DATABASE_URL" -f scripts/db-security-report.sql
-- It changes nothing. Read the "app role" block first: it tells you whether row-level security can protect you from this app.

\echo '== app role'
SELECT current_user AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypasses_rls, r.rolcreatedb AS can_create_db,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user) AS tables_it_owns
FROM pg_roles r WHERE r.rolname = current_user;
\echo '   (A superuser, a BYPASSRLS role or the table owner is not restricted by row-level security policies.)'

\echo '== tables without row-level security enabled (expect none)'
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations' ORDER BY 1;

\echo '== tables with FORCE row-level security (applies RLS to the owner too; expect none until tenant policies exist)'
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity ORDER BY 1;

\echo '== row-level security policies (the app currently relies on service-layer tenant scoping, so none is expected)'
SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;

\echo '== append-only / guard triggers'
SELECT c.relname AS "table", t.tgname AS trigger FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND (t.tgname LIKE '%append_only%' OR t.tgname LIKE '%guard%') ORDER BY 1;

\echo '== privileges held by hosted-API roles (expect none)'
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') LIMIT 20;
