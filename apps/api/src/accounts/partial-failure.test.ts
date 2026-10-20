import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createFakeStorage } from "../test/fake-storage.js";
import { hasDatabase, resetDatabase, testPrisma } from "../test/harness.js";
import { processAccountDeletions } from "./deletion.js";

/**
 * The last step of a deletion removes the records in one database transaction. If that transaction
 * fails after the photos and the sign-in identity are already gone, nothing may be half-deleted,
 * and the next run must finish the job.
 */
describe.skipIf(!hasDatabase)("deletion that fails in its final database step", () => {
  const prisma = hasDatabase ? testPrisma() : null!;
  const day = 86_400_000;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await resetDatabase(prisma);
  });

  /** A client whose transactions fail, as if the database dropped the connection. */
  const failingTransactions = (): PrismaClient =>
    new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "$transaction") {
          return async () => {
            throw new Error("connection lost");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

  async function dueBusinessOwner() {
    const business = await buildBusiness(prisma, { name: "Partial Bakery" });
    await buildCreation(prisma, { businessId: business.businessId, title: "Cake" });
    const request = await prisma.accountDeletionRequest.create({
      data: {
        userId: business.ownerId,
        roleAtRequest: "SELLER",
        hadBusiness: true,
        status: "APPROVED",
        scheduledFor: new Date(Date.now() - day),
      },
    });
    return { business, request };
  }

  it("leaves every record and the request in place, then completes on the next run", async () => {
    const { business, request } = await dueBusinessOwner();
    const { storage } = createFakeStorage();
    const removedIdentities: string[] = [];
    const authAdmin = {
      async deleteUser(id: string) {
        removedIdentities.push(id);
      },
    };
    const quiet = console.error;
    console.error = () => {};
    let first;
    try {
      first = await processAccountDeletions(failingTransactions(), {
        storage,
        authAdmin,
        now: new Date(),
      });
    } finally {
      console.error = quiet;
    }

    expect(first).toEqual({ completed: 0, waiting: 0, failed: 1 });
    // Photos and sign-in identity went first, as designed, but not a single record.
    expect(removedIdentities).toEqual([business.ownerId]);
    expect(await prisma.user.count({ where: { id: business.ownerId } })).toBe(1);
    expect(await prisma.business.count({ where: { id: business.businessId } })).toBe(1);
    expect(await prisma.creation.count({ where: { businessId: business.businessId } })).toBe(1);
    const stillDue = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stillDue.status).toBe("APPROVED");
    expect(stillDue.completedAt).toBeNull();

    // The next run repeats the safe steps (the identity is already gone: that counts as done).
    const second = await processAccountDeletions(prisma, {
      storage,
      authAdmin,
      now: new Date(),
    });
    expect(second).toEqual({ completed: 1, waiting: 0, failed: 0 });
    expect(await prisma.user.count({ where: { id: business.ownerId } })).toBe(0);
    expect(await prisma.business.count({ where: { id: business.businessId } })).toBe(0);
    const done = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.userId).toBeNull();
    expect(JSON.stringify(done.summary)).not.toMatch(/Partial Bakery|@/);
  });
});
