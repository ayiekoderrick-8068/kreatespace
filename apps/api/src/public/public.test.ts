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

describe.skipIf(!hasDatabase)("public business profiles", () => {
  const { app, prisma, actor, files, businessDetails, submittedBusiness } = harness;

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

  const profile = (slug: string) => request(app).get(`/api/public/businesses/${slug}`);

  it("shows an approved business to anyone without logging in", async () => {
    const owner = await actor("SELLER");
    const admin = await actor("ADMIN");
    const id = await submittedBusiness(owner);
    await decide(admin, id, { action: "APPROVE" });

    const res = await profile("cakes-by-maria");
    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({
      slug: "cakes-by-maria",
      businessName: "Cakes by Maria",
      description: "Custom celebration cakes baked fresh to order in Nairobi.",
      category: { slug: "cakes", name: "Cakes" },
      county: "Nairobi",
      city: "Westlands",
      websiteUrl: "https://cakes-by-maria.vercel.app",
      whatsappNumber: "+254712345678",
    });
    expect(res.body.business.images).toHaveLength(1);
    expect(res.body.business.images[0].url).toMatch(/^https:\/\/storage\.test\/read\//);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("exposes no private fields", async () => {
    const owner = await actor("SELLER");
    const id = await submittedBusiness(owner);
    await decide(await actor("ADMIN"), id, { action: "APPROVE" });

    const body = JSON.stringify((await profile("cakes-by-maria")).body);
    expect(body).not.toContain(owner.email);
    expect(body).not.toContain(owner.id);
    expect(body).not.toContain("ownerName");
    expect(body).not.toContain("Maria Wanjiku");
    expect(body).not.toMatch(/status|termsAccepted|reason|decision/i);
  });

  it("works for a business without a website or logo", async () => {
    const owner = await actor("SELLER");
    const id = await submittedBusiness(owner, { websiteUrl: "" });
    await decide(await actor("ADMIN"), id, { action: "APPROVE" });
    const res = await profile("cakes-by-maria");
    expect(res.body.business.websiteUrl).toBeNull();
    expect(res.body.business.logoUrl).toBeNull();
  });

  describe("stays private until approved", () => {
    it("hides drafts", async () => {
      const owner = await actor("SELLER");
      await request(app)
        .post("/api/businesses")
        .set(bearer(owner))
        .send(await businessDetails());
      expect((await profile("cakes-by-maria")).status).toBe(404);
    });

    it("hides pending applications", async () => {
      await submittedBusiness(await actor("SELLER"));
      expect((await profile("cakes-by-maria")).status).toBe(404);
    });

    it("hides applications that need changes", async () => {
      const id = await submittedBusiness(await actor("SELLER"));
      await decide(await actor("ADMIN"), id, {
        action: "REQUEST_CHANGES",
        reason: "Please add clearer photos.",
      });
      expect((await profile("cakes-by-maria")).status).toBe(404);
    });

    it("hides rejected applications", async () => {
      const id = await submittedBusiness(await actor("SELLER"));
      await decide(await actor("ADMIN"), id, {
        action: "REJECT",
        reason: "Does not meet the guidelines.",
      });
      expect((await profile("cakes-by-maria")).status).toBe(404);
    });

    it("hides suspended businesses and shows them again once reinstated", async () => {
      const admin = await actor("ADMIN");
      const id = await submittedBusiness(await actor("SELLER"));
      await decide(admin, id, { action: "APPROVE" });
      expect((await profile("cakes-by-maria")).status).toBe(200);

      await decide(admin, id, { action: "SUSPEND", reason: "Reported by a customer." });
      const hidden = await profile("cakes-by-maria");
      expect(hidden.status).toBe(404);
      expect(hidden.body.error.code).toBe("NOT_FOUND");

      await decide(admin, id, { action: "REINSTATE" });
      expect((await profile("cakes-by-maria")).status).toBe(200);
    });

    it("gives unknown and malformed slugs the same answer", async () => {
      expect((await profile("nobody-here")).status).toBe(404);
      expect((await profile("Bad_Slug!")).status).toBe(400);
    });
  });

  describe("profile edits", () => {
    it("keeps showing the approved version until an update is approved", async () => {
      const owner = await actor("SELLER");
      const admin = await actor("ADMIN");
      const id = await submittedBusiness(owner);
      await decide(admin, id, { action: "APPROVE" });

      await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
      await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ description: "A brand new description that has not been reviewed yet." });
      expect((await profile("cakes-by-maria")).body.business.description).toMatch(
        /^Custom celebration/,
      );

      await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect((await profile("cakes-by-maria")).body.business.description).toMatch(
        /^Custom celebration/,
      );

      await decide(admin, id, { action: "APPROVE" });
      expect((await profile("cakes-by-maria")).body.business.description).toMatch(/^A brand new/);
    });

    it("never shows a rejected update", async () => {
      const owner = await actor("SELLER");
      const admin = await actor("ADMIN");
      const id = await submittedBusiness(owner);
      await decide(admin, id, { action: "APPROVE" });
      await request(app).post("/api/businesses/me/revisions").set(bearer(owner));
      await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ description: "Misleading claims about guaranteed same-day delivery everywhere." });
      await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      await decide(admin, id, { action: "REJECT", reason: "Claims cannot be verified." });
      expect((await profile("cakes-by-maria")).body.business.description).toMatch(
        /^Custom celebration/,
      );
    });
  });
});
