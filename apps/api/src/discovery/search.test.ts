import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, skippedHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("discovery search and filters", () => {
  const { app, prisma } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const feed = (query: Record<string, string | number> = {}) =>
    request(app).get("/api/public/creations").query(query);
  const titles = async (query: Record<string, string | number>) =>
    ((await feed(query)).body.items as { title: string }[]).map((i) => i.title).sort();

  async function seedCatalogue() {
    const maria = await buildBusiness(prisma, {
      name: "Cakes by Maria",
      county: "Kisumu",
      city: "Milimani",
    });
    const glow = await buildBusiness(prisma, {
      name: "Glow Studio",
      county: "Nairobi",
      city: "Westlands",
      categorySlug: "beauty",
    });
    const lens = await buildBusiness(prisma, {
      name: "Lens & Light",
      county: "Mombasa",
      city: "Nyali",
      categorySlug: "photography",
    });
    const bloom = await buildBusiness(prisma, {
      name: "Bloom Decor",
      county: "Kisumu",
      city: "Kisumu",
      categorySlug: "event-decor",
    });

    await buildCreation(prisma, {
      businessId: maria.businessId,
      title: "Floral Birthday Cake",
      description: "Three-tier vanilla sponge with sugar flowers.",
      occasionSlug: "birthday",
    });
    await buildCreation(prisma, {
      businessId: maria.businessId,
      title: "Naked Wedding Cake",
      description: "Rustic semi-naked cake with fresh berries.",
      occasionSlug: "wedding",
    });
    await buildCreation(prisma, {
      businessId: glow.businessId,
      title: "Soft Glam Bridal Makeup",
      description: "Long-lasting bridal makeup for your big day.",
      categorySlug: "beauty",
      occasionSlug: "bridal",
    });
    await buildCreation(prisma, {
      businessId: lens.businessId,
      title: "Garden Wedding Photography",
      description: "Candid wedding photographers capture every moment.",
      categorySlug: "photography",
      occasionSlug: "wedding",
    });
    await buildCreation(prisma, {
      businessId: bloom.businessId,
      title: "Graduation Backdrop",
      description: "Balloon and flower backdrop for graduation parties.",
      categorySlug: "event-decor",
      occasionSlug: "graduation",
    });
    return { maria, glow, lens, bloom };
  }

  describe("search", () => {
    it("finds creations by title words", async () => {
      await seedCatalogue();
      expect(await titles({ q: "birthday" })).toEqual(["Floral Birthday Cake"]);
    });

    it("matches word forms, so 'cakes' finds cake listings", async () => {
      await seedCatalogue();
      expect(await titles({ q: "cakes" })).toEqual(["Floral Birthday Cake", "Naked Wedding Cake"]);
    });

    it("answers everyday multi-word searches", async () => {
      await seedCatalogue();
      expect(await titles({ q: "birthday cakes" })).toEqual(["Floral Birthday Cake"]);
      expect(await titles({ q: "bridal makeup" })).toEqual(["Soft Glam Bridal Makeup"]);
      expect(await titles({ q: "wedding photographers" })).toEqual(["Garden Wedding Photography"]);
      expect(await titles({ q: "graduation" })).toEqual(["Graduation Backdrop"]);
    });

    it("searches descriptions", async () => {
      await seedCatalogue();
      expect(await titles({ q: "vanilla sponge" })).toEqual(["Floral Birthday Cake"]);
      expect(await titles({ q: "balloon" })).toEqual(["Graduation Backdrop"]);
    });

    it("searches business names, categories and occasions", async () => {
      await seedCatalogue();
      expect(await titles({ q: "Glow Studio" })).toEqual(["Soft Glam Bridal Makeup"]);
      expect(await titles({ q: "photography" })).toEqual(["Garden Wedding Photography"]);
      expect(await titles({ q: "event decor" })).toEqual(["Graduation Backdrop"]);
      expect(await titles({ q: "wedding" })).toEqual([
        "Garden Wedding Photography",
        "Naked Wedding Cake",
      ]);
    });

    it("matches partial words while typing", async () => {
      await seedCatalogue();
      expect(await titles({ q: "birthd" })).toEqual(["Floral Birthday Cake"]);
      expect(await titles({ q: "mari" })).toEqual(["Floral Birthday Cake", "Naked Wedding Cake"]);
    });

    it("ignores case and surrounding spaces", async () => {
      await seedCatalogue();
      expect(await titles({ q: "  BIRTHDAY  " })).toEqual(["Floral Birthday Cake"]);
    });

    it("returns an empty list, not an error, when nothing matches", async () => {
      await seedCatalogue();
      const res = await feed({ q: "submarine" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [], hasMore: false });
    });

    it("treats an empty search as no search", async () => {
      await seedCatalogue();
      expect((await feed({ q: "" })).body.items).toHaveLength(5);
    });

    it("never returns unapproved content, even when it matches", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria" });
      await buildCreation(prisma, { businessId, title: "Secret Pending Cake", status: "PENDING" });
      await buildCreation(prisma, {
        businessId,
        title: "Secret Rejected Cake",
        status: "REJECTED",
      });
      const hidden = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });
      await buildCreation(prisma, {
        businessId: hidden.businessId,
        title: "Secret Suspended Cake",
      });
      expect(await titles({ q: "secret" })).toEqual([]);
      expect(await titles({ q: "suspended" })).toEqual([]);
    });

    it("treats wildcard and SQL characters literally", async () => {
      await seedCatalogue();
      expect(await titles({ q: "%" })).toEqual([]);
      expect(await titles({ q: "_____" })).toEqual([]);
      const injection = await feed({ q: "'; DROP TABLE creations; --" });
      expect(injection.status).toBe(200);
      expect((await feed()).body.items).toHaveLength(5);
    });

    it("rejects overly long searches", async () => {
      expect((await feed({ q: "x".repeat(101) })).status).toBe(400);
    });

    it("ranks closer matches first and still paginates", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria" });
      await buildCreation(prisma, {
        businessId,
        title: "Chocolate Cake",
        description: "Rich cake. Chocolate cake with chocolate ganache.",
        publishedAt: new Date(Date.UTC(2026, 0, 1)),
      });
      await buildCreation(prisma, {
        businessId,
        title: "Lemon Tart",
        description: "A zesty tart finished with a little chocolate.",
        publishedAt: new Date(Date.UTC(2026, 0, 2)),
      });
      const res = await feed({ q: "chocolate", pageSize: 1 });
      expect(res.body.items[0].title).toBe("Chocolate Cake");
      expect(res.body.hasMore).toBe(true);
    });
  });

  describe("filters", () => {
    it("filters by category", async () => {
      await seedCatalogue();
      expect(await titles({ category: "cakes" })).toEqual([
        "Floral Birthday Cake",
        "Naked Wedding Cake",
      ]);
      expect(await titles({ category: "beauty" })).toEqual(["Soft Glam Bridal Makeup"]);
    });

    it("filters by occasion", async () => {
      await seedCatalogue();
      expect(await titles({ occasion: "wedding" })).toEqual([
        "Garden Wedding Photography",
        "Naked Wedding Cake",
      ]);
    });

    it("filters by county and by city", async () => {
      await seedCatalogue();
      expect(await titles({ county: "Kisumu" })).toEqual([
        "Floral Birthday Cake",
        "Graduation Backdrop",
        "Naked Wedding Cake",
      ]);
      expect(await titles({ county: "Kisumu", city: "milimani" })).toEqual([
        "Floral Birthday Cake",
        "Naked Wedding Cake",
      ]);
    });

    it("combines category, county and occasion", async () => {
      await seedCatalogue();
      expect(await titles({ category: "cakes", county: "Kisumu", occasion: "wedding" })).toEqual([
        "Naked Wedding Cake",
      ]);
      expect(await titles({ category: "cakes", county: "Nairobi" })).toEqual([]);
    });

    it("combines search with filters", async () => {
      await seedCatalogue();
      expect(await titles({ q: "wedding", category: "photography" })).toEqual([
        "Garden Wedding Photography",
      ]);
      expect(await titles({ q: "wedding", county: "Mombasa", city: "Nyali" })).toEqual([
        "Garden Wedding Photography",
      ]);
      expect(await titles({ q: "wedding", county: "Nairobi" })).toEqual([]);
    });

    it("ignores blank filters", async () => {
      await seedCatalogue();
      expect(
        (await feed({ category: "", county: "", occasion: "", city: "" })).body.items,
      ).toHaveLength(5);
    });

    it("rejects unknown counties and malformed slugs", async () => {
      expect((await feed({ county: "Atlantis" })).status).toBe(400);
      expect((await feed({ category: "Not A Slug!" })).status).toBe(400);
    });

    it("returns nothing for an unknown category or occasion slug", async () => {
      await seedCatalogue();
      expect(await titles({ category: "unicorns" })).toEqual([]);
    });

    it("filters by the business's published location, not a pending edit", async () => {
      const { businessId } = await buildBusiness(prisma, { name: "Maria", county: "Kisumu" });
      await buildCreation(prisma, { businessId, title: "Cake" });
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
      await prisma.businessRevision.create({
        data: {
          businessId,
          version: 2,
          status: "PENDING",
          businessName: "Maria",
          ownerName: "Owner",
          description: "A pending relocation that is not public yet.",
          categoryId: category.id,
          county: "Nairobi",
          city: "Nairobi",
          whatsappNumber: "+254700000000",
        },
      });
      expect(await titles({ county: "Nairobi" })).toEqual([]);
      expect(await titles({ county: "Kisumu" })).toEqual(["Cake"]);
    });
  });

  describe("filter options", () => {
    it("lists the creative categories and occasions", async () => {
      const res = await request(app).get("/api/public/filters");
      const categories = res.body.categories.map((c: { name: string }) => c.name);
      expect(categories).toEqual([
        "Cakes",
        "Fashion",
        "Beauty",
        "Photography",
        "Event Decor",
        "Flowers",
        "Creative Gifts",
        "Other",
      ]);
      expect(res.body.occasions.map((o: { slug: string }) => o.slug)).toEqual(
        expect.arrayContaining(["birthday", "wedding", "bridal", "graduation"]),
      );
    });

    it("lists only cities that have visible creations in a county", async () => {
      await seedCatalogue();
      const hidden = await buildBusiness(prisma, {
        name: "Hidden",
        county: "Kisumu",
        city: "Secretville",
        status: "PENDING",
      });
      await buildCreation(prisma, { businessId: hidden.businessId, title: "Hidden Cake" });
      const res = await request(app).get("/api/public/cities").query({ county: "Kisumu" });
      expect(res.body.cities).toEqual(["Kisumu", "Milimani"]);
      expect(
        (await request(app).get("/api/public/cities").query({ county: "Atlantis" })).status,
      ).toBe(400);
    });
  });
});
