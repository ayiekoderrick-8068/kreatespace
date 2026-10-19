import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { disconnectPrisma, getPrisma } from "./prisma.js";

// Runs against a migrated PostgreSQL database. Set TEST_DATABASE_URL and run
// `prisma migrate deploy` against it first; the suite is skipped otherwise.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("database schema", () => {
  const prisma = () => getPrisma(testDatabaseUrl);

  beforeEach(async () => {
    await prisma().invitation.deleteMany();
    await prisma().user.deleteMany();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createAdmin() {
    return prisma().user.create({
      data: { id: randomUUID(), email: "admin@kreatespace.test", role: "ADMIN" },
    });
  }

  it("defaults new users to the CUSTOMER role", async () => {
    const user = await prisma().user.create({
      data: { id: randomUUID(), email: "customer@example.com" },
    });
    expect(user.role).toBe("CUSTOMER");
  });

  it("enforces unique user emails", async () => {
    await prisma().user.create({ data: { id: randomUUID(), email: "dup@example.com" } });
    await expect(
      prisma().user.create({ data: { id: randomUUID(), email: "dup@example.com" } }),
    ).rejects.toThrow();
  });

  it("creates pending invitations tied to the inviting admin", async () => {
    const admin = await createAdmin();
    const invitation = await prisma().invitation.create({
      data: {
        email: "seller@example.com",
        tokenHash: "hash-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: admin.id,
      },
    });
    expect(invitation.status).toBe("PENDING");
    expect(invitation.acceptedAt).toBeNull();
  });

  it("enforces unique invitation token hashes", async () => {
    const admin = await createAdmin();
    const data = {
      email: "a@example.com",
      tokenHash: "same-hash",
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: admin.id,
    };
    await prisma().invitation.create({ data });
    await expect(prisma().invitation.create({ data })).rejects.toThrow();
  });

  it("prevents deleting an admin who has sent invitations", async () => {
    const admin = await createAdmin();
    await prisma().invitation.create({
      data: {
        email: "b@example.com",
        tokenHash: "hash-2",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: admin.id,
      },
    });
    await expect(prisma().user.delete({ where: { id: admin.id } })).rejects.toThrow();
  });
});
