import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Keeps rate-limit counters in the database so every API instance counts the same visitors
 * together. One counter row per visitor and limiter; the whole update happens in a single SQL
 * statement, so concurrent requests on different instances cannot lose a count. Times come from
 * the database clock, so instances whose clocks differ still agree.
 */
export function createPgRateLimitStore(prisma: PrismaClient, prefix: string): Store {
  let windowMs = 60_000;
  const keyFor = (key: string) => `${prefix}${key}`;

  return {
    prefix,
    localKeys: false,

    init(options: Options) {
      windowMs = options.windowMs;
    },

    async get(key): Promise<ClientRateLimitInfo | undefined> {
      const rows = await prisma.$queryRaw<{ hits: number; resetAt: Date }[]>`
        SELECT "hits", "resetAt" FROM "rate_limit_hits"
        WHERE "key" = ${keyFor(key)} AND "resetAt" > (now() AT TIME ZONE 'UTC')`;
      const row = rows[0];
      return row ? { totalHits: row.hits, resetTime: row.resetAt } : undefined;
    },

    async increment(key): Promise<ClientRateLimitInfo> {
      const rows = await prisma.$queryRaw<{ hits: number; resetAt: Date }[]>`
        INSERT INTO "rate_limit_hits" ("key", "hits", "resetAt")
        VALUES (${keyFor(key)}, 1, (now() AT TIME ZONE 'UTC') + (${windowMs}::int * interval '1 millisecond'))
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE WHEN "rate_limit_hits"."resetAt" <= (now() AT TIME ZONE 'UTC')
                        THEN 1 ELSE "rate_limit_hits"."hits" + 1 END,
          "resetAt" = CASE WHEN "rate_limit_hits"."resetAt" <= (now() AT TIME ZONE 'UTC')
                           THEN EXCLUDED."resetAt" ELSE "rate_limit_hits"."resetAt" END
        RETURNING "hits", "resetAt"`;
      const row = rows[0]!;
      return { totalHits: row.hits, resetTime: row.resetAt };
    },

    async decrement(key) {
      await prisma.$executeRaw`
        UPDATE "rate_limit_hits" SET "hits" = GREATEST("hits" - 1, 0)
        WHERE "key" = ${keyFor(key)}`;
    },

    async resetKey(key) {
      await prisma.$executeRaw`DELETE FROM "rate_limit_hits" WHERE "key" = ${keyFor(key)}`;
    },
  };
}

/** Deletes counters whose window has ended. Safe to repeat. */
export async function purgeExpiredRateLimits(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "rate_limit_hits" WHERE "resetAt" <= (now() AT TIME ZONE 'UTC')`;
}
