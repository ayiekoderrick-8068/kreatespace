import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCreation } from "../dev/builders.js";
import { fakeJpeg } from "../test/fake-storage.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("creation approval workflow", () => {
  const { app, prisma, actor, sellerWithBusiness, files, putFile } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  type Owner = Awaited<ReturnType<typeof sellerWithBusiness>>;
  type Admin = Awaited<ReturnType<typeof actor>>;

  const own = (owner: Owner, id: string) =>
    request(app).get(`/api/creations/${id}`).set(bearer(owner.seller));
  const decide = (admin: Admin, id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/creations/${id}/decision`).set(bearer(admin)).send(body);
  const submit = (owner: Owner, id: string) =>
    request(app).post(`/api/creations/${id}/submit`).set(bearer(owner.seller));
  const startRevision = (owner: Owner, id: string) =>
    request(app).post(`/api/creations/${id}/revisions`).set(bearer(owner.seller));
  const publicDetail = (id: string) => request(app).get(`/api/public/creations/${id}`);

  async function addPhoto(owner: Owner, id: string) {
    const target = await request(app)
      .post(`/api/creations/${id}/uploads`)
      .set(bearer(owner.seller))
      .send({ contentType: "image/jpeg", size: 100_000 });
    putFile(target.body.path, fakeJpeg(900, 1100));
    const res = await request(app)
      .post(`/api/creations/${id}/images`)
      .set(bearer(owner.seller))
      .send({ path: target.body.path });
    expect(res.status).toBe(201);
    return target.body.path as string;
  }

  async function draft(owner: Owner, overrides: Record<string, unknown> = {}) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
    const res = await request(app)
      .post("/api/creations")
      .set(bearer(owner.seller))
      .send({
        title: "Floral Birthday Cake",
        description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
        categoryId: category.id,
        ...overrides,
      });
    expect(res.status).toBe(201);
    return res.body.creationId as string;
  }

  async function pending(owner: Owner, overrides: Record<string, unknown> = {}) {
    const id = await draft(owner, overrides);
    await addPhoto(owner, id);
    expect((await submit(owner, id)).status).toBe(200);
    return id;
  }

  async function published(owner: Owner, admin: Admin) {
    const id = await pending(owner);
    expect((await decide(admin, id, { action: "APPROVE" })).status).toBe(200);
    return id;
  }

  describe("submitting", () => {
    it("sends a complete draft for review and locks it", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      await addPhoto(owner, id);

      const res = await submit(owner, id);
      expect(res.status).toBe(200);
      expect(res.body.creation.status).toBe("PENDING");
      expect(res.body.revision).toMatchObject({ status: "PENDING" });
      expect(res.body.revision.submittedAt).toBeTruthy();
      expect(res.body.creation.editable).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: "creation.submitted" } })).toBe(1);

      const edit = await request(app)
        .patch(`/api/creations/${id}`)
        .set(bearer(owner.seller))
        .send({ title: "Changed while pending" });
      expect(edit.status).toBe(409);
      expect((await submit(owner, id)).status).toBe(409);
    });

    it("stays private while pending", async () => {
      const owner = await sellerWithBusiness();
      const id = await pending(owner);
      expect((await publicDetail(id)).status).toBe(404);
      expect((await request(app).get("/api/public/creations")).body.items).toEqual([]);
    });

    it("requires at least one photo", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const res = await submit(owner, id);
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields.images).toBeTruthy();
      expect((await own(owner, id)).body.creation.status).toBe("DRAFT");
    });

    it("refuses when a photo has disappeared from storage", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await addPhoto(owner, id);
      files.delete(path);
      expect((await submit(owner, id)).status).toBe(400);
    });

    it("cannot be done by another seller, or while the business is suspended", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const id = await draft(owner);
      await addPhoto(owner, id);
      expect((await submit(other, id)).status).toBe(404);
      await prisma.business.update({
        where: { id: owner.businessId },
        data: { status: "SUSPENDED" },
      });
      expect((await submit(owner, id)).status).toBe(403);
    });

    it("lets only one of two simultaneous submissions through", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      await addPhoto(owner, id);
      const results = await Promise.all([submit(owner, id), submit(owner, id), submit(owner, id)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { action: "creation.submitted" } })).toBe(1);
    });
  });

  describe("approval", () => {
    it("publishes an approved creation, records the decision and shows it in discovery", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);

      const res = await decide(admin, id, { action: "APPROVE" });
      expect(res.status).toBe(200);
      expect(res.body.creation.status).toBe("APPROVED");

      const stored = await prisma.creation.findUniqueOrThrow({ where: { id } });
      expect(stored.publishedRevisionId).toBeTruthy();
      expect(stored.publishedAt).toBeTruthy();
      expect(await prisma.creationReviewDecision.findFirstOrThrow()).toMatchObject({
        creationId: id,
        adminId: admin.id,
        action: "APPROVED",
      });
      expect(await prisma.auditLog.count({ where: { action: "creation.approved" } })).toBe(1);

      const detail = await publicDetail(id);
      expect(detail.status).toBe(200);
      expect(detail.body.creation.title).toBe("Floral Birthday Cake");
      const feed = await request(app).get("/api/public/creations");
      expect(feed.body.items.map((i: { id: string }) => i.id)).toEqual([id]);
    });

    it("lets the seller see the result", async () => {
      const owner = await sellerWithBusiness();
      const id = await published(owner, await actor("ADMIN"));
      const view = await own(owner, id);
      expect(view.body.creation.status).toBe("APPROVED");
      expect(view.body.decisions[0]).toMatchObject({ action: "APPROVED" });
      const list = await request(app).get("/api/creations").set(bearer(owner.seller));
      expect(list.body.creations[0]).toMatchObject({
        status: "APPROVED",
        hasPublishedVersion: true,
      });
    });

    it("cannot be approved twice, and only one of several simultaneous approvals wins", async () => {
      const owner = await sellerWithBusiness();
      const id = await pending(owner);
      const admins = await Promise.all([actor("ADMIN"), actor("ADMIN"), actor("ADMIN")]);
      const results = await Promise.all(admins.map((a) => decide(a, id, { action: "APPROVE" })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.creationReviewDecision.count()).toBe(1);
      expect((await decide(admins[0]!, id, { action: "APPROVE" })).body.error.code).toBe(
        "NOTHING_TO_REVIEW",
      );
    });

    it("refuses a decision made on a stale view, or on a creation that was never submitted", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);
      const stale = await decide(admin, id, { action: "APPROVE", revisionId: randomUUID() });
      expect(stale.body.error.code).toBe("STALE_REVIEW");

      const unsent = await draft(owner);
      const res = await decide(admin, unsent, { action: "APPROVE" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NOTHING_TO_REVIEW");
    });
  });

  describe("changes requested and rejection", () => {
    it("requires an explanation", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);
      for (const action of ["REQUEST_CHANGES", "REJECT", "SUSPEND"]) {
        const res = await decide(admin, id, { action, reason: "no" });
        expect(res.status).toBe(400);
        expect(res.body.error.details.fields.reason).toBeTruthy();
      }
    });

    it("returns it with feedback; the seller fixes it, resubmits and gets it approved", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);

      const returned = await decide(admin, id, {
        action: "REQUEST_CHANGES",
        reason: "Please add a clearer photo of the cake’s top tier.",
      });
      expect(returned.body.creation.status).toBe("CHANGES_REQUESTED");
      expect((await publicDetail(id)).status).toBe(404);

      const view = await own(owner, id);
      expect(view.body.creation).toMatchObject({ status: "CHANGES_REQUESTED", editable: true });
      expect(view.body.decisions[0]).toMatchObject({
        action: "CHANGES_REQUESTED",
        reason: "Please add a clearer photo of the cake’s top tier.",
      });

      await addPhoto(owner, id);
      expect((await submit(owner, id)).body.creation.status).toBe("PENDING");
      const approved = await decide(admin, id, { action: "APPROVE" });
      expect(approved.body.creation.status).toBe("APPROVED");
      expect((await publicDetail(id)).status).toBe(200);
    });

    it("rejects a submission: it stays private and the seller can start again", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);
      const res = await decide(admin, id, {
        action: "REJECT",
        reason: "This image is not your own work.",
      });
      expect(res.body.creation.status).toBe("REJECTED");
      expect((await publicDetail(id)).status).toBe(404);

      const view = await own(owner, id);
      expect(view.body.decisions[0]).toMatchObject({
        action: "REJECTED",
        reason: "This image is not your own work.",
      });
      expect(view.body.creation).toMatchObject({ editable: false, canStartRevision: true });

      // Edits are refused until a new revision is started.
      const blocked = await request(app)
        .patch(`/api/creations/${id}`)
        .set(bearer(owner.seller))
        .send({ title: "Trying again" });
      expect(blocked.status).toBe(409);

      const restarted = await startRevision(owner, id);
      expect(restarted.status).toBe(201);
      expect(restarted.body.creation.status).toBe("DRAFT");
      expect(restarted.body.revision).toMatchObject({ version: 2, status: "DRAFT" });
      expect(restarted.body.revision.images).toHaveLength(1);

      await request(app)
        .patch(`/api/creations/${id}`)
        .set(bearer(owner.seller))
        .send({ title: "Original work only" });
      expect((await submit(owner, id)).status).toBe(200);
      expect((await decide(admin, id, { action: "APPROVE" })).body.creation.status).toBe(
        "APPROVED",
      );
      expect((await publicDetail(id)).body.creation.title).toBe("Original work only");
    });
  });

  describe("editing a published creation", () => {
    it("keeps the approved version live while an edit is drafted, pending or rejected", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);

      const started = await startRevision(owner, id);
      expect(started.status).toBe(201);
      expect(started.body.creation.status).toBe("APPROVED");
      expect(started.body.revision).toMatchObject({
        version: 2,
        status: "DRAFT",
        title: "Floral Birthday Cake",
      });
      expect(started.body.revision.images).toHaveLength(1);
      expect(started.body.publishedRevision.version).toBe(1);

      await request(app).patch(`/api/creations/${id}`).set(bearer(owner.seller)).send({
        title: "Premium Floral Cake",
        description: "Now with a hand-painted gold finish on every tier.",
      });
      expect((await publicDetail(id)).body.creation.title).toBe("Floral Birthday Cake");

      expect((await submit(owner, id)).body.creation.status).toBe("APPROVED");
      expect((await publicDetail(id)).body.creation.title).toBe("Floral Birthday Cake");

      const rejected = await decide(admin, id, {
        action: "REJECT",
        reason: "The new claims can’t be verified.",
      });
      expect(rejected.body.creation.status).toBe("APPROVED");
      expect((await publicDetail(id)).body.creation.title).toBe("Floral Birthday Cake");
      const view = await own(owner, id);
      expect(view.body.revision.status).toBe("REJECTED");
      expect(view.body.publishedRevision.title).toBe("Floral Birthday Cake");
    });

    it("replaces the live version only after approval, without changing its publish date", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);
      const firstPublished = (await prisma.creation.findUniqueOrThrow({ where: { id } }))
        .publishedAt;

      await startRevision(owner, id);
      await request(app)
        .patch(`/api/creations/${id}`)
        .set(bearer(owner.seller))
        .send({ title: "Premium Floral Cake" });
      await addPhoto(owner, id); // a second photo, only in the pending edit
      await submit(owner, id);
      expect((await publicDetail(id)).body.creation.images).toHaveLength(1);

      const queue = await request(app)
        .get("/api/admin/creations")
        .query({ status: "PENDING" })
        .set(bearer(admin));
      expect(queue.body.items[0]).toMatchObject({ status: "APPROVED", hasPendingSubmission: true });
      const review = await request(app).get(`/api/admin/creations/${id}`).set(bearer(admin));
      expect(review.body.reviewRevision.title).toBe("Premium Floral Cake");
      expect(review.body.reviewRevision.images).toHaveLength(2);
      expect(review.body.publishedRevision.title).toBe("Floral Birthday Cake");

      await decide(admin, id, { action: "APPROVE" });
      const live = (await publicDetail(id)).body.creation;
      expect(live.title).toBe("Premium Floral Cake");
      expect(live.images).toHaveLength(2);
      expect((await prisma.creation.findUniqueOrThrow({ where: { id } })).publishedAt).toEqual(
        firstPublished,
      );
    });

    it("allows only one edit in progress, and only for approved or rejected creations", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);
      await startRevision(owner, id);
      expect((await startRevision(owner, id)).body.error.code).toBe("CANNOT_START_REVISION");

      const unsent = await draft(owner);
      expect((await startRevision(owner, unsent)).status).toBe(409);
      const awaiting = await pending(owner);
      expect((await startRevision(owner, awaiting)).status).toBe(409);
    });
  });

  describe("authorization", () => {
    it("blocks customers and sellers from every admin endpoint", async () => {
      const owner = await sellerWithBusiness();
      const id = await pending(owner);
      const customer = await actor("CUSTOMER");
      for (const user of [owner.seller, customer]) {
        expect((await request(app).get("/api/admin/creations").set(bearer(user))).status).toBe(403);
        expect(
          (await request(app).get(`/api/admin/creations/${id}`).set(bearer(user))).status,
        ).toBe(403);
        expect((await decide(user, id, { action: "APPROVE" })).status).toBe(403);
      }
      expect((await request(app).get("/api/admin/creations")).status).toBe(401);
      expect((await prisma.creation.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    });

    it("cannot be bypassed by a seller sending status or publication fields directly", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      await addPhoto(owner, id);
      const attempts = await Promise.all([
        request(app).patch(`/api/creations/${id}`).set(bearer(owner.seller)).send({
          status: "APPROVED",
          publishedRevisionId: randomUUID(),
          publishedAt: new Date().toISOString(),
        }),
        request(app).post(`/api/creations/${id}/approve`).set(bearer(owner.seller)),
        request(app)
          .post(`/api/creations/${id}/publish`)
          .set(bearer(owner.seller))
          .send({ status: "APPROVED" }),
      ]);
      expect(attempts[1]!.status).toBe(404);
      expect(attempts[2]!.status).toBe(404);
      const stored = await prisma.creation.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({
        status: "DRAFT",
        publishedRevisionId: null,
        publishedAt: null,
      });
      expect((await publicDetail(id)).status).toBe(404);
    });

    it("rejects unknown or malformed ids and filters", async () => {
      const admin = await actor("ADMIN");
      expect(
        (await request(app).get(`/api/admin/creations/${randomUUID()}`).set(bearer(admin))).status,
      ).toBe(404);
      expect((await request(app).get("/api/admin/creations/nope").set(bearer(admin))).status).toBe(
        400,
      );
      expect(
        (
          await request(app)
            .get("/api/admin/creations")
            .query({ status: "BOGUS" })
            .set(bearer(admin))
        ).status,
      ).toBe(400);
    });
  });

  describe("suspension and removal", () => {
    it("hides a suspended creation everywhere public, locks the seller out, and reinstates cleanly", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);

      const suspended = await decide(admin, id, {
        action: "SUSPEND",
        reason: "Reported as misleading.",
      });
      expect(suspended.body.creation.status).toBe("SUSPENDED");
      expect((await publicDetail(id)).status).toBe(404);
      expect((await request(app).get("/api/public/creations")).body.items).toEqual([]);
      expect((await request(app).get(`/api/public/creations/${id}/related`)).status).toBe(404);

      expect((await startRevision(owner, id)).status).toBe(409);
      expect(
        (await request(app).post(`/api/creations/${id}/archive`).set(bearer(owner.seller))).status,
      ).toBe(200);
    });

    it("reinstates a suspended creation", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);
      await decide(admin, id, { action: "SUSPEND", reason: "Under investigation." });
      const back = await decide(admin, id, { action: "REINSTATE" });
      expect(back.body.creation.status).toBe("APPROVED");
      expect((await publicDetail(id)).status).toBe(200);
      const history = back.body.decisions.map((d: { action: string }) => d.action);
      expect(history).toEqual(["REINSTATED", "SUSPENDED", "APPROVED"]);
    });

    it("cannot suspend something that is not live", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);
      const res = await decide(admin, id, { action: "SUSPEND", reason: "Too early to suspend." });
      expect(res.status).toBe(409);
    });

    it("stops every creation being public once their business is suspended", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await published(owner, admin);
      await prisma.business.update({
        where: { id: owner.businessId },
        data: { status: "SUSPENDED" },
      });
      expect((await publicDetail(id)).status).toBe(404);
      expect((await request(app).get("/api/public/creations")).body.items).toEqual([]);
    });
  });

  describe("admin queue", () => {
    it("lists, filters and searches submissions", async () => {
      const admin = await actor("ADMIN");
      const a = await sellerWithBusiness({ name: "Alpha Bakes" });
      const b = await sellerWithBusiness({ name: "Beta Blooms", categorySlug: "flowers" });
      const alphaId = await pending(a, { title: "Alpha Cake Special" });
      const flowers = await prisma.category.findUniqueOrThrow({ where: { slug: "flowers" } });
      const betaId = await pending(b, { title: "Bouquet of Roses", categoryId: flowers.id });
      await decide(admin, alphaId, { action: "APPROVE" });
      await buildCreation(prisma, {
        businessId: b.businessId,
        title: "Draft thing",
        status: "DRAFT",
      });

      const get = async (query: Record<string, string>) =>
        (await request(app).get("/api/admin/creations").query(query).set(bearer(admin))).body;
      expect((await get({})).total).toBe(3);
      expect((await get({ status: "PENDING" })).items.map((i: { id: string }) => i.id)).toEqual([
        betaId,
      ]);
      expect((await get({ status: "APPROVED" })).items.map((i: { id: string }) => i.id)).toEqual([
        alphaId,
      ]);
      expect((await get({ businessId: b.businessId })).total).toBe(2);
      expect((await get({ category: "flowers" })).items.map((i: { id: string }) => i.id)).toEqual([
        betaId,
      ]);
      expect((await get({ q: "roses" })).items.map((i: { id: string }) => i.id)).toEqual([betaId]);
      expect((await get({ q: "alpha bakes" })).items.map((i: { id: string }) => i.id)).toEqual([
        alphaId,
      ]);
      const item = (await get({ status: "PENDING" })).items[0];
      expect(item).toMatchObject({
        title: "Bouquet of Roses",
        businessName: "Beta Blooms",
        hasPendingSubmission: true,
      });
    });

    it("shows submitted images and the full moderation history", async () => {
      const owner = await sellerWithBusiness();
      const admin = await actor("ADMIN");
      const id = await pending(owner);
      await decide(admin, id, {
        action: "REQUEST_CHANGES",
        reason: "Add one more photo of the side.",
      });
      const res = await request(app).get(`/api/admin/creations/${id}`).set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.business).toMatchObject({ id: owner.businessId });
      expect(res.body.reviewRevision.images[0].url).toMatch(/^https:\/\/storage\.test\/read\//);
      expect(res.body.decisions[0]).toMatchObject({
        action: "CHANGES_REQUESTED",
        reason: "Add one more photo of the side.",
        admin: { email: admin.email },
      });
    });
  });
});
