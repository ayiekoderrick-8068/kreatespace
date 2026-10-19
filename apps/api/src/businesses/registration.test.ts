import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";
import { slugify } from "./service.js";

const harness = hasDatabase ? createTestHarness() : null;

describe("slugify", () => {
  it.each([
    ["Cakes by Maria", "cakes-by-maria"],
    ["  Flowers & Gifts Co.  ", "flowers-and-gifts-co"],
    ["Café Délice", "cafe-delice"],
    ["!!!", "business"],
  ])("turns %s into %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("keeps slugs short", () => {
    expect(slugify("a".repeat(120)).length).toBeLessThanOrEqual(50);
  });
});

describe.skipIf(!hasDatabase)("business registration", () => {
  const { app, prisma, actor, files, businessDetails, categoryId } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  async function seller() {
    return actor("SELLER");
  }

  async function createDraft(owner: Awaited<ReturnType<typeof seller>>, overrides = {}) {
    return request(app)
      .post("/api/businesses")
      .set(bearer(owner))
      .send(await businessDetails(overrides));
  }

  /** Requests an upload target and marks the file as uploaded in the fake storage. */
  async function upload(owner: Awaited<ReturnType<typeof seller>>) {
    const res = await request(app)
      .post("/api/businesses/me/uploads")
      .set(bearer(owner))
      .send({ contentType: "image/jpeg", size: 120_000 });
    expect(res.status).toBe(201);
    files.add(res.body.path);
    return res.body.path as string;
  }

  describe("categories", () => {
    it("lists the seeded categories without authentication", async () => {
      const res = await request(app).get("/api/categories");
      expect(res.status).toBe(200);
      const slugs = res.body.categories.map((c: { slug: string }) => c.slug);
      expect(slugs).toEqual(
        expect.arrayContaining(["cakes", "fashion", "photography", "beauty", "other"]),
      );
    });
  });

  describe("access control", () => {
    it("requires authentication", async () => {
      expect((await request(app).get("/api/businesses/me")).status).toBe(401);
      expect((await request(app).post("/api/businesses").send({})).status).toBe(401);
    });

    it("is closed to customers (a seller invitation is required)", async () => {
      const customer = await actor("CUSTOMER");
      const res = await request(app)
        .post("/api/businesses")
        .set(bearer(customer))
        .send(await businessDetails());
      expect(res.status).toBe(403);
      expect(await prisma.business.count()).toBe(0);
    });

    it("is closed to admins", async () => {
      const admin = await actor("ADMIN");
      expect((await request(app).get("/api/businesses/me").set(bearer(admin))).status).toBe(403);
    });

    it("ignores client-supplied status, owner and role fields", async () => {
      const owner = await seller();
      const res = await createDraft(owner, {
        status: "APPROVED",
        ownerId: randomUUID(),
        role: "ADMIN",
        publishedRevisionId: randomUUID(),
      });
      expect(res.status).toBe(201);
      const business = await prisma.business.findFirstOrThrow();
      expect(business.status).toBe("DRAFT");
      expect(business.ownerId).toBe(owner.id);
      expect(business.publishedRevisionId).toBeNull();
    });
  });

  describe("creating a business", () => {
    it("creates a draft with a generated slug and normalised phone number", async () => {
      const owner = await seller();
      const res = await createDraft(owner);
      expect(res.status).toBe(201);

      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.status).toBe(200);
      expect(me.body.business).toMatchObject({ slug: "cakes-by-maria", status: "DRAFT" });
      expect(me.body.revision).toMatchObject({
        version: 1,
        status: "DRAFT",
        businessName: "Cakes by Maria",
        whatsappNumber: "+254712345678",
        websiteUrl: "https://cakes-by-maria.vercel.app",
        termsAccepted: false,
        contentAuthorized: false,
      });
      expect(me.body.revision.category.slug).toBe("cakes");
      expect(me.body.publishedRevision).toBeNull();
    });

    it("supports businesses without a website", async () => {
      const owner = await seller();
      const res = await createDraft(owner, { websiteUrl: "" });
      expect(res.status).toBe(201);
      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.body.revision.websiteUrl).toBeNull();
    });

    it("gives businesses with the same name distinct slugs", async () => {
      await createDraft(await seller());
      const second = await seller();
      await createDraft(second);
      const slugs = (await prisma.business.findMany()).map((b) => b.slug).sort();
      expect(slugs).toEqual(["cakes-by-maria", "cakes-by-maria-2"]);
    });

    it("allows only one business per seller", async () => {
      const owner = await seller();
      await createDraft(owner);
      const again = await createDraft(owner, { businessName: "Another Name" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("BUSINESS_EXISTS");
    });

    it.each([
      ["businessName", ""],
      ["ownerName", ""],
      ["description", "too short"],
      ["county", "Atlantis"],
      ["city", ""],
      ["whatsappNumber", "12345"],
      ["websiteUrl", "javascript:alert(1)"],
      ["websiteUrl", "not a url"],
      ["categoryId", "not-a-uuid"],
    ])("rejects an invalid %s (%s)", async (field, value) => {
      const owner = await seller();
      const res = await createDraft(owner, { [field]: value });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.fields[field]).toBeTruthy();
      expect(await prisma.business.count()).toBe(0);
    });

    it("rejects missing required fields", async () => {
      const owner = await seller();
      const res = await request(app).post("/api/businesses").set(bearer(owner)).send({});
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details.fields)).toEqual(
        expect.arrayContaining(["businessName", "ownerName", "description", "county", "city"]),
      );
    });

    it("rejects a category that does not exist", async () => {
      const owner = await seller();
      const res = await createDraft(owner, { categoryId: randomUUID() });
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields.categoryId).toBeTruthy();
    });
  });

  describe("isolation between sellers", () => {
    it("shows each seller only their own business", async () => {
      const a = await seller();
      const b = await seller();
      await createDraft(a, { businessName: "Alpha Bakes" });
      await createDraft(b, { businessName: "Beta Blooms" });

      const meA = await request(app).get("/api/businesses/me").set(bearer(a));
      const meB = await request(app).get("/api/businesses/me").set(bearer(b));
      expect(meA.body.revision.businessName).toBe("Alpha Bakes");
      expect(meB.body.revision.businessName).toBe("Beta Blooms");
    });

    it("edits only the caller's business", async () => {
      const a = await seller();
      const b = await seller();
      await createDraft(a, { businessName: "Alpha Bakes" });
      await createDraft(b, { businessName: "Beta Blooms" });

      await request(app).patch("/api/businesses/me").set(bearer(a)).send({ city: "Kisumu" });
      const meB = await request(app).get("/api/businesses/me").set(bearer(b));
      expect(meB.body.revision.city).toBe("Westlands");
    });

    it("refuses images that belong to another seller's folder", async () => {
      const a = await seller();
      const b = await seller();
      await createDraft(a);
      await createDraft(b, { businessName: "Beta Blooms" });
      const foreign = await upload(b);

      const res = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(a))
        .send({ portfolioPaths: [foreign] });
      expect(res.status).toBe(400);
    });

    it("returns 404 when a seller has no business yet", async () => {
      const owner = await seller();
      expect((await request(app).get("/api/businesses/me").set(bearer(owner))).status).toBe(404);
    });
  });

  describe("uploads", () => {
    it("issues a scoped upload target for valid images", async () => {
      const owner = await seller();
      await createDraft(owner);
      const business = await prisma.business.findFirstOrThrow();
      const res = await request(app)
        .post("/api/businesses/me/uploads")
        .set(bearer(owner))
        .send({ contentType: "image/png", size: 1_000_000 });
      expect(res.status).toBe(201);
      expect(res.body.path).toMatch(new RegExp(`^businesses/${business.id}/[0-9a-f-]{36}\\.png$`));
      expect(res.body.uploadUrl).toContain(res.body.path);
    });

    it.each([
      ["application/pdf", 1000],
      ["image/svg+xml", 1000],
      ["text/html", 1000],
      ["image/jpeg", 6 * 1024 * 1024],
      ["image/jpeg", 0],
    ])("rejects %s of %i bytes", async (contentType, size) => {
      const owner = await seller();
      await createDraft(owner);
      const res = await request(app)
        .post("/api/businesses/me/uploads")
        .set(bearer(owner))
        .send({ contentType, size });
      expect(res.status).toBe(400);
    });

    it("requires a registered business", async () => {
      const owner = await seller();
      const res = await request(app)
        .post("/api/businesses/me/uploads")
        .set(bearer(owner))
        .send({ contentType: "image/png", size: 1000 });
      expect(res.status).toBe(404);
    });
  });

  describe("saving a draft and submitting", () => {
    async function readyBusiness() {
      const owner = await seller();
      await createDraft(owner);
      const photo1 = await upload(owner);
      const photo2 = await upload(owner);
      const logo = await upload(owner);
      const res = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({
          portfolioPaths: [photo1, photo2],
          logoPath: logo,
          termsAccepted: true,
          contentAuthorization: true,
        });
      expect(res.status).toBe(200);
      return { owner, photo1, photo2, logo };
    }

    it("saves partial changes and keeps the rest", async () => {
      const owner = await seller();
      await createDraft(owner);
      const res = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ city: "Mombasa", county: "Mombasa" });
      expect(res.status).toBe(200);
      expect(res.body.revision).toMatchObject({
        city: "Mombasa",
        county: "Mombasa",
        businessName: "Cakes by Maria",
      });
    });

    it("returns image URLs for uploaded photos in the seller view", async () => {
      const { owner, photo1, logo } = await readyBusiness();
      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.body.revision.images[0]).toEqual({
        path: photo1,
        url: `https://storage.test/read/${photo1}`,
      });
      expect(me.body.revision.logoUrl).toBe(`https://storage.test/read/${logo}`);
      expect(me.body.revision.termsAccepted).toBe(true);
    });

    it("refuses to submit without portfolio photos", async () => {
      const owner = await seller();
      await createDraft(owner);
      await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ termsAccepted: true, contentAuthorization: true });
      const res = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields.portfolioPaths).toBeTruthy();
      expect((await prisma.business.findFirstOrThrow()).status).toBe("DRAFT");
    });

    it("refuses to submit without accepting the agreements", async () => {
      const owner = await seller();
      await createDraft(owner);
      const photo = await upload(owner);
      await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ portfolioPaths: [photo] });
      const res = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details.fields)).toEqual(
        expect.arrayContaining(["termsAccepted", "contentAuthorization"]),
      );
    });

    it("refuses photos that never finished uploading", async () => {
      const owner = await seller();
      await createDraft(owner);
      const photo = await upload(owner);
      await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ portfolioPaths: [photo], termsAccepted: true, contentAuthorization: true });
      files.clear();
      const res = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(res.status).toBe(400);
    });

    it("submits a complete application for review and locks it", async () => {
      const { owner } = await readyBusiness();
      const res = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(res.status).toBe(200);
      expect(res.body.business.status).toBe("PENDING");
      expect(res.body.revision.status).toBe("PENDING");
      expect(res.body.revision.submittedAt).toBeTruthy();
      expect(await prisma.auditLog.count({ where: { action: "business.submitted" } })).toBe(1);

      const edit = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ city: "Elsewhere" });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe("REVISION_LOCKED");

      const again = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(again.status).toBe(409);

      const upload2 = await request(app)
        .post("/api/businesses/me/uploads")
        .set(bearer(owner))
        .send({ contentType: "image/png", size: 1000 });
      expect(upload2.status).toBe(409);
    });

    it("cannot be approved by the seller through direct API calls", async () => {
      const { owner } = await readyBusiness();
      await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      const attempts = await Promise.all([
        request(app).patch("/api/businesses/me").set(bearer(owner)).send({ status: "APPROVED" }),
        request(app).post("/api/admin/businesses/anything/decision").set(bearer(owner)).send({}),
        request(app).post("/api/businesses/me/approve").set(bearer(owner)),
      ]);
      for (const res of attempts) expect([403, 404, 409]).toContain(res.status);
      expect((await prisma.business.findFirstOrThrow()).status).toBe("PENDING");
    });

    it("lets a draft move to another active category", async () => {
      const owner = await seller();
      await createDraft(owner);
      const res = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ categoryId: await categoryId("fashion") });
      expect(res.status).toBe(200);
    });
  });
});
