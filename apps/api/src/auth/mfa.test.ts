import { SignJWT } from "jose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createTokenVerifier } from "../auth/token-verifier.js";
import { createApp } from "../app.js";
import { adminRoutes, ID, sellerRoutes, type Method } from "../security/route-table.js";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";
import { randomUUID } from "node:crypto";

const fill = (path: string) => path.replace(ID, randomUUID());

describe("reading the assurance level from a token", () => {
  const secret = new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!!");
  const issuer = "https://project.supabase.co/auth/v1";
  const verify = createTokenVerifier(secret, { issuer, algorithms: ["HS256"] });
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT({ email: "admin@example.com", ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("6f1c1f0e-8d0f-4b1b-9a3e-2f6a5d1c9b11")
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(secret);

  it("recognises a session that completed the second step, and the time of the last sign-in", async () => {
    const token = await sign({
      aal: "aal2",
      amr: [
        { method: "password", timestamp: 1_800_000_000 },
        { method: "totp", timestamp: 1_800_000_060 },
      ],
    });
    const verified = await verify(token);
    expect(verified.aal).toBe("aal2");
    expect(verified.authenticatedAt).toEqual(new Date(1_800_000_060 * 1000));
  });

  it("treats a missing, unknown or tampered-looking level as the weaker one", async () => {
    for (const claims of [{}, { aal: "aal3" }, { aal: ["aal2"] }, { aal: "AAL2" }, { aal: 2 }]) {
      expect((await verify(await sign(claims))).aal, JSON.stringify(claims)).toBe("aal1");
    }
  });

  it("ignores malformed sign-in times instead of failing", async () => {
    for (const amr of [
      "now",
      [{ timestamp: "yesterday" }],
      [null],
      [{ timestamp: -5 }],
      undefined,
    ]) {
      expect(
        (await verify(await sign({ amr }))).authenticatedAt,
        JSON.stringify(amr),
      ).toBeUndefined();
    }
  });

  it("reports unauthenticated requests as unauthenticated whatever the flag says", async () => {
    const app = createApp(
      { CORS_ORIGIN: [] },
      {
        auth: {
          verifyToken: verify,
          users: {
            findOrCreate: async () => ({ id: "x", email: "x", fullName: null, role: "ADMIN" }),
          },
          adminMfaRequired: false,
        },
        rateLimiting: false,
      },
    );
    expect((await request(app).get("/api/me")).status).toBe(401);
  });
});

const harness = hasDatabase ? createTestHarness() : skippedHarness();
const relaxed = hasDatabase ? createTestHarness({}, { adminMfaRequired: false }) : skippedHarness();

describe.skipIf(!hasDatabase)("two-step verification for administrators", () => {
  const { app, prisma, actor } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const send = (method: Method, path: string, who: { token: string }) =>
    request(app)
      [method](fill(path))
      .set(bearer(who as never))
      .send({});

  it("refuses an administrator who has only signed in with a password, on every admin route", async () => {
    const weak = await actor("ADMIN", undefined, { aal: "aal1" });
    const failures: string[] = [];
    for (const [method, path] of adminRoutes) {
      const res = await send(method, path, weak);
      if (res.status !== 403 || res.body.error?.code !== "MFA_REQUIRED") {
        failures.push(`${method.toUpperCase()} ${path} -> ${res.status} ${res.body.error?.code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("changes nothing when the second step is missing", async () => {
    const weak = await actor("ADMIN", undefined, { aal: "aal1" });
    const before = await prisma.invitation.count();
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(bearer(weak))
      .send({ email: "someone@example.com" });
    expect(res.status).toBe(403);
    expect(await prisma.invitation.count()).toBe(before);
  });

  it("lets an administrator who completed the second step through", async () => {
    const strong = await actor("ADMIN", undefined, { aal: "aal2" });
    expect((await send("get", "/api/admin/analytics", strong)).status).toBe(200);
    expect((await send("get", "/api/admin/invitations", strong)).status).toBe(200);
  });

  it("does not let a seller or customer reach admin routes just by claiming the second step", async () => {
    for (const role of ["SELLER", "CUSTOMER"] as const) {
      const who = await actor(role, undefined, { aal: "aal2" });
      for (const [method, path] of adminRoutes) {
        const res = await send(method, path, who);
        expect(res.status, `${role} ${method} ${path}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
    }
  });

  it("does not ask sellers or customers for a second step", async () => {
    const seller = await actor("SELLER");
    const customer = await actor("CUSTOMER");
    expect((await request(app).get("/api/me").set(bearer(seller))).body.user).not.toHaveProperty(
      "mfa",
    );
    expect((await request(app).get("/api/me").set(bearer(customer))).body.user).not.toHaveProperty(
      "mfa",
    );
    // A seller's own routes work at the weaker level.
    const first = sellerRoutes.find(([, p]) => p === "/api/creations")!;
    expect((await send(first[0], first[1], seller)).status).not.toBe(403);
  });

  it("tells the website whether the second step is required and done", async () => {
    const weak = await actor("ADMIN", undefined, { aal: "aal1" });
    const strong = await actor("ADMIN", undefined, { aal: "aal2" });
    // /api/me stays available at the weaker level, so the website can show the sign-in step.
    const weakMe = await request(app).get("/api/me").set(bearer(weak));
    expect(weakMe.status).toBe(200);
    expect(weakMe.body.user.mfa).toEqual({ required: true, satisfied: false });
    expect((await request(app).get("/api/me").set(bearer(strong))).body.user.mfa).toEqual({
      required: true,
      satisfied: true,
    });
  });

  it("can be switched off for local development only", async () => {
    const weak = await relaxed.actor("ADMIN", undefined, { aal: "aal1" });
    const res = await request(relaxed.app).get("/api/admin/analytics").set(bearer(weak));
    expect(res.status).toBe(200);
    const me = await request(relaxed.app).get("/api/me").set(bearer(weak));
    expect(me.body.user.mfa).toEqual({ required: false, satisfied: false });
  });
});
