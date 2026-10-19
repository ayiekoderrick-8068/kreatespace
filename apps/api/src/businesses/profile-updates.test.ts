import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  createTestHarness,
  skippedHarness,
  hasDatabase,
  resetDatabase,
} from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("moderated business profile updates", () => {
  const { app, prisma, actor, files, submittedBusiness, uploadImage } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  const decide = (
    admin: Awaited<ReturnType<typeof actor>>,
    businessId: string,
    body: Record<string, unknown>,
  ) =>
    request(app).post(`/api/admin/businesses/${businessId}/decision`).set(bearer(admin)).send(body);

  async function approved() {
    const owner = await actor("SELLER");
    const admin = await actor("ADMIN");
    const businessId = await submittedBusiness(owner, { businessName: "Cakes by Maria" });
    await decide(admin, businessId, { action: "APPROVE" });
    return { owner, admin, businessId };
  }

  const publishedName = async (businessId: string) => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: { publishedRevision: true },
    });
    return business.publishedRevision?.businessName;
  };

  it("starts an editable copy of the published profile", async () => {
    const { owner } = await approved();
    const res = await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    expect(res.status).toBe(201);
    expect(res.body.business.status).toBe("APPROVED");
    expect(res.body.revision).toMatchObject({
      version: 2,
      status: "DRAFT",
      businessName: "Cakes by Maria",
      termsAccepted: true,
    });
    expect(res.body.revision.images).toHaveLength(1);
    expect(res.body.publishedRevision.version).toBe(1);
  });

  it("only one update can be in progress", async () => {
    const { owner } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    const again = await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CANNOT_START_REVISION");
    expect(await prisma.businessRevision.count()).toBe(2);
  });

  it("is unavailable until the business has been approved", async () => {
    const owner = await actor("SELLER");
    await submittedBusiness(owner);
    const res = await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    expect(res.status).toBe(409);
  });

  it("keeps the old profile live while an edit is drafted and pending", async () => {
    const { owner, businessId } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    const patch = await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ businessName: "Maria's Luxury Cakes" });
    expect(patch.status).toBe(200);
    expect(await publishedName(businessId)).toBe("Cakes by Maria");

    const submit = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
    expect(submit.status).toBe(200);
    expect(submit.body.business.status).toBe("APPROVED");
    expect(submit.body.revision.status).toBe("PENDING");
    expect(await publishedName(businessId)).toBe("Cakes by Maria");

    const edit = await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ city: "Elsewhere" });
    expect(edit.status).toBe(409);
  });

  it("replaces the published profile only once an admin approves the update", async () => {
    const { owner, admin, businessId } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ businessName: "Maria's Luxury Cakes" });
    await request(app).post("/api/businesses/me/submit").set(bearer(owner));

    const queue = await request(app)
      .get("/api/admin/businesses")
      .query({ status: "PENDING" })
      .set(bearer(admin));
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ status: "APPROVED", hasPendingSubmission: true });

    const detail = await request(app).get(`/api/admin/businesses/${businessId}`).set(bearer(admin));
    expect(detail.body.reviewRevision.businessName).toBe("Maria's Luxury Cakes");
    expect(detail.body.publishedRevision.businessName).toBe("Cakes by Maria");

    const res = await decide(admin, businessId, { action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(await publishedName(businessId)).toBe("Maria's Luxury Cakes");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).status).toBe(
      "APPROVED",
    );
  });

  it("never publishes a rejected update and lets the seller try again", async () => {
    const { owner, admin, businessId } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ businessName: "Totally Different Name" });
    await request(app).post("/api/businesses/me/submit").set(bearer(owner));

    const res = await decide(admin, businessId, {
      action: "REJECT",
      reason: "The new name is confusing for customers.",
    });
    expect(res.body.business.status).toBe("APPROVED");
    expect(await publishedName(businessId)).toBe("Cakes by Maria");

    const me = await request(app).get("/api/businesses/me").set(bearer(owner));
    expect(me.body.revision).toMatchObject({
      status: "REJECTED",
      businessName: "Totally Different Name",
    });
    expect(me.body.publishedRevision.businessName).toBe("Cakes by Maria");
    expect(me.body.decisions[0]).toMatchObject({ action: "REJECTED" });

    const retry = await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    expect(retry.status).toBe(201);
    expect(retry.body.revision).toMatchObject({ version: 3, businessName: "Cakes by Maria" });
  });

  it("returns an update for changes without touching the live profile", async () => {
    const { owner, admin, businessId } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    await request(app).patch("/api/businesses/me").set(bearer(owner)).send({ city: "Mombasa" });
    await request(app).post("/api/businesses/me/submit").set(bearer(owner));
    await decide(admin, businessId, {
      action: "REQUEST_CHANGES",
      reason: "Please also update your county to match the city.",
    });

    const me = await request(app).get("/api/businesses/me").set(bearer(owner));
    expect(me.body.revision.status).toBe("CHANGES_REQUESTED");
    const live = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: { publishedRevision: true },
    });
    expect(live.publishedRevision?.city).toBe("Westlands");

    await request(app).patch("/api/businesses/me").set(bearer(owner)).send({ county: "Mombasa" });
    expect((await request(app).post("/api/businesses/me/submit").set(bearer(owner))).status).toBe(
      200,
    );
  });

  it("lets an update bring in new photos", async () => {
    const { owner, admin, businessId } = await approved();
    await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    const extra = await uploadImage(owner);
    const current = await request(app).get("/api/businesses/me").set(bearer(owner));
    const paths = [...current.body.revision.images.map((i: { path: string }) => i.path), extra];
    await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ portfolioPaths: paths });
    await request(app).post("/api/businesses/me/submit").set(bearer(owner));
    await decide(admin, businessId, { action: "APPROVE" });

    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      include: { publishedRevision: { include: { images: true } } },
    });
    expect(business.publishedRevision?.images).toHaveLength(2);
  });

  it("is unavailable while suspended", async () => {
    const { owner, admin, businessId } = await approved();
    await decide(admin, businessId, {
      action: "SUSPEND",
      reason: "Under investigation by admins.",
    });
    const res = await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
    expect(res.status).toBe(409);
  });

  it("keeps the database constraint that only one revision is open per business", async () => {
    const { businessId } = await approved();
    const published = await prisma.businessRevision.findFirstOrThrow({ where: { businessId } });
    const base = {
      businessId,
      businessName: "X Co",
      ownerName: "Owner",
      description: "A long enough description for the revision.",
      categoryId: published.categoryId,
      county: "Nairobi",
      city: "Nairobi",
      whatsappNumber: "+254712345678",
    };
    await prisma.businessRevision.create({ data: { ...base, version: 2 } });
    await expect(
      prisma.businessRevision.create({ data: { ...base, version: 3 } }),
    ).rejects.toThrow();
  });
});
