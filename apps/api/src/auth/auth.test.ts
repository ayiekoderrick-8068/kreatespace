import { SignJWT, generateKeyPair, type CryptoKey } from "jose";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createTokenVerifier } from "./token-verifier.js";
import type { AppUser, UserStore } from "./user-store.js";

const ISSUER = "https://project.supabase.co/auth/v1";
const USER_ID = "6f1c1f0e-8d0f-4b1b-9a3e-2f6a5d1c9b11";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let app: ReturnType<typeof createApp>;
const store = new Map<string, AppUser>();

const users: UserStore = {
  async findOrCreate(identity) {
    const existing = store.get(identity.userId);
    if (existing) return existing;
    const created: AppUser = {
      id: identity.userId,
      email: identity.email,
      fullName: identity.fullName ?? null,
      role: "CUSTOMER",
    };
    store.set(identity.userId, created);
    return created;
  },
};

function sign(
  overrides: { issuer?: string; audience?: string; expiresIn?: string; key?: CryptoKey } = {},
  claims: Record<string, unknown> = {},
) {
  return new SignJWT({ email: "Maria@Example.com", ...claims })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(USER_ID)
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(overrides.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair("ES256")).privateKey;
  app = createApp(
    { CORS_ORIGIN: ["http://localhost:5173"] },
    { auth: { verifyToken: createTokenVerifier(pair.publicKey, { issuer: ISSUER }), users } },
  );
});

describe("GET /api/me", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects malformed authorization headers", async () => {
    const res = await request(app).get("/api/me").set("Authorization", "Basic abc");
    expect(res.status).toBe(401);
  });

  it("rejects garbage tokens", async () => {
    const res = await request(app).get("/api/me").set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });

  it("rejects tokens signed with a different key", async () => {
    const token = await sign({ key: otherPrivateKey });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const token = await sign({ expiresIn: "-1m" });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects tokens from another issuer", async () => {
    const token = await sign({ issuer: "https://evil.example/auth/v1" });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects tokens with the wrong audience", async () => {
    const token = await sign({ audience: "anon" });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("returns the profile for a valid token, creating a customer on first sign-in", async () => {
    const token = await sign({}, { user_metadata: { full_name: "Maria Wanjiku" } });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: USER_ID,
      email: "maria@example.com",
      fullName: "Maria Wanjiku",
      role: "CUSTOMER",
    });
  });

  it("never grants a role from token claims", async () => {
    store.clear();
    const token = await sign({}, { role: "ADMIN", app_metadata: { role: "ADMIN" } });
    const res = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("CUSTOMER");
  });
});

describe("when authentication is not configured", () => {
  it("responds with 503 on protected routes", async () => {
    const unconfigured = createApp({ CORS_ORIGIN: [] });
    const res = await request(unconfigured).get("/api/me");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AUTH_NOT_CONFIGURED");
  });
});
