-- Supabase exposes every table in the public schema through its REST ("Data") API, reachable with
-- the public anon key that ships in the browser. KreateSpace only ever reads and writes data
-- through its own API, so that door is closed:
--   1. row-level security is switched on for every table, with no policies, which denies the
--      anon and authenticated roles everything. The API's own database role owns the tables and
--      is not restricted by it.
--   2. those two roles also lose their table privileges, as a second lock.
-- On a plain PostgreSQL server (development, CI) the two Supabase roles do not exist, so only the
-- first step has any effect. A test fails if a later migration adds a table without doing this.
DO $$
DECLARE
  item record;
  role_name text;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', item.tablename);
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
