import { randomUUID } from "node:crypto";
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

describe.skipIf(!hasDatabase)("business review workflow", () => {
  const { app, prisma, actor, files, submittedBusiness } = harness;

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

  async function pendingBusiness(overrides: Record<string, unknown> = {}) {
    const owner = await actor("SELLER");
    const businessId = await submittedBusiness(owner, overrides);
    return { owner, businessId };
  }

  describe("authorization", () => {
    it.each(["CUSTOMER", "SELLER"] as const)(
      "blocks %s accounts from every admin endpoint",
      async (role) => {
        const { businessId } = await pendingBusiness();
        const user = await actor(role);
        expect((await request(app).get("/api/admin/businesses").set(bearer(user))).status).toBe(
          403,
        );
        expect(
          (await request(app).get(`/api/admin/businesses/${businessId}`).set(bearer(user))).status,
        ).toBe(403);
        expect((await decide(user, businessId, { action: "APPROVE" })).status).toBe(403);
        expect(
          (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).status,
        ).toBe("PENDING");
      },
    );

    it("blocks the owner from approving their own business", async () => {
      const { owner, businessId } = await pendingBusiness();
      const res = await decide(owner, businessId, { action: "APPROVE" });
      expect(res.status).toBe(403);
      expect(await prisma.reviewDecision.count()).toBe(0);
    });

    it("requires authentication", async () => {
      const { businessId } = await pendingBusiness();
      const res = await request(app)
        .post(`/api/admin/businesses/${businessId}/decision`)
        .send({ action: "APPROVE" });
      expect(res.status).toBe(401);
    });
  });

  describe("approval", () => {
    it("approves a pending application, publishes it and records the decision", async () => {
      const { businessId } = await pendingBusiness();
      const admin = await actor("ADMIN");

      const res = await decide(admin, businessId, { action: "APPROVE" });
      expect(res.status).toBe(200);
      expect(res.body.business.status).toBe("APPROVED");

      const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
      const revision = await prisma.businessRevision.findFirstOrThrow({ where: { businessId } });
      expect(business.publishedRevisionId).toBe(revision.id);
      expect(revision.status).toBe("APPROVED");

      const decision = await prisma.reviewDecision.findFirstOrThrow();
      expect(decision).toMatchObject({ businessId, adminId: admin.id, action: "APPROVED" });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "business.approved" },
      });
      expect(audit.actorId).toBe(admin.id);
    });

    it("lets the seller see the decision", async () => {
      const { owner, businessId } = await pendingBusiness();
      await decide(await actor("ADMIN"), businessId, { action: "APPROVE" });
      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.body.business.status).toBe("APPROVED");
      expect(me.body.decisions[0]).toMatchObject({ action: "APPROVED" });
    });

    it("cannot approve the same submission twice", async () => {
      const { businessId } = await pendingBusiness();
      const admin = await actor("ADMIN");
      await decide(admin, businessId, { action: "APPROVE" });
      const again = await decide(admin, businessId, { action: "APPROVE" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("NOTHING_TO_REVIEW");
      expect(await prisma.reviewDecision.count()).toBe(1);
    });

    it("lets only one of several simultaneous approvals win", async () => {
      const { businessId } = await pendingBusiness();
      const admins = await Promise.all([actor("ADMIN"), actor("ADMIN"), actor("ADMIN")]);
      const results = await Promise.all(
        admins.map((a) => decide(a, businessId, { action: "APPROVE" })),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.reviewDecision.count()).toBe(1);
    });

    it("refuses a decision made on a stale view of the submission", async () => {
      const { businessId } = await pendingBusiness();
      const res = await decide(await actor("ADMIN"), businessId, {
        action: "APPROVE",
        revisionId: randomUUID(),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("STALE_REVIEW");
    });

    it("refuses to approve a business that was never submitted", async () => {
      const owner = await actor("SELLER");
      const created = await request(app)
        .post("/api/businesses")
        .set(bearer(owner))
        .send(await harness.businessDetails());
      const res = await decide(await actor("ADMIN"), created.body.businessId, {
        action: "APPROVE",
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NOTHING_TO_REVIEW");
    });
  });

  describe("changes requested and rejection", () => {
    it("requires a meaningful reason", async () => {
      const { businessId } = await pendingBusiness();
      const admin = await actor("ADMIN");
      for (const action of ["REQUEST_CHANGES", "REJECT", "SUSPEND"]) {
        const res = await decide(admin, businessId, { action, reason: "no" });
        expect(res.status).toBe(400);
        expect(res.body.error.details.fields.reason).toBeTruthy();
      }
      expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).status).toBe(
        "PENDING",
      );
    });

    it("sends the application back, shows feedback and lets the seller fix and resubmit", async () => {
      const { owner, businessId } = await pendingBusiness();
      const admin = await actor("ADMIN");
      const res = await decide(admin, businessId, {
        action: "REQUEST_CHANGES",
        reason: "Please add clearer photos of your finished cakes.",
      });
      expect(res.status).toBe(200);
      expect(res.body.business.status).toBe("CHANGES_REQUESTED");

      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.body.business.status).toBe("CHANGES_REQUESTED");
      expect(me.body.decisions[0]).toMatchObject({
        action: "CHANGES_REQUESTED",
        reason: "Please add clearer photos of your finished cakes.",
      });

      const edit = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ description: "Custom celebration cakes with new, clearer photography." });
      expect(edit.status).toBe(200);
      const resubmit = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(resubmit.status).toBe(200);
      expect(resubmit.body.business.status).toBe("PENDING");

      const approve = await decide(admin, businessId, { action: "APPROVE" });
      expect(approve.body.business.status).toBe("APPROVED");
    });

    it("rejects an application and locks the seller out of editing", async () => {
      const { owner, businessId } = await pendingBusiness();
      const res = await decide(await actor("ADMIN"), businessId, {
        action: "REJECT",
        reason: "Content does not meet our creative-business guidelines.",
      });
      expect(res.body.business.status).toBe("REJECTED");

      const edit = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ city: "X1" });
      expect(edit.status).toBe(409);
      const submit = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
      expect(submit.status).toBe(409);
    });
  });

  describe("suspension", () => {
    async function approvedBusiness() {
      const ctx = await pendingBusiness();
      const admin = await actor("ADMIN");
      await decide(admin, ctx.businessId, { action: "APPROVE" });
      return { ...ctx, admin };
    }

    it("suspends and reinstates an approved business with reasons recorded", async () => {
      const { businessId, admin } = await approvedBusiness();
      const suspended = await decide(admin, businessId, {
        action: "SUSPEND",
        reason: "Reported for misleading product photos.",
      });
      expect(suspended.body.business.status).toBe("SUSPENDED");

      const reinstated = await decide(admin, businessId, {
        action: "REINSTATE",
        reason: "Resolved.",
      });
      expect(reinstated.body.business.status).toBe("APPROVED");

      const actions = (await prisma.reviewDecision.findMany({ orderBy: { createdAt: "asc" } })).map(
        (d) => d.action,
      );
      expect(actions).toEqual(["APPROVED", "SUSPENDED", "REINSTATED"]);
    });

    it("cannot suspend unapproved businesses or reinstate active ones", async () => {
      const { businessId } = await pendingBusiness();
      const admin = await actor("ADMIN");
      const suspend = await decide(admin, businessId, {
        action: "SUSPEND",
        reason: "Trying to suspend too early.",
      });
      expect(suspend.status).toBe(409);
      const reinstate = await decide(admin, businessId, { action: "REINSTATE" });
      expect(reinstate.status).toBe(409);
    });

    it("locks a suspended seller out of editing", async () => {
      const { owner, businessId, admin } = await approvedBusiness();
      await decide(admin, businessId, {
        action: "SUSPEND",
        reason: "Under investigation by admins.",
      });
      const me = await request(app).get("/api/businesses/me").set(bearer(owner));
      expect(me.body.business.status).toBe("SUSPENDED");
      const edit = await request(app)
        .patch("/api/businesses/me")
        .set(bearer(owner))
        .send({ city: "Y2" });
      expect(edit.status).toBe(409);
    });
  });

  describe("admin queue", () => {
    it("lists, filters and searches applications", async () => {
      const admin = await actor("ADMIN");
      const a = await pendingBusiness({
        businessName: "Alpha Bakes",
        city: "Nakuru",
        county: "Nakuru",
      });
      await pendingBusiness({ businessName: "Beta Blooms", city: "Kisumu", county: "Kisumu" });
      await decide(admin, a.businessId, { action: "APPROVE" });

      const all = await request(app).get("/api/admin/businesses").set(bearer(admin));
      expect(all.body.total).toBe(2);

      const pending = await request(app)
        .get("/api/admin/businesses")
        .query({ status: "PENDING" })
        .set(bearer(admin));
      expect(pending.body.items.map((i: { businessName: string }) => i.businessName)).toEqual([
        "Beta Blooms",
      ]);

      const approved = await request(app)
        .get("/api/admin/businesses")
        .query({ status: "APPROVED" })
        .set(bearer(admin));
      expect(approved.body.items).toHaveLength(1);

      const search = await request(app)
        .get("/api/admin/businesses")
        .query({ q: "kisumu" })
        .set(bearer(admin));
      expect(search.body.items.map((i: { businessName: string }) => i.businessName)).toEqual([
        "Beta Blooms",
      ]);

      const byOwnerEmail = await request(app)
        .get("/api/admin/businesses")
        .query({ q: a.owner.email })
        .set(bearer(admin));
      expect(byOwnerEmail.body.items).toHaveLength(1);
    });

    it("rejects invalid filters", async () => {
      const admin = await actor("ADMIN");
      const res = await request(app)
        .get("/api/admin/businesses")
        .query({ status: "BOGUS" })
        .set(bearer(admin));
      expect(res.status).toBe(400);
    });

    it("returns full application details with image URLs and decision history", async () => {
      const { businessId, owner } = await pendingBusiness();
      const admin = await actor("ADMIN");
      await decide(admin, businessId, {
        action: "REQUEST_CHANGES",
        reason: "Please add a clearer logo image.",
      });
      const res = await request(app).get(`/api/admin/businesses/${businessId}`).set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.business.owner.email).toBe(owner.email);
      expect(res.body.reviewRevision.images[0].url).toMatch(/^https:\/\/storage\.test\/read\//);
      expect(res.body.decisions[0]).toMatchObject({
        action: "CHANGES_REQUESTED",
        admin: { email: admin.email },
      });
    });

    it("returns 404 for unknown businesses and 400 for malformed ids", async () => {
      const admin = await actor("ADMIN");
      expect(
        (await request(app).get(`/api/admin/businesses/${randomUUID()}`).set(bearer(admin))).status,
      ).toBe(404);
      expect((await request(app).get("/api/admin/businesses/nope").set(bearer(admin))).status).toBe(
        400,
      );
    });
  });
});
