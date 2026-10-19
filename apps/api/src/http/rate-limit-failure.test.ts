import request from "supertest";
import type { Store } from "express-rate-limit";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** Counters that cannot be reached, as if the database were down. */
const brokenStore = (): Store => ({
  init() {},
  async get() {
    throw new Error("db down");
  },
  async increment() {
    throw new Error("db down");
  },
  async decrement() {},
  async resetKey() {},
});

// Requests below stop at validation or sign-in, so stand-ins are enough.
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
  rateLimitStore: brokenStore,
};

describe("when the shared rate-limit counters are unavailable", () => {
  const app = createApp({ CORS_ORIGIN: [] }, deps);
  const quiet = () => {
    const original = console.error;
    console.error = () => {};
    return () => {
      console.error = original;
    };
  };

  it("keeps ordinary browsing and sign-in checks working", async () => {
    const restore = quiet();
    try {
      // Reaches the sign-in check instead of failing at the limiter.
      expect((await request(app).get("/api/me")).status).toBe(401);
      expect((await request(app).get("/api/health")).status).toBe(200);
    } finally {
      restore();
    }
  });

  it("keeps anonymous analytics beacons working (they are validated, not refused)", async () => {
    const restore = quiet();
    try {
      const res = await request(app).post("/api/public/events").send({});
      expect(res.status).toBe(400);
    } finally {
      restore();
    }
  });

  it("refuses invitation-token lookups and acceptance instead of allowing unlimited guessing", async () => {
    const restore = quiet();
    try {
      for (const res of [
        await request(app).get("/api/invitations/lookup").query({ token: "x" }),
        await request(app).post("/api/invitations/accept").send({ token: "x" }),
      ]) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("RATE_LIMIT_UNAVAILABLE");
        expect(res.headers["retry-after"]).toBe("30");
      }
    } finally {
      restore();
    }
  });
});
