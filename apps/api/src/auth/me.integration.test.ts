import { randomUUID } from "node:crypto";
import express from "express";
import { SignJWT, generateKeyPair, type CryptoKey } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";
import { requireRole } from "./authorize.js";
import { requireAuth } from "./middleware.js";
import { createTokenVerifier } from "./token-verifier.js";
import { createPrismaUserStore } from "./user-store.js";

// End-to-end check of token verification + database user sync + role lookup.
// Requires a migrated PostgreSQL database in TEST_DATABASE_URL; skipped otherwise.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ISSUER = "https://project.supabase.co/auth/v1";

describe.skipIf(!testDatabaseUrl)("authenticated API with a real database", () => {
  let app: ReturnType<typeof createApp>;
  let adminOnlyApp: ReturnType<typeof express>;
  let privateKey: CryptoKey;
  const createdEmails: string[] = [];
  const userId = randomUUID();
  const email = `integration-${userId}@example.com`;

  const tokenFor = (sub: string, address: string) => {
    if (!createdEmails.includes(address)) createdEmails.push(address);
    // The token of a person who has completed two-step verification (administrators need it).
    return new SignJWT({ email: address, aal: "aal2" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(privateKey);
  };

  beforeAll(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    const auth = {
      verifyToken: createTokenVerifier(pair.publicKey, { issuer: ISSUER }),
      users: createPrismaUserStore(getPrisma(testDatabaseUrl)),
    };
    app = createApp({ CORS_ORIGIN: [] }, { auth });

    adminOnlyApp = express();
    adminOnlyApp.get("/admin", requireAuth(auth), requireRole("ADMIN"), (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterAll(async () => {
    await getPrisma(testDatabaseUrl).user.deleteMany({ where: { email: { in: createdEmails } } });
    await disconnectPrisma();
  });

  it("creates the user on first request and reuses the row afterwards", async () => {
    const token = await tokenFor(userId, email);
    const first = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    const second = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ id: userId, email, role: "CUSTOMER" });
    expect(second.body.user.id).toBe(userId);
    expect(await getPrisma(testDatabaseUrl).user.count({ where: { id: userId } })).toBe(1);
  });

  it("denies admin routes to a customer, then allows them once promoted in the database", async () => {
    const token = await tokenFor(userId, email);

    const denied = await request(adminOnlyApp)
      .get("/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(denied.status).toBe(403);

    await getPrisma(testDatabaseUrl).user.update({
      where: { id: userId },
      data: { role: "ADMIN" },
    });

    const allowed = await request(adminOnlyApp)
      .get("/admin")
      .set("Authorization", `Bearer ${token}`);
    expect(allowed.status).toBe(200);
  });
});
