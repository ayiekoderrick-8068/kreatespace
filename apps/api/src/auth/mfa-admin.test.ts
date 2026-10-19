import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, hasDatabase, resetDatabase, skippedHarness } from "../test/harness.js";
import { resetAdministratorMfa, type MfaAdminClient } from "./mfa-admin.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

function fakeClient(factors: string[]) {
  const deleted: string[] = [];
  const client: MfaAdminClient = {
    listFactors: vi.fn(async () => factors.map((id) => ({ id }))),
    deleteFactor: vi.fn(async (_userId, id) => {
      deleted.push(id);
    }),
  };
  return { client, deleted };
}

describe.skipIf(!hasDatabase)("recovering from a lost authenticator", () => {
  const { prisma, actor } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it("removes an administrator's factors, finding them by email in any letter case, and records it", async () => {
    const admin = await actor("ADMIN", "Lost.Phone@Example.com".toLowerCase());
    const { client, deleted } = fakeClient(["f1", "f2"]);
    const outcome = await resetAdministratorMfa(prisma, client, "  LOST.phone@example.com ");
    expect(outcome).toEqual({ status: "reset", removed: 2 });
    expect(deleted).toEqual(["f1", "f2"]);
    expect(client.listFactors).toHaveBeenCalledWith(admin.id);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "admin.mfa_reset" } });
    expect(audit).toMatchObject({ entityId: admin.id, actorId: null });
    expect(JSON.stringify(audit.metadata)).not.toContain("f1");
  });

  it("will not strip protection from a seller or customer", async () => {
    for (const role of ["SELLER", "CUSTOMER"] as const) {
      const person = await actor(role);
      const { client } = fakeClient(["f1"]);
      expect(await resetAdministratorMfa(prisma, client, person.email)).toEqual({
        status: "not-an-administrator",
      });
      expect(client.deleteFactor).not.toHaveBeenCalled();
    }
  });

  it("says plainly when there is no such account or nothing to reset", async () => {
    const { client } = fakeClient([]);
    expect(await resetAdministratorMfa(prisma, client, "nobody@example.com")).toEqual({
      status: "no-such-user",
    });
    const admin = await actor("ADMIN");
    expect(await resetAdministratorMfa(prisma, client, admin.email)).toEqual({
      status: "nothing-to-reset",
    });
    expect(client.deleteFactor).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { action: "admin.mfa_reset" } })).toBe(0);
  });

  it("does not claim success if the provider fails part-way", async () => {
    const admin = await actor("ADMIN");
    const client: MfaAdminClient = {
      listFactors: async () => [{ id: "f1" }],
      deleteFactor: async () => {
        throw new Error("provider down");
      },
    };
    await expect(resetAdministratorMfa(prisma, client, admin.email)).rejects.toThrow(
      "provider down",
    );
    expect(await prisma.auditLog.count({ where: { action: "admin.mfa_reset" } })).toBe(0);
  });
});
