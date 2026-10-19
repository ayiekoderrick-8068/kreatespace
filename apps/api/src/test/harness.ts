import { randomUUID } from "node:crypto";
import request from "supertest";
import type { UserRole } from "@kreatespace/shared";
import { createApp, type AppDeps } from "../app.js";
import { InvalidTokenError, type TokenVerifier } from "../auth/token-verifier.js";
import { createPrismaUserStore } from "../auth/user-store.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getPrisma } from "../lib/prisma.js";
import { buildBusiness, type BusinessOptions } from "../dev/builders.js";
import { createFakeStorage } from "./fake-storage.js";

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

  const fake = createFakeStorage();

  const app = createApp(
    { CORS_ORIGIN: [] },
    {
      auth: { verifyToken, users: createPrismaUserStore(prisma) },
      prisma,
      storage: fake.storage,
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

  async function categoryId(slug = "cakes"): Promise<string> {
    return (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  }

  /** Valid business details; override fields to test validation. */
  async function businessDetails(overrides: Record<string, unknown> = {}) {
    return {
      businessName: "Cakes by Maria",
      ownerName: "Maria Wanjiku",
      description: "Custom celebration cakes baked fresh to order in Nairobi.",
      categoryId: await categoryId(),
      county: "Nairobi",
      city: "Westlands",
      websiteUrl: "https://cakes-by-maria.vercel.app",
      whatsappNumber: "0712 345 678",
      ...overrides,
    };
  }

  /** Uploads a (fake) image for the owner's business and returns its storage path. */
  async function uploadImage(owner: TestActor): Promise<string> {
    const res = await request(app)
      .post("/api/businesses/me/uploads")
      .set(bearer(owner))
      .send({ contentType: "image/jpeg", size: 100_000 });
    if (res.status !== 201)
      throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    fake.files.add(res.body.path);
    return res.body.path;
  }

  /** Registers a complete business through the API and submits it. Returns its id. */
  async function submittedBusiness(
    owner: TestActor,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const create = await request(app)
      .post("/api/businesses")
      .set(bearer(owner))
      .send(await businessDetails(overrides));
    if (create.status !== 201) throw new Error(`create failed: ${JSON.stringify(create.body)}`);
    const photo = await uploadImage(owner);
    const patch = await request(app)
      .patch("/api/businesses/me")
      .set(bearer(owner))
      .send({ portfolioPaths: [photo], termsAccepted: true, contentAuthorization: true });
    if (patch.status !== 200) throw new Error(`patch failed: ${JSON.stringify(patch.body)}`);
    const submit = await request(app).post("/api/businesses/me/submit").set(bearer(owner));
    if (submit.status !== 200) throw new Error(`submit failed: ${JSON.stringify(submit.body)}`);
    return create.body.businessId;
  }

  /** A seller account that owns a business in the given state (approved by default). */
  async function sellerWithBusiness(
    options: Partial<BusinessOptions> & { status?: BusinessOptions["status"] } = {},
  ) {
    const seller = await actor("SELLER");
    const built = await buildBusiness(prisma, {
      name: `Biz ${randomUUID().slice(0, 8)}`,
      ...options,
      ownerId: seller.id,
    });
    return { seller, ...built };
  }

  return {
    app,
    prisma,
    actor,
    sellerWithBusiness,
    newcomer,
    files: fake.files,
    putFile: fake.put,
    storage: fake.storage,
    categoryId,
    businessDetails,
    uploadImage,
    submittedBusiness,
  };
}

export const bearer = (actor: TestActor) => ({ Authorization: `Bearer ${actor.token}` });
