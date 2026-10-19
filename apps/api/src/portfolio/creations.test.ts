import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCreation } from "../dev/builders.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("seller creation management", () => {
  const { app, prisma, actor, sellerWithBusiness } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  type Seller = Awaited<ReturnType<typeof sellerWithBusiness>>;

  const categoryId = async (slug = "cakes") =>
    (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const occasionId = async (slug = "birthday") =>
    (await prisma.occasion.findUniqueOrThrow({ where: { slug } })).id;

  async function details(overrides: Record<string, unknown> = {}) {
    return {
      title: "Floral Birthday Cake",
      description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      categoryId: await categoryId(),
      occasionId: await occasionId(),
      ...overrides,
    };
  }

  const create = async (owner: Seller, overrides: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/creations")
      .set(bearer(owner.seller))
      .send(await details(overrides));

  describe("occasions", () => {
    it("lists the occasions with ids, publicly", async () => {
      const res = await request(app).get("/api/occasions");
      expect(res.status).toBe(200);
      const slugs = res.body.occasions.map((o: { slug: string }) => o.slug);
      expect(slugs).toEqual(
        expect.arrayContaining(["birthday", "wedding", "bridal", "graduation"]),
      );
      expect(res.body.occasions[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("access", () => {
    it("requires sign-in", async () => {
      expect((await request(app).get("/api/creations")).status).toBe(401);
      expect((await request(app).post("/api/creations").send({})).status).toBe(401);
    });

    it.each(["CUSTOMER", "ADMIN"] as const)("is closed to %s accounts", async (role) => {
      const user = await actor(role);
      expect((await request(app).get("/api/creations").set(bearer(user))).status).toBe(403);
    });

    it("needs a registered business", async () => {
      const seller = await actor("SELLER");
      const res = await request(app).get("/api/creations").set(bearer(seller));
      expect(res.status).toBe(404);
    });

    it.each(["DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED"] as const)(
      "requires an approved business (not %s)",
      async (status) => {
        const owner = await sellerWithBusiness({ status });
        const res = await create(owner);
        expect(res.status).toBe(403);
        expect(await prisma.creation.count()).toBe(0);
      },
    );

    it("never lets responses be cached", async () => {
      const owner = await sellerWithBusiness();
      const res = await request(app).get("/api/creations").set(bearer(owner.seller));
      expect(res.headers["cache-control"]).toBe("private, no-store");
    });
  });

  describe("creating a draft", () => {
    it("saves an unpublished draft that belongs to the seller's business", async () => {
      const owner = await sellerWithBusiness();
      const res = await create(owner);
      expect(res.status).toBe(201);

      const stored = await prisma.creation.findUniqueOrThrow({
        where: { id: res.body.creationId },
        include: { revisions: true },
      });
      expect(stored).toMatchObject({
        businessId: owner.businessId,
        status: "DRAFT",
        publishedRevisionId: null,
        publishedAt: null,
      });
      expect(stored.revisions).toHaveLength(1);
      expect(stored.revisions[0]).toMatchObject({ version: 1, status: "DRAFT" });
    });

    it("ignores client-supplied status, owner and publication fields", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const res = await create(owner, {
        status: "APPROVED",
        businessId: other.businessId,
        publishedRevisionId: randomUUID(),
        publishedAt: new Date().toISOString(),
      });
      expect(res.status).toBe(201);
      const stored = await prisma.creation.findUniqueOrThrow({
        where: { id: res.body.creationId },
      });
      expect(stored).toMatchObject({ businessId: owner.businessId, status: "DRAFT" });
      expect(stored.publishedRevisionId).toBeNull();
    });

    it("stays private until it is approved", async () => {
      const owner = await sellerWithBusiness();
      await create(owner);
      const feed = await request(app).get("/api/public/creations");
      expect(feed.body.items).toEqual([]);
    });

    it("allows creations without an occasion", async () => {
      const owner = await sellerWithBusiness();
      const res = await create(owner, { occasionId: null });
      expect(res.status).toBe(201);
    });

    it.each([
      ["title", ""],
      ["title", "ab"],
      ["description", "too short"],
      ["categoryId", "nope"],
      ["occasionId", "nope"],
    ])("rejects an invalid %s (%s)", async (field, value) => {
      const owner = await sellerWithBusiness();
      const res = await create(owner, { [field]: value });
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields[field]).toBeTruthy();
      expect(await prisma.creation.count()).toBe(0);
    });

    it("rejects categories and occasions that don't exist", async () => {
      const owner = await sellerWithBusiness();
      const res = await create(owner, { categoryId: randomUUID(), occasionId: randomUUID() });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details.fields)).toEqual(["categoryId", "occasionId"]);
    });
  });

  describe("listing and viewing", () => {
    it("lists only the seller's own creations with the allowance used", async () => {
      const a = await sellerWithBusiness();
      const b = await sellerWithBusiness();
      await create(a, { title: "Alpha Cake" });
      await create(a, { title: "Alpha Tart" });
      await create(b, { title: "Beta Cake" });

      const res = await request(app).get("/api/creations").set(bearer(a.seller));
      expect(res.body.creations.map((c: { title: string }) => c.title).sort()).toEqual([
        "Alpha Cake",
        "Alpha Tart",
      ]);
      expect(res.body.usage).toMatchObject({ used: 2, limit: 20, remaining: 18 });
      expect(res.body.creations[0]).toMatchObject({
        status: "DRAFT",
        revisionStatus: "DRAFT",
        hasPublishedVersion: false,
        imageCount: 0,
        cover: null,
      });
    });

    it("shows the working draft, plus the live version for published creations", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = await buildCreation(prisma, {
        businessId: owner.businessId,
        title: "Live Title",
      });
      const res = await request(app).get(`/api/creations/${creationId}`).set(bearer(owner.seller));
      expect(res.status).toBe(200);
      expect(res.body.revision).toMatchObject({ title: "Live Title", status: "APPROVED" });
      expect(res.body.publishedRevision).toBeNull();
      expect(res.body.creation).toMatchObject({
        status: "APPROVED",
        editable: false,
        canStartRevision: true,
      });
    });
  });

  describe("ownership", () => {
    it("hides other sellers' creations completely", async () => {
      const a = await sellerWithBusiness();
      const b = await sellerWithBusiness();
      const { creationId } = (await create(a)).body;

      const get = await request(app).get(`/api/creations/${creationId}`).set(bearer(b.seller));
      const patch = await request(app)
        .patch(`/api/creations/${creationId}`)
        .set(bearer(b.seller))
        .send({ title: "Hijacked title" });
      const archive = await request(app)
        .post(`/api/creations/${creationId}/archive`)
        .set(bearer(b.seller));
      expect([get.status, patch.status, archive.status]).toEqual([404, 404, 404]);

      const stored = await prisma.creation.findUniqueOrThrow({
        where: { id: creationId },
        include: { revisions: true },
      });
      expect(stored.status).toBe("DRAFT");
      expect(stored.revisions[0]!.title).toBe("Floral Birthday Cake");
    });

    it("answers the same for unknown ids, and rejects malformed ones", async () => {
      const owner = await sellerWithBusiness();
      expect(
        (await request(app).get(`/api/creations/${randomUUID()}`).set(bearer(owner.seller))).status,
      ).toBe(404);
      expect((await request(app).get("/api/creations/nope").set(bearer(owner.seller))).status).toBe(
        400,
      );
    });
  });

  describe("editing a draft", () => {
    it("saves partial changes and keeps the rest", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      const res = await request(app)
        .patch(`/api/creations/${creationId}`)
        .set(bearer(owner.seller))
        .send({ title: "Renamed Cake", occasionId: null });
      expect(res.status).toBe(200);
      expect(res.body.revision).toMatchObject({
        title: "Renamed Cake",
        occasion: null,
        description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      });
      expect(res.body.creation.editable).toBe(true);
    });

    it("can move to another category", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      const res = await request(app)
        .patch(`/api/creations/${creationId}`)
        .set(bearer(owner.seller))
        .send({ categoryId: await categoryId("fashion") });
      expect(res.body.revision.category.slug).toBe("fashion");
    });

    it("validates edits", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      const res = await request(app)
        .patch(`/api/creations/${creationId}`)
        .set(bearer(owner.seller))
        .send({ title: "x" });
      expect(res.status).toBe(400);
    });

    it.each(["APPROVED", "PENDING", "SUSPENDED", "ARCHIVED"] as const)(
      "refuses to edit a %s creation in place",
      async (status) => {
        const owner = await sellerWithBusiness();
        const { creationId } = await buildCreation(prisma, {
          businessId: owner.businessId,
          title: "Locked Cake",
          status,
        });
        const res = await request(app)
          .patch(`/api/creations/${creationId}`)
          .set(bearer(owner.seller))
          .send({ title: "Sneaky change" });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("REVISION_LOCKED");
        const revision = await prisma.creationRevision.findFirstOrThrow({ where: { creationId } });
        expect(revision.title).toBe("Locked Cake");
      },
    );

    it("is blocked once the business is suspended", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      await prisma.business.update({
        where: { id: owner.businessId },
        data: { status: "SUSPENDED" },
      });
      const res = await request(app)
        .patch(`/api/creations/${creationId}`)
        .set(bearer(owner.seller))
        .send({ title: "Still editing" });
      expect(res.status).toBe(403);
    });
  });

  describe("archiving", () => {
    it("archives a draft, frees its slot and keeps it out of public view", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      const res = await request(app)
        .post(`/api/creations/${creationId}/archive`)
        .set(bearer(owner.seller));
      expect(res.status).toBe(200);
      expect(res.body.creation.status).toBe("ARCHIVED");

      const list = await request(app).get("/api/creations").set(bearer(owner.seller));
      expect(list.body.usage).toMatchObject({ used: 0, remaining: 20 });
      expect(await prisma.auditLog.count({ where: { action: "creation.archived" } })).toBe(1);
    });

    it("removes a live creation from discovery", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = await buildCreation(prisma, {
        businessId: owner.businessId,
        title: "Live Cake",
      });
      expect((await request(app).get(`/api/public/creations/${creationId}`)).status).toBe(200);

      await request(app).post(`/api/creations/${creationId}/archive`).set(bearer(owner.seller));
      expect((await request(app).get(`/api/public/creations/${creationId}`)).status).toBe(404);
      expect((await request(app).get("/api/public/creations")).body.items).toEqual([]);
    });

    it("cannot be done twice", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = (await create(owner)).body;
      await request(app).post(`/api/creations/${creationId}/archive`).set(bearer(owner.seller));
      const again = await request(app)
        .post(`/api/creations/${creationId}/archive`)
        .set(bearer(owner.seller));
      expect(again.status).toBe(409);
    });
  });
});
