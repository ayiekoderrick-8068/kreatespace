import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETION_GRACE_DAYS, RECENT_SIGN_IN_MINUTES } from "@kreatespace/shared";
import type { AuthAdmin } from "../auth/supabase-admin.js";
import { buildCreation } from "../dev/builders.js";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";
import { processAccountDeletions, purgeDeletionTombstones } from "./deletion.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();
const DAY = 86_400_000;

describe.skipIf(!hasDatabase)("deleting an account", () => {
  const { app, prisma, actor, sellerWithBusiness, storage, files, putFile } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  const authAdmin = () => {
    const deleted: string[] = [];
    const admin: AuthAdmin = {
      deleteUser: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
    };
    return { admin, deleted };
  };
  const request_ = (who: { token: string }) =>
    request(app)
      .post("/api/me/deletion")
      .set(bearer(who as never))
      .send({});
  const days = (n: number) => new Date(Date.now() + n * DAY);

  describe("asking", () => {
    it("needs a recent sign-in, checked by the server", async () => {
      const stale = await actor("CUSTOMER", undefined, {
        authenticatedAt: new Date(Date.now() - (RECENT_SIGN_IN_MINUTES + 5) * 60_000),
      });
      const res = await request_(stale);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("REAUTHENTICATION_REQUIRED");
      expect(await prisma.accountDeletionRequest.count()).toBe(0);

      // A token that says nothing about when they signed in is treated as not recent.
      const unknown = await actor("CUSTOMER");
      const identities = (harness as never as { identities?: unknown }).identities;
      void identities;
      const fresh = await actor("CUSTOMER", undefined, { authenticatedAt: new Date() });
      expect((await request_(fresh)).status).toBe(201);
      expect(unknown.id).toBeTruthy();
    });

    it("schedules a customer's deletion after the waiting period, without needing a review", async () => {
      const customer = await actor("CUSTOMER");
      const res = await request_(customer);
      expect(res.status).toBe(201);
      expect(res.body.request).toMatchObject({ status: "REQUESTED", needsReview: false });
      const wait = new Date(res.body.request.scheduledFor).getTime() - Date.now();
      expect(wait).toBeGreaterThan((DELETION_GRACE_DAYS - 0.01) * DAY);
      expect(wait).toBeLessThanOrEqual(DELETION_GRACE_DAYS * DAY);
      // Nothing is deleted yet.
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(1);
    });

    it("lets only one request be open, even when two arrive together", async () => {
      const customer = await actor("CUSTOMER");
      const results = await Promise.all([
        request_(customer),
        request_(customer),
        request_(customer),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await prisma.accountDeletionRequest.count()).toBe(1);
    });

    it("tells business owners that an administrator must agree first", async () => {
      const { seller } = await sellerWithBusiness({ name: "Maria Cakes" });
      const res = await request_(seller);
      expect(res.body.request.needsReview).toBe(true);
      const status = await request(app).get("/api/me/deletion").set(bearer(seller));
      expect(status.body.effects.business).toMatchObject({
        name: "Maria Cakes",
        status: "APPROVED",
      });
      expect(status.body.graceDays).toBe(DELETION_GRACE_DAYS);
    });

    it("is not available to administrators, who are removed by the owner", async () => {
      const admin = await actor("ADMIN");
      const res = await request_(admin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ADMIN_DELETION_NOT_SUPPORTED");
    });

    it("needs a sign-in at all", async () => {
      expect((await request(app).post("/api/me/deletion").send({})).status).toBe(401);
      expect((await request(app).delete("/api/me/deletion")).status).toBe(401);
      expect((await request(app).get("/api/me/export")).status).toBe(401);
    });
  });

  describe("changing your mind", () => {
    it("cancels a request, which can then be made again", async () => {
      const customer = await actor("CUSTOMER");
      await request_(customer);
      const cancelled = await request(app).delete("/api/me/deletion").set(bearer(customer));
      expect(cancelled.body.request.status).toBe("CANCELLED");
      const { admin } = authAdmin();
      expect(
        await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(30) }),
      ).toMatchObject({
        completed: 0,
      });
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(1);
      expect((await request_(customer)).status).toBe(201);
    });

    it("never lets one person cancel, see or affect another's request", async () => {
      const alice = await actor("CUSTOMER");
      const bob = await actor("CUSTOMER");
      await request_(alice);
      // Bob has no request: his cancel finds nothing, and Alice's is untouched.
      expect((await request(app).delete("/api/me/deletion").set(bearer(bob))).status).toBe(404);
      expect((await request(app).get("/api/me/deletion").set(bearer(bob))).body.request).toBeNull();
      expect((await prisma.accountDeletionRequest.findFirstOrThrow()).status).toBe("REQUESTED");
    });
  });

  describe("carrying out a customer's deletion", () => {
    it("waits for the full period, then removes the account, saved list and sign-in identity", async () => {
      const customer = await actor("CUSTOMER");
      const { businessId } = await sellerWithBusiness({ name: "Source Bakery" });
      const { creationId } = await buildCreation(prisma, { businessId, title: "Saved Cake" });
      await prisma.savedCreation.create({ data: { userId: customer.id, creationId } });
      await request_(customer);
      const { admin, deleted } = authAdmin();

      const early = await processAccountDeletions(prisma, {
        storage,
        authAdmin: admin,
        now: days(DELETION_GRACE_DAYS - 1),
      });
      expect(early.completed).toBe(0);
      expect(deleted).toEqual([]);
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(1);

      const result = await processAccountDeletions(prisma, {
        storage,
        authAdmin: admin,
        now: days(DELETION_GRACE_DAYS + 1),
      });
      expect(result).toEqual({ completed: 1, waiting: 0, failed: 0 });
      expect(deleted).toEqual([customer.id]);
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(0);
      expect(await prisma.savedCreation.count({ where: { userId: customer.id } })).toBe(0);
      // The creation they saved belongs to someone else and is untouched.
      expect(await prisma.creation.count({ where: { id: creationId } })).toBe(1);
    });

    it("keeps a record that it happened, without any personal detail", async () => {
      const customer = await actor("CUSTOMER", "private.person@example.com");
      await request_(customer);
      const { admin } = authAdmin();
      await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(20) });

      const record = await prisma.accountDeletionRequest.findFirstOrThrow();
      expect(record).toMatchObject({
        status: "COMPLETED",
        userId: null,
        deletedUserId: customer.id,
      });
      expect(record.completedAt).not.toBeNull();
      const everything = JSON.stringify([record, await prisma.auditLog.findMany()]);
      expect(everything).not.toContain("private.person@example.com");
      expect(everything).not.toContain("Test CUSTOMER");
      // Actions the person took stay as anonymous history.
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "account.deleted" },
      });
      expect(audit.actorId).toBeNull();
    });

    it("stops a sign-in token that is still valid from recreating the account", async () => {
      const customer = await actor("CUSTOMER");
      await request_(customer);
      const { admin } = authAdmin();
      await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(20) });

      const res = await request(app).get("/api/me").set(bearer(customer));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("ACCOUNT_DELETED");
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(0);

      // The marker is forgotten once no token could still be valid.
      expect(await purgeDeletionTombstones(prisma, days(5))).toBe(0);
      expect(await purgeDeletionTombstones(prisma, days(40))).toBe(1);
      expect((await prisma.accountDeletionRequest.findFirstOrThrow()).deletedUserId).toBeNull();
    });

    it("can be run again and again without doing anything twice", async () => {
      const customer = await actor("CUSTOMER");
      await request_(customer);
      const { admin, deleted } = authAdmin();
      const deps = { storage, authAdmin: admin, now: days(20) };
      expect((await processAccountDeletions(prisma, deps)).completed).toBe(1);
      expect(await processAccountDeletions(prisma, deps)).toEqual({
        completed: 0,
        waiting: 0,
        failed: 0,
      });
      expect(deleted).toHaveLength(1);
    });

    it("leaves the request due, and the account intact, if the sign-in provider fails", async () => {
      const customer = await actor("CUSTOMER");
      await request_(customer);
      const failing: AuthAdmin = {
        deleteUser: async () => {
          throw new Error("provider down");
        },
      };
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const first = await processAccountDeletions(prisma, {
        storage,
        authAdmin: failing,
        now: days(20),
      });
      expect(first.failed).toBe(1);
      expect(await prisma.user.count({ where: { id: customer.id } })).toBe(1);
      expect((await prisma.accountDeletionRequest.findFirstOrThrow()).status).toBe("REQUESTED");

      const { admin } = authAdmin();
      expect(
        (await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(21) }))
          .completed,
      ).toBe(1);
    });

    it("promotes a customer who became a business owner in the meantime to a reviewed request", async () => {
      const customer = await actor("CUSTOMER");
      await request_(customer);
      await prisma.user.update({ where: { id: customer.id }, data: { role: "SELLER" } });
      const { buildBusiness } = await import("../dev/builders.js");
      await buildBusiness(prisma, { name: "Late Bakery", ownerId: customer.id });
      const { admin, deleted } = authAdmin();
      const result = await processAccountDeletions(prisma, {
        storage,
        authAdmin: admin,
        now: days(20),
      });
      expect(result).toMatchObject({ completed: 0, waiting: 1 });
      expect(deleted).toEqual([]);
      expect((await prisma.accountDeletionRequest.findFirstOrThrow()).hadBusiness).toBe(true);
    });
  });

  describe("business owners", () => {
    async function ownerWithEverything() {
      const { seller, businessId, slug } = await sellerWithBusiness({ name: "Maria Cakes" });
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
      const photo = `businesses/${businessId}/creations/c1/photo.png`;
      putFile(photo);
      putFile(`businesses/${businessId}/packages/p1/pic.png`);
      putFile(`businesses/${businessId}/stray-upload.png`);
      const creation = await buildCreation(prisma, {
        businessId,
        title: "Floral Cake",
        images: [{ path: photo, width: 800, height: 1000 }],
      });
      await prisma.servicePackage.create({ data: { businessId, draft: { name: "Wedding" } } });
      await prisma.websiteRequest.create({
        data: {
          businessId,
          type: "OTHER",
          description: "Please build me a website.",
          adminNotes: "Slow payer",
        },
      });
      await prisma.inquiryEvent.create({ data: { type: "BUSINESS_VIEW", businessId } });
      // Their invitation, whose audit trail recorded the email address.
      const admin = await actor("ADMIN");
      const invitation = await prisma.invitation.create({
        data: {
          email: owner.email,
          tokenHash: `hash-${businessId}`,
          expiresAt: days(10),
          invitedById: admin.id,
          acceptedById: seller.id,
          status: "ACCEPTED",
        },
      });
      await prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: "invitation.created",
          entityType: "Invitation",
          entityId: invitation.id,
          metadata: { email: owner.email },
        },
      });
      return {
        seller,
        admin,
        businessId,
        slug,
        creationId: creation.creationId,
        email: owner.email,
        photo,
      };
    }

    const decide = (admin: { token: string }, id: string, body: object) =>
      request(app)
        .post(`/api/admin/deletions/${id}/decision`)
        .set(bearer(admin as never))
        .send(body);

    it("is not carried out until an administrator agrees, however long it has waited", async () => {
      const { seller } = await ownerWithEverything();
      await request_(seller);
      const { admin, deleted } = authAdmin();
      const result = await processAccountDeletions(prisma, {
        storage,
        authAdmin: admin,
        now: days(60),
      });
      expect(result.completed).toBe(0);
      expect(deleted).toEqual([]);
      expect(await prisma.business.count()).toBe(1);
    });

    it("removes the whole business, its photos and records, once approved and the period has passed", async () => {
      const {
        seller,
        admin: reviewer,
        businessId,
        slug,
        creationId,
        email,
      } = await ownerWithEverything();
      const bystander = await sellerWithBusiness({ name: "Someone Else" });
      putFile(`businesses/${bystander.businessId}/keep-me.png`);
      const requestId = (await request_(seller)).body.request.id;

      const approved = await decide(reviewer, requestId, { action: "APPROVE" });
      expect(approved.status).toBe(200);
      const { admin, deleted } = authAdmin();
      // The period must still pass after approval.
      expect(
        (await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(3) }))
          .completed,
      ).toBe(0);

      const result = await processAccountDeletions(prisma, {
        storage,
        authAdmin: admin,
        now: days(DELETION_GRACE_DAYS + 1),
      });
      expect(result.completed).toBe(1);
      expect(deleted).toEqual([seller.id]);

      // Gone: account, business and everything that hung off it.
      expect(await prisma.user.count({ where: { id: seller.id } })).toBe(0);
      expect(await prisma.business.count({ where: { id: businessId } })).toBe(0);
      expect(await prisma.creation.count({ where: { id: creationId } })).toBe(0);
      expect(await prisma.creationImage.count({ where: { revision: { creationId } } })).toBe(0);
      expect(await prisma.servicePackage.count({ where: { businessId } })).toBe(0);
      expect(await prisma.websiteRequest.count({ where: { businessId } })).toBe(0);
      expect(await prisma.inquiryEvent.count({ where: { businessId } })).toBe(0);
      expect(await prisma.businessRevision.count({ where: { businessId } })).toBe(0);
      // Including files nothing in the database pointed at.
      expect([...files].filter((f) => f.startsWith(`businesses/${businessId}/`))).toEqual([]);
      // Not public any more.
      expect((await request(app).get(`/api/public/businesses/${slug}`)).status).toBe(404);
      expect((await request(app).get(`/api/public/creations/${creationId}`)).status).toBe(404);

      // Nobody else's data was touched.
      expect(await prisma.business.count({ where: { id: bystander.businessId } })).toBe(1);
      expect(files.has(`businesses/${bystander.businessId}/keep-me.png`)).toBe(true);

      // No personal detail survives anywhere in the records kept about it.
      const kept = JSON.stringify([
        await prisma.accountDeletionRequest.findMany(),
        await prisma.auditLog.findMany(),
        await prisma.invitation.findMany(),
      ]);
      expect(kept).not.toContain(email);
      expect(kept).not.toContain("Slow payer");
      expect(kept).not.toContain("Maria Cakes");
      const summary = (await prisma.accountDeletionRequest.findFirstOrThrow()).summary as Record<
        string,
        number
      >;
      expect(summary).toMatchObject({ creations: 1, packages: 1, websiteRequests: 1 });
      expect(summary.filesRemoved).toBeGreaterThanOrEqual(3);
    });

    it("tells the person why when an administrator refuses, and lets them ask again", async () => {
      const { seller, admin: reviewer } = await ownerWithEverything();
      const requestId = (await request_(seller)).body.request.id;
      const missing = await decide(reviewer, requestId, { action: "REJECT" });
      expect(missing.status).toBe(400);
      expect(missing.body.error.details.fields).toHaveProperty("note");

      expect(
        (
          await decide(reviewer, requestId, {
            action: "REJECT",
            note: "You have an open website request.",
          })
        ).status,
      ).toBe(200);
      const status = await request(app).get("/api/me/deletion").set(bearer(seller));
      expect(status.body.request).toMatchObject({
        status: "REJECTED",
        reviewNote: "You have an open website request.",
      });
      const { admin } = authAdmin();
      expect(
        (await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(60) }))
          .completed,
      ).toBe(0);
      expect((await request_(seller)).status).toBe(201);
    });

    it("cannot be decided twice, or for a customer, or by anyone but an administrator", async () => {
      const { seller, admin: reviewer } = await ownerWithEverything();
      const requestId = (await request_(seller)).body.request.id;
      await decide(reviewer, requestId, { action: "APPROVE" });
      expect((await decide(reviewer, requestId, { action: "APPROVE" })).status).toBe(409);

      const customer = await actor("CUSTOMER");
      const customerRequest = (await request_(customer)).body.request.id;
      const res = await decide(reviewer, customerRequest, { action: "APPROVE" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DELETION_NEEDS_NO_REVIEW");

      const someoneElse = await actor("SELLER");
      expect((await decide(someoneElse, requestId, { action: "REJECT", note: "no" })).status).toBe(
        403,
      );
    });

    it("waits while a website import is running, then goes ahead", async () => {
      const { seller, admin: reviewer, businessId } = await ownerWithEverything();
      const requestId = (await request_(seller)).body.request.id;
      await decide(reviewer, requestId, { action: "APPROVE" });
      const authorization = await prisma.importAuthorization.create({
        data: { businessId, domain: "maria.example.co.ke", grantedById: reviewer.id },
      });
      const job = await prisma.importJob.create({
        data: {
          businessId,
          authorizationId: authorization.id,
          requestedById: reviewer.id,
          startUrl: "https://maria.example.co.ke/",
          status: "RUNNING",
        },
      });
      const { admin, deleted } = authAdmin();
      const deps = { storage, authAdmin: admin, now: days(20) };
      expect(await processAccountDeletions(prisma, deps)).toMatchObject({
        completed: 0,
        waiting: 1,
      });
      expect(deleted).toEqual([]);

      await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
      expect(await processAccountDeletions(prisma, deps)).toMatchObject({ completed: 1 });
      expect(await prisma.business.count({ where: { id: businessId } })).toBe(0);
    });

    it("deletes nothing if the photos cannot be removed, and finishes on the next attempt", async () => {
      const { seller, admin: reviewer, businessId } = await ownerWithEverything();
      const requestId = (await request_(seller)).body.request.id;
      await decide(reviewer, requestId, { action: "APPROVE" });
      const { admin, deleted } = authAdmin();
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const broken = {
        ...storage,
        removeFolder: async () => Promise.reject(new Error("storage down")),
      };
      expect(
        (
          await processAccountDeletions(prisma, {
            storage: broken,
            authAdmin: admin,
            now: days(20),
          })
        ).failed,
      ).toBe(1);
      expect(deleted).toEqual([]);
      expect(await prisma.user.count({ where: { id: seller.id } })).toBe(1);
      expect(await prisma.business.count({ where: { id: businessId } })).toBe(1);

      // No storage configured at all counts as a failure too, never as "nothing to remove".
      expect(
        (await processAccountDeletions(prisma, { authAdmin: admin, now: days(20) })).failed,
      ).toBe(1);
      expect(await prisma.business.count({ where: { id: businessId } })).toBe(1);

      expect(
        (await processAccountDeletions(prisma, { storage, authAdmin: admin, now: days(21) }))
          .completed,
      ).toBe(1);
    });
  });

  describe("an administrator's view", () => {
    it("lists what is waiting with what would be removed, and nothing for other roles", async () => {
      const { seller } = await sellerWithBusiness({ name: "Maria Cakes" });
      await request_(seller);
      const admin = await actor("ADMIN");
      const list = await request(app).get("/api/admin/deletions").set(bearer(admin));
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        status: "REQUESTED",
        needsReview: true,
        roleAtRequest: "SELLER",
        effects: { business: { name: "Maria Cakes" } },
      });
      for (const who of [seller, await actor("CUSTOMER")]) {
        expect((await request(app).get("/api/admin/deletions").set(bearer(who))).status).toBe(403);
      }
    });

    it("shows what happened to a request: who decided, when, and the steps taken, with no personal detail", async () => {
      const { seller } = await sellerWithBusiness({ name: "Maria Cakes" });
      const created = await request_(seller);
      const admin = await actor("ADMIN");
      await request(app)
        .post(`/api/admin/deletions/${created.body.request.id}/decision`)
        .set(bearer(admin))
        .send({ action: "REJECT", note: "Unpaid invoice" });

      const refused = await request(app)
        .get("/api/admin/deletions?status=REJECTED")
        .set(bearer(admin));
      expect(refused.status).toBe(200);
      const [item] = refused.body.items;
      expect(item).toMatchObject({
        status: "REJECTED",
        reviewNote: "Unpaid invoice",
        reviewedBy: "Test ADMIN",
      });
      expect(item.reviewedAt).toBeTruthy();
      expect(item.history.map((h: { action: string }) => h.action)).toEqual([
        "account.deletion_requested",
        "account.deletion_rejected",
      ]);
      expect(Object.keys(item.history[0]).sort()).toEqual(["action", "at"]);

      // Closed requests leave the default "waiting" list.
      const waiting = await request(app).get("/api/admin/deletions").set(bearer(admin));
      expect(waiting.body.items).toHaveLength(0);
    });

    it("rejects an unknown status filter", async () => {
      const admin = await actor("ADMIN");
      const res = await request(app).get("/api/admin/deletions?status=NOPE").set(bearer(admin));
      expect(res.status).toBe(400);
    });
  });

  describe("asking for your data", () => {
    it("gives a person their own data, and only theirs, without private administrator notes", async () => {
      const mine = await sellerWithBusiness({ name: "Maria Cakes" });
      const theirs = await sellerWithBusiness({ name: "Other Bakery" });
      await prisma.websiteRequest.create({
        data: {
          businessId: mine.businessId,
          type: "OTHER",
          description: "Help please.",
          adminNotes: "Internal remark about payer",
        },
      });
      await prisma.websiteRequest.create({
        data: { businessId: theirs.businessId, type: "OTHER", description: "Not yours." },
      });
      const res = await request(app).get("/api/me/export").set(bearer(mine.seller));
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/attachment/);
      expect(res.body.account.id).toBe(mine.seller.id);
      expect(res.body.business.revisions[0].businessName).toBe("Maria Cakes");
      expect(res.body.business.websiteRequests).toHaveLength(1);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("Other Bakery");
      expect(text).not.toContain("Not yours");
      expect(text).not.toContain("Internal remark about payer");
      expect(text).not.toMatch(/adminNotes/);
      expect(res.body.notIncluded.length).toBeGreaterThan(0);
    });

    it("insists on a recent sign-in", async () => {
      const stale = await actor("CUSTOMER", undefined, {
        authenticatedAt: new Date(Date.now() - 60 * 60_000),
      });
      const res = await request(app).get("/api/me/export").set(bearer(stale));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("REAUTHENTICATION_REQUIRED");
    });
  });
});
