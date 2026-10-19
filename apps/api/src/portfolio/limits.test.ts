import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCreation } from "../dev/builders.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("portfolio limits", () => {
  const { app, prisma, sellerWithBusiness } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const categoryId = async () =>
    (await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } })).id;

  async function body(title: string) {
    return {
      title,
      description: "A lovely made-to-order creation with plenty of care taken.",
      categoryId: await categoryId(),
    };
  }

  type Owner = Awaited<ReturnType<typeof sellerWithBusiness>>;
  const post = async (owner: Owner, title: string) =>
    request(app)
      .post("/api/creations")
      .set(bearer(owner.seller))
      .send(await body(title));

  async function fill(
    owner: Owner,
    count: number,
    status: "DRAFT" | "APPROVED" | "ARCHIVED" = "DRAFT",
  ) {
    for (let i = 0; i < count; i += 1) {
      await buildCreation(prisma, { businessId: owner.businessId, title: `Filler ${i}`, status });
    }
  }

  it("allows exactly 20 active creations and shows the allowance", async () => {
    const owner = await sellerWithBusiness();
    await fill(owner, 19);
    const twentieth = await post(owner, "Number twenty");
    expect(twentieth.status).toBe(201);

    const list = await request(app).get("/api/creations").set(bearer(owner.seller));
    expect(list.body.usage).toMatchObject({ used: 20, limit: 20, remaining: 0 });

    const over = await post(owner, "Number twenty-one");
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("CREATION_LIMIT_REACHED");
    expect(over.body.error.message).toMatch(/20 free creations/);
    expect(await prisma.creation.count({ where: { businessId: owner.businessId } })).toBe(20);
  });

  it("counts drafts, pending, published, rejected and suspended creations as active", async () => {
    const owner = await sellerWithBusiness();
    for (const status of [
      "DRAFT",
      "PENDING",
      "CHANGES_REQUESTED",
      "APPROVED",
      "REJECTED",
      "SUSPENDED",
    ] as const) {
      await buildCreation(prisma, { businessId: owner.businessId, title: status, status });
    }
    const list = await request(app).get("/api/creations").set(bearer(owner.seller));
    expect(list.body.usage.used).toBe(6);
  });

  it("does not count archived creations, and archiving frees a slot", async () => {
    const owner = await sellerWithBusiness();
    await fill(owner, 20);
    expect((await post(owner, "Blocked")).status).toBe(409);

    const first = await prisma.creation.findFirstOrThrow({
      where: { businessId: owner.businessId },
    });
    await request(app).post(`/api/creations/${first.id}/archive`).set(bearer(owner.seller));
    expect((await post(owner, "Fits now")).status).toBe(201);

    const archivedOnly = await sellerWithBusiness();
    await fill(archivedOnly, 25, "ARCHIVED");
    expect((await post(archivedOnly, "Still welcome")).status).toBe(201);
  });

  it("applies the limit per business", async () => {
    const full = await sellerWithBusiness();
    const other = await sellerWithBusiness();
    await fill(full, 20);
    expect((await post(full, "Over")).status).toBe(409);
    expect((await post(other, "Fine")).status).toBe(201);
  });

  it("cannot be beaten by simultaneous requests", async () => {
    const owner = await sellerWithBusiness();
    await fill(owner, 12);
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => post(owner, `Parallel ${i}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(8);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.creation.count({ where: { businessId: owner.businessId } })).toBe(20);
  });

  it("is also enforced by the database itself, whatever code writes to it", async () => {
    const owner = await sellerWithBusiness();
    await fill(owner, 20);
    await expect(
      buildCreation(prisma, { businessId: owner.businessId, title: "Sneaks past the API" }),
    ).rejects.toThrow(/creation_limit_reached/);
    expect(await prisma.creation.count({ where: { businessId: owner.businessId } })).toBe(20);
  });

  it("stops an archived creation from being restored beyond the limit", async () => {
    const owner = await sellerWithBusiness();
    const { creationId } = await buildCreation(prisma, {
      businessId: owner.businessId,
      title: "Archived one",
      status: "ARCHIVED",
    });
    await fill(owner, 20);
    await expect(
      prisma.creation.update({ where: { id: creationId }, data: { status: "DRAFT" } }),
    ).rejects.toThrow(/creation_limit_reached/);
  });

  it("does not stop ordinary status changes on a full portfolio", async () => {
    const owner = await sellerWithBusiness();
    await fill(owner, 20);
    const some = await prisma.creation.findFirstOrThrow({
      where: { businessId: owner.businessId },
    });
    await prisma.creation.update({ where: { id: some.id }, data: { status: "PENDING" } });
    await prisma.creation.update({ where: { id: some.id }, data: { status: "ARCHIVED" } });
  });
});
