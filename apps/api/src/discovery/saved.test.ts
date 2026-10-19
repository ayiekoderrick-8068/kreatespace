import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("saved creations", () => {
  const { app, prisma, actor } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const save = (user: Awaited<ReturnType<typeof actor>>, id: string) =>
    request(app).put(`/api/me/saved/${id}`).set(bearer(user));
  const unsave = (user: Awaited<ReturnType<typeof actor>>, id: string) =>
    request(app).delete(`/api/me/saved/${id}`).set(bearer(user));
  const list = (user: Awaited<ReturnType<typeof actor>>, query: Record<string, number> = {}) =>
    request(app).get("/api/me/saved").query(query).set(bearer(user));
  const ids = async (user: Awaited<ReturnType<typeof actor>>) =>
    (await request(app).get("/api/me/saved/ids").set(bearer(user))).body.ids as string[];

  async function liveCreation(title = "Cake") {
    const { businessId } = await buildBusiness(prisma, { name: `Biz ${randomUUID().slice(0, 6)}` });
    return (await buildCreation(prisma, { businessId, title })).creationId;
  }

  describe("access", () => {
    it("requires sign-in for every operation", async () => {
      const id = await liveCreation();
      expect((await request(app).get("/api/me/saved")).status).toBe(401);
      expect((await request(app).get("/api/me/saved/ids")).status).toBe(401);
      expect((await request(app).put(`/api/me/saved/${id}`)).status).toBe(401);
      expect((await request(app).delete(`/api/me/saved/${id}`)).status).toBe(401);
      expect(await prisma.savedCreation.count()).toBe(0);
    });

    it("works for customers, sellers and admins", async () => {
      const id = await liveCreation();
      for (const role of ["CUSTOMER", "SELLER", "ADMIN"] as const) {
        const user = await actor(role);
        expect((await save(user, id)).status).toBe(200);
      }
      expect(await prisma.savedCreation.count()).toBe(3);
    });

    it("keeps each user's saves private", async () => {
      const id = await liveCreation("Maria's Pick");
      const maria = await actor("CUSTOMER");
      const joy = await actor("CUSTOMER");
      await save(maria, id);

      expect(await ids(joy)).toEqual([]);
      expect((await list(joy)).body.items).toEqual([]);
      expect((await list(maria)).body.items).toHaveLength(1);

      // Joy can't remove Maria's save.
      await unsave(joy, id);
      expect(await ids(maria)).toEqual([id]);
    });

    it("marks responses as private so shared caches never store them", async () => {
      const user = await actor("CUSTOMER");
      expect((await list(user)).headers["cache-control"]).toBe("private, no-store");
    });
  });

  describe("saving and removing", () => {
    it("saves a creation and lists it", async () => {
      const id = await liveCreation("Floral Birthday Cake");
      const user = await actor("CUSTOMER");
      const res = await save(user, id);
      expect(res.body).toEqual({ saved: true });
      expect(await ids(user)).toEqual([id]);
      const saved = await list(user);
      expect(saved.body.items[0]).toMatchObject({ id, title: "Floral Birthday Cake" });
    });

    it("saving twice is harmless", async () => {
      const id = await liveCreation();
      const user = await actor("CUSTOMER");
      await save(user, id);
      expect((await save(user, id)).status).toBe(200);
      expect(await prisma.savedCreation.count()).toBe(1);
    });

    it("handles simultaneous saves of the same creation", async () => {
      const id = await liveCreation();
      const user = await actor("CUSTOMER");
      const results = await Promise.all(Array.from({ length: 5 }, () => save(user, id)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await prisma.savedCreation.count()).toBe(1);
    });

    it("removes a saved creation, and removing again is harmless", async () => {
      const id = await liveCreation();
      const user = await actor("CUSTOMER");
      await save(user, id);
      expect((await unsave(user, id)).body).toEqual({ saved: false });
      expect(await ids(user)).toEqual([]);
      expect((await unsave(user, id)).status).toBe(200);
    });

    it("lists the most recently saved first and paginates", async () => {
      const user = await actor("CUSTOMER");
      const first = await liveCreation("First");
      const second = await liveCreation("Second");
      const third = await liveCreation("Third");
      for (const id of [first, second, third]) {
        await save(user, id);
        await new Promise((r) => setTimeout(r, 15));
      }
      const page1 = await list(user, { pageSize: 2 });
      expect(page1.body.items.map((i: { title: string }) => i.title)).toEqual(["Third", "Second"]);
      expect(page1.body.hasMore).toBe(true);
      const page2 = await list(user, { pageSize: 2, page: 2 });
      expect(page2.body.items.map((i: { title: string }) => i.title)).toEqual(["First"]);
      expect(page2.body.hasMore).toBe(false);
    });
  });

  describe("public visibility rules", () => {
    it.each(["DRAFT", "PENDING", "REJECTED", "ARCHIVED"] as const)(
      "cannot save a %s creation",
      async (status) => {
        const { businessId } = await buildBusiness(prisma, { name: "Maria" });
        const { creationId } = await buildCreation(prisma, { businessId, title: "Cake", status });
        const user = await actor("CUSTOMER");
        expect((await save(user, creationId)).status).toBe(404);
        expect(await prisma.savedCreation.count()).toBe(0);
      },
    );

    it("cannot save a creation of a suspended business, or an unknown one", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria", status: "SUSPENDED" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Cake" });
      const user = await actor("CUSTOMER");
      expect((await save(user, creationId)).status).toBe(404);
      expect((await save(user, randomUUID())).status).toBe(404);
      expect((await save(user, "nope")).status).toBe(400);
    });

    it("hides saved creations that stop being public, and restores them if they return", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Cake" });
      const user = await actor("CUSTOMER");
      await save(user, creationId);

      await prisma.business.update({ where: { id: businessId }, data: { status: "SUSPENDED" } });
      expect((await list(user)).body.items).toEqual([]);

      await prisma.business.update({ where: { id: businessId }, data: { status: "APPROVED" } });
      expect((await list(user)).body.items).toHaveLength(1);

      await prisma.creation.update({ where: { id: creationId }, data: { status: "ARCHIVED" } });
      expect((await list(user)).body.items).toEqual([]);
      // Still removable, so people can tidy their list.
      expect((await unsave(user, creationId)).status).toBe(200);
      expect(await ids(user)).toEqual([]);
    });
  });
});
