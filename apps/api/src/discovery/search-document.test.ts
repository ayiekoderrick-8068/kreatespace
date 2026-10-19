import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { hasDatabase, resetDatabase, testPrisma } from "../test/harness.js";
import { listCreations } from "./service.js";

/**
 * Search matches a stored document on each creation. Database triggers keep it current, so these
 * tests change the data the way the application does and then search.
 */
describe.skipIf(!hasDatabase)("the stored search document", () => {
  const prisma = hasDatabase ? testPrisma() : null!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await resetDatabase(prisma);
  });

  const search = async (q: string) =>
    (await listCreations(prisma, undefined, { q, page: 1, pageSize: 20 })).items.map(
      (item) => item.title,
    );
  const documentOf = async (creationId: string) =>
    (
      await prisma.$queryRaw<{ doc: string | null }[]>`
        SELECT "searchDocument"::text AS doc FROM "creations" WHERE "id" = ${creationId}::uuid`
    )[0]!.doc;

  it("is filled in when a creation is published and finds it by title, business and category", async () => {
    const business = await buildBusiness(prisma, { name: "Sweet Crumbs", categorySlug: "cakes" });
    const { creationId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Lemon drizzle",
      description: "Zesty and moist.",
      categorySlug: "cakes",
      occasionSlug: "birthday",
    });
    const doc = await documentOf(creationId);
    expect(doc).toContain("lemon");
    expect(doc).toContain("crumb");
    expect(doc).toContain("birthday");
    expect(await search("lemon")).toEqual(["Lemon drizzle"]);
    expect(await search("crumbs")).toEqual(["Lemon drizzle"]);
    expect(await search("birthday")).toEqual(["Lemon drizzle"]);
    expect(await search("moist")).toEqual(["Lemon drizzle"]);
  });

  it("is empty for a creation that is not published, which therefore never matches", async () => {
    const business = await buildBusiness(prisma, { name: "Quiet Bakery" });
    const { creationId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Secret draft cake",
      status: "PENDING",
    });
    expect(await documentOf(creationId)).toBeNull();
    expect(await search("secret")).toEqual([]);
  });

  it("follows a business that is approved after its creations were added", async () => {
    const business = await buildBusiness(prisma, { name: "Late Bloomer", status: "PENDING" });
    const { creationId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Rose cake",
    });
    expect(await documentOf(creationId)).not.toContain("bloomer");
    await prisma.business.update({
      where: { id: business.businessId },
      data: { status: "APPROVED", publishedRevisionId: business.revisionId },
    });
    expect(await documentOf(creationId)).toContain("bloomer");
    expect(await search("bloomer")).toEqual(["Rose cake"]);
  });

  it("follows a business that is renamed through a newly approved revision", async () => {
    const business = await buildBusiness(prisma, { name: "Old Name Bakery" });
    const { creationId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Honey cake",
    });
    const first = await prisma.businessRevision.findUniqueOrThrow({
      where: { id: business.revisionId },
    });
    const second = await prisma.businessRevision.create({
      data: {
        businessId: business.businessId,
        version: 2,
        status: "APPROVED",
        businessName: "Fresh Name Bakery",
        ownerName: first.ownerName,
        description: first.description,
        categoryId: first.categoryId,
        county: first.county,
        city: first.city,
        whatsappNumber: first.whatsappNumber,
      },
    });
    await prisma.business.update({
      where: { id: business.businessId },
      data: { publishedRevisionId: second.id },
    });
    expect(await search("fresh")).toEqual(["Honey cake"]);
    expect(await search("old")).toEqual([]);
    expect(await documentOf(creationId)).not.toContain("old");
  });

  it("follows a published revision that is edited in place, and a creation that moves to a new revision", async () => {
    const business = await buildBusiness(prisma, { name: "Edits Bakery" });
    const { creationId, revisionId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Plain scone",
      description: "A scone.",
    });
    await prisma.creationRevision.update({
      where: { id: revisionId },
      data: { title: "Cinnamon scone" },
    });
    expect(await search("cinnamon")).toEqual(["Cinnamon scone"]);
    expect(await search("plain")).toEqual([]);

    const next = await prisma.creationRevision.create({
      data: {
        creationId,
        version: 2,
        status: "APPROVED",
        title: "Raisin scone",
        description: "With raisins.",
        categoryId: (await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } })).id,
      },
    });
    await prisma.creation.update({
      where: { id: creationId },
      data: { publishedRevisionId: next.id },
    });
    expect(await search("raisin")).toEqual(["Raisin scone"]);
    expect(await search("cinnamon")).toEqual([]);
  });

  it("follows a renamed category and a renamed occasion", async () => {
    const business = await buildBusiness(prisma, { name: "Names Bakery" });
    await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Tiered cake",
      categorySlug: "cakes",
      occasionSlug: "wedding",
    });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { slug: "wedding" } });
    try {
      await prisma.category.update({ where: { id: category.id }, data: { name: "Confectionery" } });
      await prisma.occasion.update({ where: { id: occasion.id }, data: { name: "Nuptials" } });
      expect(await search("confectionery")).toEqual(["Tiered cake"]);
      expect(await search("nuptials")).toEqual(["Tiered cake"]);
    } finally {
      await prisma.category.update({ where: { id: category.id }, data: { name: category.name } });
      await prisma.occasion.update({ where: { id: occasion.id }, data: { name: occasion.name } });
    }
  });

  it("still finds partial words and whole words as before", async () => {
    const business = await buildBusiness(prisma, { name: "Rank Bakery" });
    await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Chocolate fudge",
      description: "Rich.",
    });
    await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Vanilla sponge",
      description: "Served with chocolate sauce.",
    });
    expect(await search("choc")).toContain("Chocolate fudge");
    expect((await search("chocolate")).sort()).toEqual(["Chocolate fudge", "Vanilla sponge"]);
  });

  it("matches what the old, computed-on-every-search document would have held", async () => {
    const business = await buildBusiness(prisma, { name: "Same As Before" });
    for (const title of ["One", "Two", "Three"]) {
      await buildCreation(prisma, {
        businessId: business.businessId,
        title: `${title} layer cake`,
        occasionSlug: "birthday",
      });
    }
    const mismatches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id"
      FROM "creations" c
      JOIN "creation_revisions" cr ON cr."id" = c."publishedRevisionId"
      JOIN "businesses" b ON b."id" = c."businessId"
      JOIN "business_revisions" br ON br."id" = b."publishedRevisionId"
      JOIN "categories" cat ON cat."id" = cr."categoryId"
      LEFT JOIN "occasions" o ON o."id" = cr."occasionId"
      WHERE c."searchDocument" IS DISTINCT FROM to_tsvector('english',
        cr."title" || ' ' || cr."description" || ' ' || br."businessName" || ' ' || cat."name" || ' ' || coalesce(o."name", ''))`;
    expect(mismatches).toEqual([]);
  });
});
