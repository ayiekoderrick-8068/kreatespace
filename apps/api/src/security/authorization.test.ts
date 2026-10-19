import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";

/**
 * Every API route is listed here with who may use it. The role checks run before any handler, so
 * a caller with the wrong role must be turned away whatever they send, and a caller with no valid
 * sign-in must get 401. A last test counts the routes in the source, so a new route cannot be
 * added without being classified here.
 */

import {
  ID,
  IMAGE,
  adminRoutes,
  publicRouteCount,
  sellerRoutes,
  signedInRoutes,
  type Method,
  type Role,
} from "./route-table.js";

const fill = (path: string) => path.replace(ID, randomUUID()).replace(IMAGE, randomUUID());
const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("authorization of every API route", () => {
  const { app, prisma, actor } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const send = (method: Method, path: string, who?: { token: string }) => {
    const call = request(app)[method](fill(path)).send({});
    return who ? call.set(bearer(who as never)) : call;
  };

  const guarded: [Role, Method, string][] = [
    ...adminRoutes.map(([m, p]) => ["ADMIN", m, p] as [Role, Method, string]),
    ...sellerRoutes.map(([m, p]) => ["SELLER", m, p] as [Role, Method, string]),
  ];

  it("lists the expected number of guarded routes", () => {
    expect(adminRoutes).toHaveLength(25);
    expect(sellerRoutes).toHaveLength(30);
  });

  it("turns away callers who are not signed in", async () => {
    const failures: string[] = [];
    for (const [, method, path] of [
      ...guarded,
      ...signedInRoutes.map(([m, p]) => ["ADMIN", m, p] as [Role, Method, string]),
    ]) {
      const res = await send(method, path);
      if (res.status !== 401) failures.push(`${method.toUpperCase()} ${path} -> ${res.status}`);
      expect(res.body.error?.code, `${method} ${path}`).toBe("UNAUTHENTICATED");
    }
    expect(failures).toEqual([]);
  });

  it("turns away garbage and expired-looking tokens", async () => {
    for (const token of ["not-a-token", "Bearer", "a.b.c", "x".repeat(2000)]) {
      const res = await request(app)
        .get("/api/admin/analytics")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status, token.slice(0, 20)).toBe(401);
    }
  });

  it("refuses every role except the one a route is for", async () => {
    const customer = await actor("CUSTOMER");
    const seller = await actor("SELLER");
    const admin = await actor("ADMIN");
    const failures: string[] = [];

    for (const [allowed, method, path] of guarded) {
      const others = [customer, allowed === "ADMIN" ? seller : admin];
      for (const who of others) {
        const res = await send(method, path, who);
        if (res.status !== 403) {
          failures.push(`${method.toUpperCase()} ${path} as another role -> ${res.status}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("changes nothing when a wrong-role caller tries to write", async () => {
    const customer = await actor("CUSTOMER");
    const seller = await actor("SELLER");
    const before = await Promise.all([
      prisma.invitation.count(),
      prisma.business.count(),
      prisma.creation.count(),
      prisma.servicePackage.count(),
      prisma.websiteRequest.count(),
      prisma.importAuthorization.count(),
      prisma.auditLog.count(),
    ]);
    for (const [, method, path] of guarded.filter(([, m]) => m !== "get")) {
      await send(method, path, customer);
      if (path.startsWith("/api/admin")) await send(method, path, seller);
    }
    const after = await Promise.all([
      prisma.invitation.count(),
      prisma.business.count(),
      prisma.creation.count(),
      prisma.servicePackage.count(),
      prisma.websiteRequest.count(),
      prisma.importAuthorization.count(),
      prisma.auditLog.count(),
    ]);
    expect(after).toEqual(before);
  });

  it("does not let a seller read or change another seller's records, whatever the route", async () => {
    const a = await harness.sellerWithBusiness({ name: "Alpha" });
    const b = await harness.sellerWithBusiness({ name: "Beta" });
    const { buildCreation } = await import("../dev/builders.js");
    const creation = await buildCreation(prisma, {
      businessId: a.businessId,
      title: "Alpha Cake",
      status: "DRAFT",
    });
    const pkg = await prisma.servicePackage.create({
      data: { businessId: a.businessId, draft: { name: "Alpha package" } },
    });
    const wr = await prisma.websiteRequest.create({
      data: { businessId: a.businessId, type: "OTHER", description: "Alpha's private request." },
    });

    const attempts: [Method, string][] = [
      ["get", `/api/creations/${creation.creationId}`],
      ["patch", `/api/creations/${creation.creationId}`],
      ["post", `/api/creations/${creation.creationId}/submit`],
      ["post", `/api/creations/${creation.creationId}/archive`],
      ["post", `/api/creations/${creation.creationId}/uploads`],
      ["get", `/api/packages/${pkg.id}`],
      ["patch", `/api/packages/${pkg.id}`],
      ["post", `/api/packages/${pkg.id}/archive`],
      ["post", `/api/website-requests/${wr.id}/cancel`],
    ];
    for (const [method, path] of attempts) {
      const res = await request(app)
        [method](path)
        .set(bearer(b.seller))
        .send({ title: "Hijacked" });
      // Other people's records look exactly like records that do not exist.
      expect([404, 400], `${method} ${path} -> ${res.status}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain("Alpha");
    }
    const unchanged = await prisma.creationRevision.findFirstOrThrow({
      where: { creationId: creation.creationId },
    });
    expect(unchanged.title).toBe("Alpha Cake");
    expect((await prisma.websiteRequest.findUniqueOrThrow({ where: { id: wr.id } })).status).toBe(
      "NEW",
    );
  });
});

describe("every route is classified", () => {
  it("matches the route definitions in the source", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = join(here, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "generated" || name === "node_modules") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/routes\.ts$/.test(name)) files.push(path);
      }
    };
    walk(src);

    const definitions = files.reduce(
      (total, file) =>
        total +
        (readFileSync(file, "utf8").match(/router\.(get|post|patch|put|delete)\(/g)?.length ?? 0),
      0,
    );
    const classified =
      adminRoutes.length + sellerRoutes.length + signedInRoutes.length + publicRouteCount;
    expect(
      definitions,
      "A route was added or removed. Add it to the table in authorization.test.ts with who may use it.",
    ).toBe(classified);
  });
});
