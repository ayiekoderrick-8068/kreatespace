import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("a user's first requests", () => {
  const { app, prisma, newcomer, actor } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it("all succeed when they arrive at the same moment, creating exactly one profile", async () => {
    const person = newcomer("first-timer@example.com");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(app).get("/api/me").set(bearer(person))),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await prisma.user.count({ where: { id: person.id } })).toBe(1);
    expect(results[0]!.body.user).toMatchObject({
      email: "first-timer@example.com",
      role: "CUSTOMER",
    });
  });

  it("works across different endpoints at once, such as a save right after login", async () => {
    const person = newcomer("quick-saver@example.com");
    const [me, saved] = await Promise.all([
      request(app).get("/api/me").set(bearer(person)),
      request(app).get("/api/me/saved/ids").set(bearer(person)),
    ]);
    expect([me.status, saved.status]).toEqual([200, 200]);
    expect(await prisma.user.count({ where: { id: person.id } })).toBe(1);
  });

  it("never changes an existing user's role", async () => {
    const admin = await actor("ADMIN");
    await Promise.all(
      Array.from({ length: 3 }, () => request(app).get("/api/me").set(bearer(admin))),
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });

  it("refuses, rather than crashing, when the email belongs to a different account", async () => {
    await actor("CUSTOMER", "taken@example.com");
    const impostor = newcomer("taken@example.com");
    const res = await request(app).get("/api/me").set(bearer(impostor));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACCOUNT_CONFLICT");
    expect(await prisma.user.count({ where: { email: "taken@example.com" } })).toBe(1);
  });
});
