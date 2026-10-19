import { randomUUID } from "node:crypto";
import type { UserRole } from "@kreatespace/shared";
import { createApp, type AppDeps } from "../app.js";
import { InvalidTokenError, type TokenVerifier } from "../auth/token-verifier.js";
import { createPrismaUserStore } from "../auth/user-store.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrisma } from "../lib/prisma.js";

/** Database-backed suites run only when TEST_DATABASE_URL points at a migrated database. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const hasDatabase = Boolean(testDatabaseUrl);

export function testPrisma(): PrismaClient {
  return getPrisma(testDatabaseUrl);
}

/** Removes all rows created by tests. Seed data (categories) is preserved. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
}

export interface TestActor {
  id: string;
  email: string;
  token: string;
}

/**
 * A test app whose bearer tokens are looked up in a table instead of verified cryptographically
 * (JWT verification itself is covered in auth.test.ts). User rows, roles and the database are real.
 */
export function createTestHarness(overrides: Partial<AppDeps> = {}) {
  const prisma = testPrisma();
  const identities = new Map<string, { userId: string; email: string }>();

  const verifyToken: TokenVerifier = async (token) => {
    const identity = identities.get(token);
    if (!identity) throw new InvalidTokenError();
    return identity;
  };

  const app = createApp(
    { CORS_ORIGIN: [] },
    {
      auth: { verifyToken, users: createPrismaUserStore(prisma) },
      prisma,
      webUrl: "https://kreatespace.test",
      rateLimiting: false,
      ...overrides,
    },
  );

  async function actor(
    role: UserRole,
    email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`,
  ): Promise<TestActor> {
    const id = randomUUID();
    const token = `token-${id}`;
    identities.set(token, { userId: id, email });
    await prisma.user.create({ data: { id, email, role, fullName: `Test ${role}` } });
    return { id, email, token };
  }

  /** Authenticated as someone who has never used the app (no profile row yet). */
  function newcomer(email: string): TestActor {
    const id = randomUUID();
    const token = `token-${id}`;
    identities.set(token, { userId: id, email });
    return { id, email, token };
  }

  return { app, prisma, actor, newcomer };
}

export const bearer = (actor: TestActor) => ({ Authorization: `Bearer ${actor.token}` });
