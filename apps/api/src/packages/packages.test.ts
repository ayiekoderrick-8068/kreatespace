import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeJpeg } from "../test/fake-storage.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("service packages", () => {
  const { app, prisma, actor, sellerWithBusiness, files, putFile } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  type Owner = Awaited<ReturnType<typeof sellerWithBusiness>>;
  type Admin = Awaited<ReturnType<typeof actor>>;

  const content = (overrides: Record<string, unknown> = {}) => ({
    name: "Wedding Photography Package",
    description: "Full-day coverage of your wedding, from preparations to the first dance.",
    includes: ["Event coverage", "Edited photographs", "Digital gallery"],
    ...overrides,
  });

  const create = (owner: Owner, overrides: Record<string, unknown> = {}) =>
    request(app).post("/api/packages").set(bearer(owner.seller)).send(content(overrides));
  const patch = (owner: Owner, id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/packages/${id}`).set(bearer(owner.seller)).send(body);
  const submit = (owner: Owner, id: string) =>
    request(app).post(`/api/packages/${id}/submit`).set(bearer(owner.seller));
  const decide = (admin: Admin, id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/packages/${id}/decision`).set(bearer(admin)).send(body);
  const profile = (slug: string) => request(app).get(`/api/public/businesses/${slug}`);
  const livePackages = async (owner: Owner) =>
    (await profile(owner.slug)).body.business.packages as { id: string; name: string }[];

  async function approved(owner: Owner, admin: Admin, overrides: Record<string, unknown> = {}) {
    const id = (await create(owner, overrides)).body.id as string;
    expect((await submit(owner, id)).status).toBe(200);
    expect((await decide(admin, id, { action: "APPROVE" })).status).toBe(200);
    return id;
  }

  describe("access", () => {
    it("requires sign-in, a seller account and an approved business", async () => {
      expect((await request(app).get("/api/packages")).status).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/packages")
            .set(bearer(await actor("CUSTOMER")))
        ).status,
      ).toBe(403);
      for (const status of ["PENDING", "SUSPENDED"] as const) {
        const owner = await sellerWithBusiness({ status });
        expect((await create(owner)).status).toBe(403);
      }
      expect(await prisma.servicePackage.count()).toBe(0);
    });

    it("keeps each seller's packages private from other sellers", async () => {
      const a = await sellerWithBusiness();
      const b = await sellerWithBusiness();
      const id = (await create(a)).body.id;
      expect((await request(app).get(`/api/packages/${id}`).set(bearer(b.seller))).status).toBe(
        404,
      );
      expect((await patch(b, id, { name: "Hijacked name" })).status).toBe(404);
      expect((await submit(b, id)).status).toBe(404);
      expect(
        (await request(app).post(`/api/packages/${id}/archive`).set(bearer(b.seller))).status,
      ).toBe(404);
      expect((await request(app).get("/api/packages").set(bearer(b.seller))).body.packages).toEqual(
        [],
      );
    });
  });

  describe("creating and editing", () => {
    it("saves a draft with an optional starting price, and never invents one", async () => {
      const owner = await sellerWithBusiness();
      const noPrice = await create(owner);
      expect(noPrice.status).toBe(201);
      expect(noPrice.body).toMatchObject({
        reviewState: "DRAFT",
        status: "ACTIVE",
        hasPublishedVersion: false,
        draft: { name: "Wedding Photography Package", startingPriceKes: null, image: null },
      });
      const priced = await create(owner, { name: "Birthday Cake Package", startingPriceKes: 4500 });
      expect(priced.body.draft.startingPriceKes).toBe(4500);
    });

    it.each([
      ["name", ""],
      ["name", "ab"],
      ["description", "short"],
      ["includes", []],
      ["includes", ["x"]],
      ["includes", Array.from({ length: 11 }, (_, i) => `Item ${i}`)],
      ["startingPriceKes", 0],
      ["startingPriceKes", -5],
      ["startingPriceKes", 12.5],
      ["startingPriceKes", 99_999_999],
      ["startingPriceKes", "free"],
    ])("rejects an invalid %s (%j)", async (field, value) => {
      const owner = await sellerWithBusiness();
      const res = await create(owner, { [field]: value });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.details.fields).join()).toContain(field);
      expect(await prisma.servicePackage.count()).toBe(0);
    });

    it("limits a business to ten active packages, even with simultaneous requests", async () => {
      const owner = await sellerWithBusiness();
      const results = await Promise.all(
        Array.from({ length: 14 }, (_, i) => create(owner, { name: `Package number ${i}` })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe("PACKAGE_LIMIT_REACHED");

      const one = await prisma.servicePackage.findFirstOrThrow();
      await request(app).post(`/api/packages/${one.id}/archive`).set(bearer(owner.seller));
      expect((await create(owner, { name: "Fits after archiving" })).status).toBe(201);
    });

    it("ignores client-supplied status, publication and owner fields", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const res = await create(owner, {
        status: "SUSPENDED",
        reviewState: "APPROVED",
        published: { name: "Fake live version" },
        publishedAt: new Date().toISOString(),
        businessId: other.businessId,
      });
      expect(res.status).toBe(201);
      const stored = await prisma.servicePackage.findFirstOrThrow();
      expect(stored).toMatchObject({
        businessId: owner.businessId,
        status: "ACTIVE",
        reviewState: "DRAFT",
        published: null,
        publishedAt: null,
      });
    });

    it("applies partial edits and can clear the price", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner, { startingPriceKes: 9000 })).body.id;
      const res = await patch(owner, id, { name: "Renamed Package", startingPriceKes: null });
      expect(res.body.draft).toMatchObject({
        name: "Renamed Package",
        startingPriceKes: null,
        description: content().description,
      });
    });
  });

  describe("moderation and public visibility", () => {
    it("keeps drafts and pending packages private", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      expect(await livePackages(owner)).toEqual([]);
      await submit(owner, id);
      expect(await livePackages(owner)).toEqual([]);
      expect(JSON.stringify((await profile(owner.slug)).body)).not.toContain("Wedding Photography");
    });

    it("locks a pending package and refuses a second submission", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      await submit(owner, id);
      expect((await patch(owner, id, { name: "Sneaky change" })).status).toBe(409);
      expect((await submit(owner, id)).status).toBe(409);
    });

    it("publishes only on approval, showing exactly what was approved", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await approved(owner, admin, { startingPriceKes: 80_000 });
      const live = (await profile(owner.slug)).body.business.packages;
      expect(live).toEqual([
        {
          id,
          name: "Wedding Photography Package",
          description: content().description,
          includes: ["Event coverage", "Edited photographs", "Digital gallery"],
          startingPriceKes: 80_000,
          image: null,
        },
      ]);
    });

    it("never shows a price the seller did not enter", async () => {
      const owner = await sellerWithBusiness();
      await approved(owner, await actor("ADMIN"));
      const [pkg] = (await profile(owner.slug)).body.business.packages;
      expect(pkg.startingPriceKes).toBeNull();
    });

    it("keeps the approved version live while an edit is pending, rejected or approved", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await approved(owner, admin);

      const edited = await patch(owner, id, {
        name: "Premium Wedding Package",
        startingPriceKes: 120_000,
      });
      expect(edited.body).toMatchObject({ reviewState: "DRAFT", hasPublishedVersion: true });
      expect(edited.body.published.name).toBe("Wedding Photography Package");
      expect((await livePackages(owner))[0]!.name).toBe("Wedding Photography Package");

      await submit(owner, id);
      expect((await livePackages(owner))[0]!.name).toBe("Wedding Photography Package");

      const rejected = await decide(admin, id, {
        action: "REJECT",
        reason: "The new price isn’t supported.",
      });
      expect(rejected.body.package.reviewState).toBe("REJECTED");
      expect((await livePackages(owner))[0]!.name).toBe("Wedding Photography Package");

      await patch(owner, id, { name: "Premium Wedding Package" });
      await submit(owner, id);
      await decide(admin, id, { action: "APPROVE" });
      expect((await livePackages(owner))[0]!.name).toBe("Premium Wedding Package");
    });

    it("returns a package with feedback and lets the seller fix it", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = (await create(owner)).body.id;
      await submit(owner, id);
      await decide(admin, id, {
        action: "REQUEST_CHANGES",
        reason: "Please explain what the gallery includes.",
      });

      const view = await request(app).get(`/api/packages/${id}`).set(bearer(owner.seller));
      expect(view.body).toMatchObject({
        reviewState: "CHANGES_REQUESTED",
        editable: true,
        latestFeedback: {
          action: "CHANGES_REQUESTED",
          reason: "Please explain what the gallery includes.",
        },
      });
      await patch(owner, id, { includes: ["Event coverage", "Online gallery with 300 photos"] });
      expect((await submit(owner, id)).body.reviewState).toBe("PENDING");
    });

    it("hides archived and suspended packages, and packages of suspended businesses", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const a = await approved(owner, admin, { name: "Package to archive" });
      const b = await approved(owner, admin, { name: "Package to suspend" });
      const c = await approved(owner, admin, { name: "Package of a suspended business" });
      expect(await livePackages(owner)).toHaveLength(3);

      await request(app).post(`/api/packages/${a}/archive`).set(bearer(owner.seller));
      expect((await livePackages(owner)).map((p) => p.id).sort()).toEqual([b, c].sort());

      const suspended = await decide(admin, b, {
        action: "SUSPEND",
        reason: "Reported as misleading.",
      });
      expect(suspended.body.package.status).toBe("SUSPENDED");
      expect((await livePackages(owner)).map((p) => p.id)).toEqual([c]);
      expect((await patch(owner, b, { name: "Edit while suspended" })).status).toBe(409);

      await decide(admin, b, { action: "REINSTATE" });
      expect(await livePackages(owner)).toHaveLength(2);

      await prisma.business.update({
        where: { id: owner.businessId },
        data: { status: "SUSPENDED" },
      });
      expect((await profile(owner.slug)).status).toBe(404);
    });
  });

  describe("authorization", () => {
    it("blocks sellers and customers from the admin endpoints", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      await submit(owner, id);
      for (const user of [owner.seller, await actor("CUSTOMER")]) {
        expect((await request(app).get("/api/admin/packages").set(bearer(user))).status).toBe(403);
        expect((await decide(user, id, { action: "APPROVE" })).status).toBe(403);
      }
      expect((await prisma.servicePackage.findUniqueOrThrow({ where: { id } })).reviewState).toBe(
        "PENDING",
      );
    });

    it("lets one of several simultaneous approvals win, and requires reasons to reject", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      await submit(owner, id);
      const admins = await Promise.all([actor("ADMIN"), actor("ADMIN"), actor("ADMIN")]);
      expect((await decide(admins[0]!, id, { action: "REJECT", reason: "no" })).status).toBe(400);
      const results = await Promise.all(admins.map((a) => decide(a, id, { action: "APPROVE" })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.packageReviewDecision.count()).toBe(1);
    });

    it("lists and details packages for admins, with history and filters", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const pendingId = (await create(owner, { name: "Pending Package" })).body.id;
      await submit(owner, pendingId);
      await create(owner, { name: "Draft Package" });

      const queue = await request(app)
        .get("/api/admin/packages")
        .query({ state: "PENDING" })
        .set(bearer(admin));
      expect(queue.body.items.map((i: { name: string }) => i.name)).toEqual(["Pending Package"]);
      const byBusiness = await request(app)
        .get("/api/admin/packages")
        .query({ businessId: owner.businessId })
        .set(bearer(admin));
      expect(byBusiness.body.total).toBe(2);

      await decide(admin, pendingId, { action: "APPROVE" });
      const detail = await request(app).get(`/api/admin/packages/${pendingId}`).set(bearer(admin));
      expect(detail.body.business.id).toBe(owner.businessId);
      expect(detail.body.decisions[0]).toMatchObject({
        action: "APPROVED",
        admin: { email: admin.email },
      });
      expect(
        (await request(app).get(`/api/admin/packages/${randomUUID()}`).set(bearer(admin))).status,
      ).toBe(404);
    });
  });

  describe("package image", () => {
    async function withUpload(
      owner: Owner,
      id: string,
      bytes = fakeJpeg(1000, 800),
      contentType = "image/jpeg",
    ) {
      const target = await request(app)
        .post(`/api/packages/${id}/image-upload`)
        .set(bearer(owner.seller))
        .send({ contentType, size: 100_000 });
      expect(target.status).toBe(201);
      putFile(target.body.path, bytes);
      return target.body.path as string;
    }
    const confirm = (owner: Owner, id: string, path: string) =>
      request(app).post(`/api/packages/${id}/image`).set(bearer(owner.seller)).send({ path });

    it("attaches a verified image that becomes public only with approval", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = (await create(owner)).body.id;
      const path = await withUpload(owner, id);
      expect(path).toMatch(
        new RegExp(`^businesses/${owner.businessId}/packages/${id}/[0-9a-f-]{36}\\.jpg$`),
      );

      const res = await confirm(owner, id, path);
      expect(res.status).toBe(200);
      expect(res.body.draft.image).toMatchObject({
        width: 1000,
        height: 800,
        url: `https://storage.test/read/${path}`,
      });

      await submit(owner, id);
      expect(JSON.stringify((await profile(owner.slug)).body)).not.toContain(path);
      await decide(admin, id, { action: "APPROVE" });
      const live = (await livePackagesFull(owner))[0]!;
      expect(live.image.url).toBe(`https://storage.test/read/${path}`);
    });

    async function livePackagesFull(owner: Owner) {
      return (await profile(owner.slug)).body.business.packages as { image: { url: string } }[];
    }

    it("rejects files that are not real images, and deletes them", async () => {
      const owner = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      const path = await withUpload(owner, id, Buffer.from("<script>alert(1)</script>"));
      const res = await confirm(owner, id, path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_IMAGE");
      expect(files.has(path)).toBe(false);
    });

    it("rejects paths outside the package's folder and other sellers' packages", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const id = (await create(owner)).body.id;
      const otherId = (await create(other)).body.id;
      const foreign = await withUpload(other, otherId);
      expect((await confirm(owner, id, foreign)).status).toBe(400);
      expect((await confirm(other, id, foreign)).status).toBe(404);
    });

    it("replaces and removes images, deleting unused files but keeping the live one", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = (await create(owner)).body.id;
      const first = await withUpload(owner, id);
      await confirm(owner, id, first);
      await submit(owner, id);
      await decide(admin, id, { action: "APPROVE" });

      const second = await withUpload(owner, id);
      await confirm(owner, id, second);
      expect(files.has(first)).toBe(true); // still the live image
      expect(files.has(second)).toBe(true);

      const cleared = await request(app)
        .delete(`/api/packages/${id}/image`)
        .set(bearer(owner.seller));
      expect(cleared.body.draft.image).toBeNull();
      expect(files.has(second)).toBe(false);
      expect(files.has(first)).toBe(true);
    });
  });
});
