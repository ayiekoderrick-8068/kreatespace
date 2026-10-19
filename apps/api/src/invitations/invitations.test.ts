import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  createTestHarness,
  skippedHarness,
  hasDatabase,
  resetDatabase,
} from "../test/harness.js";
import { hashToken } from "./service.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

function tokenFromUrl(inviteUrl: string): string {
  return inviteUrl.split("/invite/")[1]!;
}

describe.skipIf(!hasDatabase)("seller invitations", () => {
  const { app, prisma, actor, newcomer } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function issue(adminToken: Awaited<ReturnType<typeof actor>>, email: string) {
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(bearer(adminToken))
      .send({ email });
    return res;
  }

  describe("issuing and managing (admin only)", () => {
    it("lets an admin create an invitation and returns a one-time link", async () => {
      const admin = await actor("ADMIN");
      const res = await issue(admin, "Maria@Example.com");

      expect(res.status).toBe(201);
      expect(res.body.invitation).toMatchObject({ email: "maria@example.com", status: "PENDING" });
      expect(res.body.inviteUrl).toMatch(
        /^https:\/\/kreatespace\.test\/invite\/[A-Za-z0-9_-]{43}$/,
      );

      const token = tokenFromUrl(res.body.inviteUrl);
      const stored = await prisma.invitation.findFirstOrThrow();
      expect(stored.tokenHash).toBe(hashToken(token));
      expect(stored.tokenHash).not.toContain(token);
    });

    it("records an audit entry for the admin action", async () => {
      const admin = await actor("ADMIN");
      await issue(admin, "maria@example.com");
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: "invitation.created" },
      });
      expect(entry.actorId).toBe(admin.id);
    });

    it.each(["CUSTOMER", "SELLER"] as const)("rejects %s accounts", async (role) => {
      const user = await actor(role);
      expect((await issue(user, "x@example.com")).status).toBe(403);
      const list = await request(app).get("/api/admin/invitations").set(bearer(user));
      expect(list.status).toBe(403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).post("/api/admin/invitations").send({ email: "a@b.co" });
      expect(res.status).toBe(401);
    });

    it("validates the email address", async () => {
      const admin = await actor("ADMIN");
      const res = await issue(admin, "not-an-email");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a second active invitation for the same email", async () => {
      const admin = await actor("ADMIN");
      await issue(admin, "maria@example.com");
      const again = await issue(admin, "MARIA@example.com");
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("INVITATION_EXISTS");
    });

    it("refuses to invite someone who is already a seller", async () => {
      const admin = await actor("ADMIN");
      const seller = await actor("SELLER");
      const res = await issue(admin, seller.email);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_SELLER");
    });

    it("lists invitations with their effective status", async () => {
      const admin = await actor("ADMIN");
      await issue(admin, "one@example.com");
      await prisma.invitation.create({
        data: {
          email: "old@example.com",
          tokenHash: "expired-hash",
          expiresAt: new Date(Date.now() - 1000),
          invitedById: admin.id,
        },
      });
      const res = await request(app).get("/api/admin/invitations").set(bearer(admin));
      const byEmail = Object.fromEntries(
        res.body.invitations.map((i: { email: string; status: string }) => [i.email, i.status]),
      );
      expect(byEmail).toEqual({ "one@example.com": "PENDING", "old@example.com": "EXPIRED" });
    });

    it("revokes a pending invitation once, and never an already revoked one", async () => {
      const admin = await actor("ADMIN");
      const created = await issue(admin, "maria@example.com");
      const id = created.body.invitation.id;

      const revoked = await request(app)
        .post(`/api/admin/invitations/${id}/revoke`)
        .set(bearer(admin));
      expect(revoked.status).toBe(200);
      expect(revoked.body.invitation.status).toBe("REVOKED");

      const again = await request(app)
        .post(`/api/admin/invitations/${id}/revoke`)
        .set(bearer(admin));
      expect(again.status).toBe(409);
    });

    it("returns 404 when revoking an unknown invitation", async () => {
      const admin = await actor("ADMIN");
      const res = await request(app)
        .post("/api/admin/invitations/5f7d1a57-0f0e-4a77-8c63-0f2c1f6d3b11/revoke")
        .set(bearer(admin));
      expect(res.status).toBe(404);
    });

    it("prevents non-admins from revoking", async () => {
      const admin = await actor("ADMIN");
      const customer = await actor("CUSTOMER");
      const created = await issue(admin, "maria@example.com");
      const res = await request(app)
        .post(`/api/admin/invitations/${created.body.invitation.id}/revoke`)
        .set(bearer(customer));
      expect(res.status).toBe(403);
    });
  });

  describe("looking up and accepting", () => {
    async function invitationFor(email: string) {
      const admin = await actor("ADMIN");
      const res = await issue(admin, email);
      return { admin, token: tokenFromUrl(res.body.inviteUrl), id: res.body.invitation.id };
    }

    it("reports a valid link with the invited email", async () => {
      const { token } = await invitationFor("maria@example.com");
      const res = await request(app).get("/api/invitations/lookup").query({ token });
      expect(res.body).toEqual({ valid: true, email: "maria@example.com" });
    });

    it("does not reveal anything for unknown, malformed, revoked or expired links", async () => {
      const { token, id, admin } = await invitationFor("maria@example.com");
      const unknown = await request(app)
        .get("/api/invitations/lookup")
        .query({ token: "a".repeat(43) });
      expect(unknown.body).toEqual({ valid: false });

      const malformed = await request(app).get("/api/invitations/lookup").query({ token: "x" });
      expect(malformed.status).toBe(400);

      await request(app).post(`/api/admin/invitations/${id}/revoke`).set(bearer(admin));
      const revoked = await request(app).get("/api/invitations/lookup").query({ token });
      expect(revoked.body).toEqual({ valid: false });
    });

    it("promotes the invited customer to seller and consumes the invitation", async () => {
      const { token } = await invitationFor("maria@example.com");
      const maria = await actor("CUSTOMER", "maria@example.com");

      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(maria))
        .send({ token });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("SELLER");

      const user = await prisma.user.findUniqueOrThrow({ where: { id: maria.id } });
      expect(user.role).toBe("SELLER");
      const invitation = await prisma.invitation.findFirstOrThrow();
      expect(invitation).toMatchObject({ status: "ACCEPTED", acceptedById: maria.id });
      expect(await prisma.auditLog.count({ where: { action: "invitation.accepted" } })).toBe(1);

      const me = await request(app).get("/api/me").set(bearer(maria));
      expect(me.body.user.role).toBe("SELLER");
    });

    it("works for someone signing in for the first time", async () => {
      const { token } = await invitationFor("fresh@example.com");
      const fresh = newcomer("fresh@example.com");
      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(fresh))
        .send({ token });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).role).toBe(
        "SELLER",
      );
    });

    it("rejects a token that was issued to another email address", async () => {
      const { token } = await invitationFor("maria@example.com");
      const mallory = await actor("CUSTOMER", "mallory@example.com");
      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(mallory))
        .send({ token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVITATION_EMAIL_MISMATCH");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: mallory.id } })).role).toBe(
        "CUSTOMER",
      );
      expect((await prisma.invitation.findFirstOrThrow()).status).toBe("PENDING");
    });

    it("rejects reuse of an accepted invitation", async () => {
      const { token } = await invitationFor("maria@example.com");
      const maria = await actor("CUSTOMER", "maria@example.com");
      await request(app).post("/api/invitations/accept").set(bearer(maria)).send({ token });
      const again = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(maria))
        .send({ token });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("INVITATION_USED");
    });

    it("rejects expired invitations", async () => {
      const { token } = await invitationFor("maria@example.com");
      await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const maria = await actor("CUSTOMER", "maria@example.com");
      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(maria))
        .send({ token });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITATION_EXPIRED");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: maria.id } })).role).toBe(
        "CUSTOMER",
      );
    });

    it("rejects revoked invitations", async () => {
      const { token, id, admin } = await invitationFor("maria@example.com");
      await request(app).post(`/api/admin/invitations/${id}/revoke`).set(bearer(admin));
      const maria = await actor("CUSTOMER", "maria@example.com");
      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(maria))
        .send({ token });
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("INVITATION_REVOKED");
    });

    it("rejects unknown tokens and requires authentication", async () => {
      const maria = await actor("CUSTOMER", "maria@example.com");
      const unknown = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(maria))
        .send({ token: "b".repeat(43) });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.code).toBe("INVALID_INVITATION");

      const anonymous = await request(app)
        .post("/api/invitations/accept")
        .send({ token: "b".repeat(43) });
      expect(anonymous.status).toBe(401);
    });

    it("lets exactly one of several simultaneous acceptances succeed", async () => {
      const { token } = await invitationFor("maria@example.com");
      const maria = await actor("CUSTOMER", "maria@example.com");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app).post("/api/invitations/accept").set(bearer(maria)).send({ token }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { action: "invitation.accepted" } })).toBe(1);
    });

    it("never demotes an admin who somehow holds a valid invitation", async () => {
      const issuer = await actor("ADMIN");
      const created = await issue(issuer, "boss@example.com");
      const boss = await actor("ADMIN", "boss@example.com"); // promoted after the invite was issued
      const res = await request(app)
        .post("/api/invitations/accept")
        .set(bearer(boss))
        .send({ token: tokenFromUrl(created.body.inviteUrl) });
      expect(res.body.role).toBe("ADMIN");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: boss.id } })).role).toBe("ADMIN");
    });
  });

  describe("rate limiting", () => {
    it("throttles repeated lookups from one client", async () => {
      const limited = createTestHarness({ rateLimiting: true });
      let lastStatus = 0;
      for (let i = 0; i < 31; i += 1) {
        lastStatus = (
          await request(limited.app)
            .get("/api/invitations/lookup")
            .query({ token: "a".repeat(43) })
        ).status;
      }
      expect(lastStatus).toBe(429);
    });
  });
});
