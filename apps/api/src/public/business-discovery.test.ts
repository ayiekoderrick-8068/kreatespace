import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("business profiles in discovery", () => {
  const { app, prisma } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const profile = (slug: string) => request(app).get(`/api/public/businesses/${slug}`);

  it("shows a business's live creations, newest first, attributed to that business", async () => {
    const maria = await buildBusiness(prisma, { name: "Cakes by Maria" });
    const other = await buildBusiness(prisma, { name: "Other Bakes" });
    await buildCreation(prisma, {
      businessId: maria.businessId,
      title: "Older Cake",
      publishedAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await buildCreation(prisma, {
      businessId: maria.businessId,
      title: "Newer Cake",
      publishedAt: new Date(Date.UTC(2026, 0, 2)),
    });
    await buildCreation(prisma, { businessId: other.businessId, title: "Someone Else's Cake" });

    const res = await profile("cakes-by-maria");
    expect(res.status).toBe(200);
    const creations = res.body.business.creations;
    expect(creations.map((c: { title: string }) => c.title)).toEqual(["Newer Cake", "Older Cake"]);
    for (const creation of creations) {
      expect(creation.business).toMatchObject({ slug: "cakes-by-maria", name: "Cakes by Maria" });
    }
    expect(res.body.business.hasMoreCreations).toBe(false);
  });

  it("hides unapproved creations on the profile", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Cakes by Maria" });
    await buildCreation(prisma, { businessId, title: "Live Cake" });
    await buildCreation(prisma, { businessId, title: "Pending Cake", status: "PENDING" });
    await buildCreation(prisma, { businessId, title: "Draft Cake", status: "DRAFT" });
    await buildCreation(prisma, { businessId, title: "Rejected Cake", status: "REJECTED" });
    await buildCreation(prisma, { businessId, title: "Archived Cake", status: "ARCHIVED" });

    const body = (await profile("cakes-by-maria")).body.business;
    expect(body.creations.map((c: { title: string }) => c.title)).toEqual(["Live Cake"]);
  });

  it("lists the business's categories: its own and those of its live creations", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Maria", categorySlug: "cakes" });
    await buildCreation(prisma, { businessId, title: "Cake", categorySlug: "cakes" });
    await buildCreation(prisma, { businessId, title: "Gift Box", categorySlug: "creative-gifts" });
    await buildCreation(prisma, {
      businessId,
      title: "Hidden Flowers",
      categorySlug: "flowers",
      status: "PENDING",
    });

    const categories = (await profile("maria")).body.business.categories.map(
      (c: { slug: string }) => c.slug,
    );
    expect(categories.sort()).toEqual(["cakes", "creative-gifts"]);
  });

  it("works for a new business with no creations yet", async () => {
    await buildBusiness(prisma, { name: "Brand New" });
    const body = (await profile("brand-new")).body.business;
    expect(body.creations).toEqual([]);
    expect(body.hasMoreCreations).toBe(false);
    expect(body.categories).toHaveLength(1);
  });

  it("caps the gallery and says when there is more", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Prolific" });
    for (let i = 0; i < 26; i += 1) {
      await buildCreation(prisma, { businessId, title: `Cake ${i}` });
    }
    const body = (await profile("prolific")).body.business;
    expect(body.creations).toHaveLength(24);
    expect(body.hasMoreCreations).toBe(true);
  });

  it("returns nothing for businesses that are not public, creations included", async () => {
    const suspended = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });
    await buildCreation(prisma, { businessId: suspended.businessId, title: "Cake" });
    const pending = await buildBusiness(prisma, { name: "Pending Co", status: "PENDING" });
    await buildCreation(prisma, { businessId: pending.businessId, title: "Cake" });
    expect((await profile("suspended-co")).status).toBe(404);
    expect((await profile("pending-co")).status).toBe(404);
  });

  it("links every creation card to the one real business record", async () => {
    const { businessId } = await buildBusiness(prisma, { name: "Cakes by Maria" });
    const a = await buildCreation(prisma, { businessId, title: "A" });
    const b = await buildCreation(prisma, { businessId, title: "B" });
    expect(await prisma.business.count()).toBe(1);
    for (const id of [a.creationId, b.creationId]) {
      const detail = await request(app).get(`/api/public/creations/${id}`);
      expect(detail.body.creation.business.slug).toBe("cakes-by-maria");
    }
  });
});
