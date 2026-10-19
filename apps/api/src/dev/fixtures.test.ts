import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";
import { FIXTURE_SLUG_PREFIX, removeDevFixtures, seedDevFixtures } from "./fixtures.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("development fixtures", () => {
  const { app, prisma } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it("adds clearly labelled placeholder content that appears in discovery", async () => {
    const result = await seedDevFixtures(prisma);
    expect(result).toMatchObject({ businesses: 4, creations: 16, skipped: 0 });

    const feed = await request(app).get("/api/public/creations").query({ pageSize: 48 });
    expect(feed.body.items).toHaveLength(16);
    for (const item of feed.body.items) {
      expect(item.title).toMatch(/^Sample /);
      expect(item.business.name).toMatch(/^Dev Fixture/);
      expect(item.image.url).toMatch(/^\/dev-fixtures\/sample-\d\.svg$/);
    }

    const detail = await request(app).get(`/api/public/creations/${feed.body.items[0].id}`);
    expect(detail.body.creation.description).toMatch(/^Development fixture:/);
  });

  it("covers every discovery path: categories, occasions and several counties", async () => {
    await seedDevFixtures(prisma);
    const home = (await request(app).get("/api/public/home")).body;
    const withContent = home.categories.filter((c: { count: number }) => c.count > 0);
    expect(withContent.length).toBeGreaterThanOrEqual(6);
    const wedding = await request(app).get("/api/public/creations").query({ occasion: "wedding" });
    expect(wedding.body.items.length).toBeGreaterThanOrEqual(3);
    const counties = new Set(
      (await request(app).get("/api/public/creations").query({ pageSize: 48 })).body.items.map(
        (i: { business: { county: string } }) => i.business.county,
      ),
    );
    expect(counties.size).toBe(4);
  });

  it("is safe to run twice", async () => {
    await seedDevFixtures(prisma);
    const second = await seedDevFixtures(prisma);
    expect(second).toMatchObject({ businesses: 0, creations: 0, skipped: 4 });
    expect(await prisma.business.count()).toBe(4);
  });

  it("can be removed completely, leaving real data alone", async () => {
    await seedDevFixtures(prisma);
    const { buildBusiness, buildCreation } = await import("./builders.js");
    const real = await buildBusiness(prisma, { name: "A Real Business" });
    await buildCreation(prisma, { businessId: real.businessId, title: "Real Cake" });

    expect(await removeDevFixtures(prisma)).toBe(4);
    expect(
      await prisma.business.count({ where: { slug: { startsWith: FIXTURE_SLUG_PREFIX } } }),
    ).toBe(0);
    const feed = await request(app).get("/api/public/creations");
    expect(feed.body.items.map((i: { title: string }) => i.title)).toEqual(["Real Cake"]);
  });
});
