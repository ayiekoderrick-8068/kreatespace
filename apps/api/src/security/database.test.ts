import { describe, expect, it } from "vitest";
import { hasDatabase, testPrisma } from "../test/harness.js";

/**
 * On Supabase every table is also reachable through its public REST API with the anon key that
 * ships in the browser, unless row-level security denies it. These checks fail if a migration adds
 * a table and forgets to lock it down.
 */
describe.skipIf(!hasDatabase)("database exposure", () => {
  it("has row-level security on every table, so the public Data API can read nothing", async () => {
    const rows = await testPrisma().$queryRaw<{ table: string; secured: boolean }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS secured
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`;
    expect(rows.length).toBeGreaterThan(15);
    expect(
      rows.filter((row) => !row.secured).map((row) => row.table),
      "These tables are readable through the Supabase Data API. Enable row-level security on them in a migration.",
    ).toEqual([]);
  });

  it("gives Supabase's anon and signed-in roles no privileges, where those roles exist", async () => {
    const prisma = testPrisma();
    const roles = await prisma.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
    for (const { rolname } of roles) {
      const granted = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT DISTINCT table_name FROM information_schema.role_table_grants
        WHERE grantee = ${rolname} AND table_schema = 'public'`;
      expect(granted, `${rolname} must not have access to any table`).toEqual([]);
    }
  });

  it("lets nobody but the owner run the database's own functions, so the Data API cannot call them", async () => {
    // A function nobody revoked is executable by PUBLIC, which includes Supabase's anon role.
    // Trigger functions are skipped: the Data API does not offer them as callable functions.
    const open = await testPrisma().$queryRaw<{ name: string }[]>`
      SELECT p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND (p.proacl IS NULL
             OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
      ORDER BY p.proname`;
    expect(
      open.map((row) => row.name),
      "These functions can be called by anyone through the Supabase Data API. REVOKE ALL ON FUNCTION … FROM PUBLIC in the migration that creates them.",
    ).toEqual([]);
  });

  it("keeps the application's own access working", async () => {
    // The API connects as the table owner, which row-level security does not restrict.
    const prisma = testPrisma();
    expect(await prisma.category.count()).toBeGreaterThan(0);
  });
});
