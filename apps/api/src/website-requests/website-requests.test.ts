import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

const valid = {
  type: "NEW_WEBSITE",
  description: "We bake wedding cakes and would like a simple website with a gallery.",
  budget: "50K_150K",
  timeline: "ONE_TO_THREE_MONTHS",
};

describe.skipIf(!hasDatabase)("website development requests", () => {
  const { app, prisma, actor, sellerWithBusiness } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const submit = (seller: Parameters<typeof bearer>[0], body: object = valid) =>
    request(app).post("/api/website-requests").set(bearer(seller)).send(body);

  describe("sellers", () => {
    it("send a request and see it with its status", async () => {
      const { seller } = await sellerWithBusiness({ name: "Cakes by Maria" });
      const created = await submit(seller);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        type: "NEW_WEBSITE",
        status: "NEW",
        budget: "50K_150K",
        cancellable: true,
        responseNote: null,
      });

      const list = await request(app).get("/api/website-requests").set(bearer(seller));
      expect(list.status).toBe(200);
      expect(list.body.requests).toHaveLength(1);
      expect(list.body.canRequest).toBe(false);
    });

    it("validate what they send", async () => {
      const { seller } = await sellerWithBusiness({ name: "Validation Co" });
      const bad = await submit(seller, { type: "FREE_PHONE", description: "short" });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.fields).toHaveProperty("type");
      expect(bad.body.error.details.fields).toHaveProperty("description");
      expect((await submit(seller, { ...valid, budget: "a lot" })).status).toBe(400);
      expect((await submit(seller, { ...valid, description: "x".repeat(1001) })).status).toBe(400);
    });

    it("may have only one open request, and may ask again once it is closed", async () => {
      const { seller } = await sellerWithBusiness({ name: "One At A Time" });
      const first = await submit(seller);
      const second = await submit(seller);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("WEBSITE_REQUEST_OPEN");

      const cancelled = await request(app)
        .post(`/api/website-requests/${first.body.id}/cancel`)
        .set(bearer(seller));
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("CANCELLED");
      expect((await submit(seller)).status).toBe(201);
    });

    it("cannot beat the one-open-request rule with simultaneous requests", async () => {
      const { seller } = await sellerWithBusiness({ name: "Racing Co" });
      const results = await Promise.all(Array.from({ length: 5 }, () => submit(seller)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await prisma.websiteRequest.count()).toBe(1);
    });

    it("enforces the rule in the database too", async () => {
      const { seller, businessId } = await sellerWithBusiness({ name: "Direct Writer" });
      await submit(seller);
      await expect(
        prisma.websiteRequest.create({
          data: { businessId, type: "OTHER", description: "Written straight to the table." },
        }),
      ).rejects.toThrow();
    });

    it("cannot withdraw a request that has been accepted", async () => {
      const { seller } = await sellerWithBusiness({ name: "Locked In" });
      const created = await submit(seller);
      await prisma.websiteRequest.update({
        where: { id: created.body.id },
        data: { status: "ACCEPTED" },
      });
      const res = await request(app)
        .post(`/api/website-requests/${created.body.id}/cancel`)
        .set(bearer(seller));
      expect(res.status).toBe(409);
    });

    it("never see administrator notes or other businesses' requests", async () => {
      const mine = await sellerWithBusiness({ name: "Mine" });
      const theirs = await sellerWithBusiness({ name: "Theirs" });
      const theirRequest = await submit(theirs.seller);
      await prisma.websiteRequest.update({
        where: { id: theirRequest.body.id },
        data: { adminNotes: "Internal: slow payer", responseNote: "We will be in touch." },
      });
      await submit(mine.seller);

      const own = await request(app).get("/api/website-requests").set(bearer(mine.seller));
      expect(own.body.requests).toHaveLength(1);
      expect(JSON.stringify(own.body)).not.toContain("slow payer");

      // Their own view shows the reply but still hides the internal notes.
      const theirView = await request(app).get("/api/website-requests").set(bearer(theirs.seller));
      expect(theirView.body.requests[0].responseNote).toBe("We will be in touch.");
      expect(JSON.stringify(theirView.body)).not.toContain("slow payer");

      // Withdrawing someone else's request looks exactly like withdrawing one that doesn't exist.
      const stolen = await request(app)
        .post(`/api/website-requests/${theirRequest.body.id}/cancel`)
        .set(bearer(mine.seller));
      const missing = await request(app)
        .post(`/api/website-requests/${randomUUID()}/cancel`)
        .set(bearer(mine.seller));
      expect(stolen.status).toBe(404);
      expect(stolen.body).toEqual(missing.body);
      expect(
        (await prisma.websiteRequest.findUniqueOrThrow({ where: { id: theirRequest.body.id } }))
          .status,
      ).toBe("NEW");
    });

    it("need an approved business, and customers cannot use the endpoints at all", async () => {
      const pending = await sellerWithBusiness({ name: "Waiting", status: "PENDING" });
      expect((await submit(pending.seller)).status).toBe(403);
      const customer = await actor("CUSTOMER");
      expect((await submit(customer)).status).toBe(403);
      expect((await request(app).get("/api/website-requests")).status).toBe(401);
    });
  });

  describe("administrators", () => {
    it("see requests with the business contact details, oldest first", async () => {
      const first = await sellerWithBusiness({ name: "First In" });
      const second = await sellerWithBusiness({ name: "Second In" });
      await submit(first.seller);
      await submit(second.seller);
      const admin = await actor("ADMIN");

      const res = await request(app).get("/api/admin/website-requests").set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.requests[0].business).toMatchObject({
        name: "First In",
        whatsappNumber: "+254712345678",
      });
      expect(res.body.requests[0].business.ownerEmail).toContain("@");

      const filtered = await request(app)
        .get("/api/admin/website-requests?status=DECLINED")
        .set(bearer(admin));
      expect(filtered.body.requests).toEqual([]);
    });

    it("move a request through its workflow, leave a reply, and every change is audited", async () => {
      const { seller } = await sellerWithBusiness({ name: "Workflow Co" });
      const created = await submit(seller);
      const admin = await actor("ADMIN");
      const patch = (body: object) =>
        request(app)
          .patch(`/api/admin/website-requests/${created.body.id}`)
          .set(bearer(admin))
          .send(body);

      expect((await patch({ status: "IN_REVIEW", adminNotes: "Call on Monday" })).status).toBe(200);
      const quoted = await patch({
        status: "QUOTED",
        responseNote: "We can do this for KSh 90,000.",
      });
      expect(quoted.body).toMatchObject({
        status: "QUOTED",
        responseNote: "We can do this for KSh 90,000.",
        adminNotes: "Call on Monday",
      });

      const sellerView = await request(app).get("/api/website-requests").set(bearer(seller));
      expect(sellerView.body.requests[0].responseNote).toBe("We can do this for KSh 90,000.");
      expect(JSON.stringify(sellerView.body)).not.toContain("Call on Monday");

      expect((await patch({ status: "ACCEPTED" })).status).toBe(200);
      const done = await patch({ status: "COMPLETED" });
      expect(done.body.status).toBe("COMPLETED");
      expect(done.body.closedAt).not.toBeNull();

      const audit = await prisma.auditLog.findMany({
        where: { entityType: "WebsiteRequest", entityId: created.body.id },
      });
      expect(audit.map((a) => a.action)).toContain("website_request.created");
      expect(audit.filter((a) => a.action === "website_request.updated").length).toBe(4);
      // Notes are never copied into the audit trail.
      expect(JSON.stringify(audit)).not.toContain("Call on Monday");
    });

    it("cannot make impossible status changes", async () => {
      const { seller } = await sellerWithBusiness({ name: "Strict Co" });
      const created = await submit(seller);
      const admin = await actor("ADMIN");
      const patch = (body: object) =>
        request(app)
          .patch(`/api/admin/website-requests/${created.body.id}`)
          .set(bearer(admin))
          .send(body);

      expect((await patch({ status: "COMPLETED" })).status).toBe(409);
      expect((await patch({ status: "NEW" })).status).toBe(400);
      expect((await patch({ status: "CANCELLED" })).status).toBe(400);
      expect((await patch({})).status).toBe(400);
      expect((await patch({ status: "DECLINED" })).status).toBe(200);
      // A closed request stays closed.
      expect((await patch({ status: "IN_REVIEW" })).status).toBe(409);
    });

    it("are the only people who can use the admin endpoints", async () => {
      const { seller } = await sellerWithBusiness({ name: "Curious Co" });
      const created = await submit(seller);
      const customer = await actor("CUSTOMER");
      const id = created.body.id;

      for (const who of [seller, customer]) {
        expect(
          (await request(app).get("/api/admin/website-requests").set(bearer(who))).status,
        ).toBe(403);
        expect(
          (await request(app).get(`/api/admin/website-requests/${id}`).set(bearer(who))).status,
        ).toBe(403);
        expect(
          (
            await request(app)
              .patch(`/api/admin/website-requests/${id}`)
              .set(bearer(who))
              .send({ status: "DECLINED" })
          ).status,
        ).toBe(403);
      }
      expect((await request(app).get("/api/admin/website-requests")).status).toBe(401);
      expect((await prisma.websiteRequest.findUniqueOrThrow({ where: { id } })).status).toBe("NEW");
    });

    it("get a clean 404 for an unknown request", async () => {
      const admin = await actor("ADMIN");
      expect(
        (await request(app).get(`/api/admin/website-requests/${randomUUID()}`).set(bearer(admin)))
          .status,
      ).toBe(404);
      expect(
        (await request(app).get("/api/admin/website-requests/not-a-uuid").set(bearer(admin)))
          .status,
      ).toBe(400);
    });
  });
});
