import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, testPrisma } from "../test/harness.js";
import { createPgRateLimitStore, purgeExpiredRateLimits } from "./pg-rate-limit-store.js";
import { createRateLimiter } from "./rate-limit.js";

describe.skipIf(!hasDatabase)("shared rate-limit counters", () => {
  const prisma = hasDatabase ? testPrisma() : null!;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "rate_limit_hits"');
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "rate_limit_hits"');
  });

  /** One "instance": its own app and its own store object, sharing only the database. */
  function instance(max: number, windowMs = 60_000) {
    const store = createPgRateLimitStore(prisma, "t:");
    const app = express();
    app.use(createRateLimiter({ windowMs, max }, true, store));
    app.get("/", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("counts a visitor across instances, so two instances cannot double the allowance", async () => {
    const a = instance(3);
    const b = instance(3);
    expect((await request(a).get("/")).status).toBe(200);
    expect((await request(b).get("/")).status).toBe(200);
    expect((await request(a).get("/")).status).toBe(200);
    const blocked = await request(b).get("/");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("counts correctly when requests arrive at the same moment", async () => {
    const a = instance(5);
    const b = instance(5);
    const statuses = (
      await Promise.all(Array.from({ length: 12 }, (_, i) => request(i % 2 ? a : b).get("/")))
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it("starts a fresh count once the window has ended", async () => {
    const app = instance(1, 1000);
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await request(app).get("/")).status).toBe(200);
  });

  it("keeps different limiters apart", async () => {
    const one = express();
    one.use(
      createRateLimiter({ windowMs: 60_000, max: 1 }, true, createPgRateLimitStore(prisma, "one:")),
    );
    one.get("/", (_req, res) => res.json({}));
    const two = express();
    two.use(
      createRateLimiter({ windowMs: 60_000, max: 1 }, true, createPgRateLimitStore(prisma, "two:")),
    );
    two.get("/", (_req, res) => res.json({}));
    expect((await request(one).get("/")).status).toBe(200);
    expect((await request(two).get("/")).status).toBe(200);
    expect((await request(one).get("/")).status).toBe(429);
  });

  it("lets requests through, rather than failing, when the database is unreachable", async () => {
    const broken = createPgRateLimitStore(
      { $queryRaw: () => Promise.reject(new Error("db down")) } as never,
      "x:",
    );
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 1 }, true, broken));
    app.get("/", (_req, res) => res.json({ ok: true }));
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
  });

  it("removes only counters whose window has ended", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "rate_limit_hits" ("key","hits","resetAt") VALUES
       ('old',1,(now() AT TIME ZONE 'UTC') - interval '1 minute'),
       ('live',1,(now() AT TIME ZONE 'UTC') + interval '1 minute')`,
    );
    expect(await purgeExpiredRateLimits(prisma)).toBe(1);
    const left = await prisma.$queryRawUnsafe<{ key: string }[]>(
      'SELECT "key" FROM "rate_limit_hits"',
    );
    expect(left.map((r) => r.key)).toEqual(["live"]);
  });
});
