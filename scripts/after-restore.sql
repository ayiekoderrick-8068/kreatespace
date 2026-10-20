-- Run this on a database restored from a backup, before pointing the API at it:
--
--   psql "$RESTORED_DATABASE_URL" -f scripts/after-restore.sql
--
-- The restore command in docs/OPERATIONS.md uses --no-privileges, so that it works whatever the
-- database users are called. That also leaves out the "who may run what" settings, which are not
-- part of the tables' own data. This puts back the ones KreateSpace relies on, the same way the
-- migrations first did. It is safe to run more than once.
--
--  1. Row-level security stays on every table (it is stored with the table, but is checked again).
--  2. No function in the public schema can be run by everyone. On Supabase, anyone holding the
--     public key could otherwise call them through the REST API.
--  3. Supabase's anon and signed-in roles keep no privileges on tables, sequences or functions.
DO $$
DECLARE
  item record;
  role_name text;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', item.tablename);
  END LOOP;

  FOR item IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', item.signature);
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
