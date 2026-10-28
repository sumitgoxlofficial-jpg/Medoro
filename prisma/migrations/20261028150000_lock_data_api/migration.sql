-- Medoro talks to PostgreSQL only from its own server, as the table owner. Hosted Postgres
-- services such as Supabase also publish the public schema through a REST/GraphQL API to the
-- "anon" and "authenticated" roles. Close that door: row level security on every table (the
-- owner bypasses it; nobody else gets rows), and no grants for those API roles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;

  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r.rolname);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r.rolname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r.rolname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r.rolname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r.rolname);
  END LOOP;
END $$;
