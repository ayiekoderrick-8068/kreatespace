import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";

// Malformed tokens are rejected before any database access, so a stub client is enough here.
const deps = {
  auth: {
    verifyToken: async () => {
      throw new Error("not used");
    },
    users: {
      findOrCreate: async () => {
        throw new Error("not used");
      },
    },
  },
  prisma: {} as PrismaClient,
  rateLimiting: true,
};

const lookup = (app: ReturnType<typeof createApp>, ip: string) =>
  request(app).get("/api/invitations/lookup").query({ token: "x" }).set("X-Forwarded-For", ip);

describe("rate limiting behind a proxy", () => {
  it("limits each client address separately when the proxy is trusted", async () => {
    const app = createApp({ CORS_ORIGIN: [], TRUST_PROXY: 1 }, deps);

    let last = 0;
    for (let i = 0; i < 31; i += 1) last = (await lookup(app, "203.0.113.7")).status;
    expect(last).toBe(429);

    // A different visitor behind the same proxy is unaffected.
    expect((await lookup(app, "198.51.100.9")).status).toBe(400);
  });

  it("returns the standard error envelope when limited", async () => {
    const app = createApp({ CORS_ORIGIN: [], TRUST_PROXY: 1 }, deps);
    let res = await lookup(app, "203.0.113.50");
    for (let i = 0; i < 30; i += 1) res = await lookup(app, "203.0.113.50");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});
