import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../", path), "utf8"));

/**
 * Prisma's PostgreSQL adapter (7.10.1, the latest stable release) runs some queries at the same time
 * on one connection inside a transaction. `pg` 8 only warns about this ("client.query() while
 * already executing a query"); `pg` 9 will make it an error. Until a stable Prisma release fixes the
 * adapter, `pg` must stay on 8.x. See docs/SECURITY.md.
 */
describe("database driver versions", () => {
  it("keeps pg on 8.x while Prisma's adapter still issues concurrent queries in transactions", () => {
    const { dependencies } = read("package.json");
    expect(dependencies.pg, "pg must not be raised to 9 yet").toMatch(/^\^?8\./);
  });

  it("uses the exact Prisma versions the migrations were tested with", () => {
    const { dependencies } = read("package.json");
    expect(dependencies["@prisma/client"]).toBe(dependencies.prisma);
    expect(dependencies["@prisma/adapter-pg"]).toBe(dependencies.prisma);
  });
});
