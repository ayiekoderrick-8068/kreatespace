import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("homepage data", () => {
  const { app, prisma } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const home = async () => (await request(app).get("/api/public/home")).body;

  it("is honest when the catalogue is empty: categories only, no invented content", async () => {
    const data = await home();
    expect(data.recent).toEqual([]);
    expect(data.businesses).toEqual([]);
    expect(data.categories.map((c: { name: string }) => c.name)).toEqual([
      "Cakes",
      "Fashion",
      "Beauty",
      "Photography",
      "Event Decor",
      "Flowers",
      "Creative Gifts",
      "Other",
    ]);
    for (const category of data.categories) {
      expect(category).toMatchObject({ count: 0, cover: null });
    }
  });

  it("counts live creations per category and uses the newest as the cover", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Maria" });
    await buildCreation(prisma, {
      businessId,
      title: "Old Cake",
      publishedAt: new Date(Date.UTC(2026, 0, 1)),
      images: [{ path: "dev-fixtures/old.svg", width: 800, height: 800 }],
    });
    await buildCreation(prisma, {
      businessId,
      title: "New Cake",
      publishedAt: new Date(Date.UTC(2026, 0, 2)),
      images: [{ path: "dev-fixtures/new.svg", width: 800, height: 800 }],
    });
    await buildCreation(prisma, { businessId, title: "Pending Cake", status: "PENDING" });
    await buildCreation(prisma, { businessId, title: "Dress", categorySlug: "fashion" });

    const { categories } = await home();
    const cakes = categories.find((c: { slug: string }) => c.slug === "cakes");
    expect(cakes.count).toBe(2);
    expect(cakes.cover.url).toBe("/dev-fixtures/new.svg");
    expect(categories.find((c: { slug: string }) => c.slug === "fashion").count).toBe(1);
    expect(categories.find((c: { slug: string }) => c.slug === "flowers").count).toBe(0);
  });

  it("lists recent live creations, newest first, capped at 12", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Maria" });
    for (let i = 1; i <= 14; i += 1) {
      await buildCreation(prisma, {
        businessId,
        title: `Cake ${i}`,
        publishedAt: new Date(Date.UTC(2026, 0, i)),
      });
    }
    const { recent } = await home();
    expect(recent).toHaveLength(12);
    expect(recent[0].title).toBe("Cake 14");
  });

  it("features real approved businesses with live creations, most recently active first", async () => {
    const older = await buildBusiness(prisma, { name: "Older Bakes" });
    const newer = await buildBusiness(prisma, {
      name: "Newer Bakes",
      county: "Kisumu",
      city: "Kisumu",
    });
    await buildBusiness(prisma, { name: "No Creations Yet" });
    const pending = await buildBusiness(prisma, { name: "Pending Co", status: "PENDING" });
    const suspended = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });

    await buildCreation(prisma, {
      businessId: older.businessId,
      title: "A",
      publishedAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await buildCreation(prisma, {
      businessId: newer.businessId,
      title: "B",
      publishedAt: new Date(Date.UTC(2026, 0, 5)),
    });
    await buildCreation(prisma, {
      businessId: newer.businessId,
      title: "C",
      publishedAt: new Date(Date.UTC(2026, 0, 6)),
    });
    await buildCreation(prisma, { businessId: pending.businessId, title: "Hidden 1" });
    await buildCreation(prisma, { businessId: suspended.businessId, title: "Hidden 2" });

    const { businesses } = await home();
    expect(businesses.map((b: { name: string }) => b.name)).toEqual(["Newer Bakes", "Older Bakes"]);
    expect(businesses[0]).toMatchObject({
      slug: "newer-bakes",
      county: "Kisumu",
      city: "Kisumu",
      categoryName: "Cakes",
      creationCount: 2,
    });
    expect(businesses[0].previews).toHaveLength(2);
  });

  it("limits featured businesses to six", async () => {
    for (let i = 0; i < 8; i += 1) {
      const { businessId } = await buildBusiness(prisma, { name: `Business ${i}` });
      await buildCreation(prisma, { businessId, title: `Cake ${i}` });
    }
    expect((await home()).businesses).toHaveLength(6);
  });

  it("is cacheable for a short time and exposes no private data", async () => {
    const { businessId, ownerId } = await buildBusiness(prisma, { name: "Maria" });
    await buildCreation(prisma, { businessId, title: "Cake" });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const res = await request(app).get("/api/public/home");
    expect(res.headers["cache-control"]).toContain("max-age=30");
    expect(JSON.stringify(res.body)).not.toContain(owner.email);
  });
});
