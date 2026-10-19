import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, skippedHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("public creation visibility", () => {
  const { app, prisma } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const feed = (query: Record<string, string | number> = {}) =>
    request(app).get("/api/public/creations").query(query);
  const titles = (res: request.Response) => res.body.items.map((i: { title: string }) => i.title);

  it("shows an approved creation of an approved business to anyone", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Cakes by Maria" });
    await buildCreation(prisma, { businessId, title: "Floral Birthday Cake" });

    const res = await feed();
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      title: "Floral Birthday Cake",
      category: { slug: "cakes", name: "Cakes" },
      business: {
        slug: "cakes-by-maria",
        name: "Cakes by Maria",
        county: "Nairobi",
        city: "Westlands",
      },
      image: { url: "/dev-fixtures/sample-1.svg", width: 800, height: 1000 },
    });
    expect(res.headers["cache-control"]).toContain("max-age=30");
  });

  it.each(["DRAFT", "PENDING", "REJECTED", "ARCHIVED"] as const)(
    "hides %s creations",
    async (status) => {
      const { businessId } = await buildBusiness(prisma, { name: "Cakes by Maria" });
      await buildCreation(prisma, { businessId, title: "Hidden Cake", status });
      expect(titles(await feed())).toEqual([]);
    },
  );

  it.each(["DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED"] as const)(
    "hides approved creations while their business is %s",
    async (status) => {
      const { businessId } = await buildBusiness(prisma, { name: "Hidden Bakes", status });
      await buildCreation(prisma, { businessId, title: "Approved But Hidden" });
      expect(titles(await feed())).toEqual([]);
    },
  );

  it("brings creations back when a suspended business is reinstated", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Maria", status: "SUSPENDED" });
    await buildCreation(prisma, { businessId, title: "Back Again" });
    expect(titles(await feed())).toEqual([]);
    await prisma.business.update({ where: { id: businessId }, data: { status: "APPROVED" } });
    expect(titles(await feed())).toEqual(["Back Again"]);
  });

  it("shows only the published revision, never a newer unreviewed one", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Maria" });
    const { creationId, revisionId } = await buildCreation(prisma, {
      businessId,
      title: "Approved Title",
    });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
    await prisma.creationRevision.create({
      data: {
        creationId,
        version: 2,
        status: "PENDING",
        title: "Unreviewed New Title",
        description: "Not approved yet and must stay private.",
        categoryId: category.id,
      },
    });
    expect(titles(await feed())).toEqual(["Approved Title"]);
    const detail = await request(app).get(`/api/public/creations/${creationId}`);
    expect(detail.body.creation.title).toBe("Approved Title");
    expect(revisionId).toBeTruthy();
  });

  it("uses the business's published profile for attribution, not a pending edit", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Original Name" });
    await buildCreation(prisma, { businessId, title: "Cake" });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
    await prisma.businessRevision.create({
      data: {
        businessId,
        version: 2,
        status: "PENDING",
        businessName: "Pending Rename",
        ownerName: "X Owner",
        description: "A pending business edit that is not yet public.",
        categoryId: category.id,
        county: "Kisumu",
        city: "Kisumu",
        whatsappNumber: "+254700000000",
      },
    });
    const res = await feed();
    expect(res.body.items[0].business).toMatchObject({ name: "Original Name", county: "Nairobi" });
  });

  describe("ordering and pagination", () => {
    async function seed(count: number) {
      // A business may only hold 20 active creations, so spread them over several businesses.
      let businessId = "";
      for (let i = 1; i <= count; i += 1) {
        if (i % 10 === 1) {
          businessId = (await buildBusiness(prisma, { name: `Maria ${i}` })).businessId;
        }
        await buildCreation(prisma, {
          businessId,
          title: `Cake ${String(i).padStart(2, "0")}`,
          publishedAt: new Date(Date.UTC(2026, 0, i)),
        });
      }
    }

    it("lists newest first and never loads the whole catalogue", async () => {
      await seed(30);
      const first = await feed({ pageSize: 10 });
      expect(titles(first)).toEqual(
        ["30", "29", "28", "27", "26", "25", "24", "23", "22", "21"].map((n) => `Cake ${n}`),
      );
      expect(first.body).toMatchObject({ page: 1, pageSize: 10, hasMore: true });
    });

    it("pages through without overlap and reports the last page", async () => {
      await seed(25);
      const seen: string[] = [];
      let page = 1;
      for (;;) {
        const res = await feed({ pageSize: 10, page });
        seen.push(...titles(res));
        if (!res.body.hasMore) break;
        page += 1;
      }
      expect(page).toBe(3);
      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
    });

    it("defaults to 24 per page and caps the page size", async () => {
      await seed(30);
      expect((await feed()).body.items).toHaveLength(24);
      expect((await feed({ pageSize: 500 })).status).toBe(400);
    });

    it("returns an empty page beyond the end", async () => {
      await seed(3);
      const res = await feed({ page: 5 });
      expect(res.body).toMatchObject({ items: [], hasMore: false });
    });

    it("rejects invalid paging input", async () => {
      expect((await feed({ page: 0 })).status).toBe(400);
      expect((await feed({ page: "abc" })).status).toBe(400);
    });
  });

  describe("creation detail", () => {
    it("returns everything needed for the page, with business attribution", async () => {
      const { businessId } = await buildBusiness(prisma, {
        name: "Cakes by Maria",
        websiteUrl: "https://cakes-by-maria.vercel.app",
        whatsappNumber: "+254712345678",
      });
      const { creationId } = await buildCreation(prisma, {
        businessId,
        title: "Floral Birthday Cake",
        description: "Three-tier vanilla sponge with sugar flowers.",
        occasionSlug: "birthday",
        images: [
          { path: "dev-fixtures/sample-1.svg", width: 800, height: 1000 },
          { path: "dev-fixtures/sample-2.svg", width: 1000, height: 800 },
        ],
      });

      const res = await request(app).get(`/api/public/creations/${creationId}`);
      expect(res.status).toBe(200);
      expect(res.body.creation).toMatchObject({
        id: creationId,
        title: "Floral Birthday Cake",
        description: "Three-tier vanilla sponge with sugar flowers.",
        category: { slug: "cakes" },
        occasion: { slug: "birthday", name: "Birthday" },
        business: {
          slug: "cakes-by-maria",
          name: "Cakes by Maria",
          city: "Westlands",
          county: "Nairobi",
          websiteUrl: "https://cakes-by-maria.vercel.app",
          whatsappNumber: "+254712345678",
        },
      });
      expect(res.body.creation.images).toHaveLength(2);
      expect(res.body.creation.images[1]).toMatchObject({ width: 1000, height: 800 });
    });

    it("does not invent prices or availability", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Cake" });
      const body = JSON.stringify(
        (await request(app).get(`/api/public/creations/${creationId}`)).body,
      );
      expect(body).not.toMatch(/price|availab|rating|review|stock/i);
    });

    it("exposes no private information", async () => {
      const { businessId, ownerId } = await buildBusiness(prisma, { name: "Maria" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Cake" });
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
      const body = JSON.stringify(
        (await request(app).get(`/api/public/creations/${creationId}`)).body,
      );
      expect(body).not.toContain(owner.email);
      expect(body).not.toContain(ownerId);
      expect(body).not.toContain("Fixture Owner");
    });

    it.each(["DRAFT", "PENDING", "REJECTED", "ARCHIVED"] as const)(
      "returns 404 for a %s creation",
      async (status) => {
        const { businessId } = await buildBusiness(prisma, { name: "Maria" });
        const { creationId } = await buildCreation(prisma, { businessId, title: "Cake", status });
        const res = await request(app).get(`/api/public/creations/${creationId}`);
        expect(res.status).toBe(404);
      },
    );

    it("returns 404 for a suspended business's creation, and for unknown ids", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria", status: "SUSPENDED" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Cake" });
      expect((await request(app).get(`/api/public/creations/${creationId}`)).status).toBe(404);
      expect((await request(app).get(`/api/public/creations/${randomUUID()}`)).status).toBe(404);
      expect((await request(app).get("/api/public/creations/not-a-uuid")).status).toBe(400);
    });
  });
});
