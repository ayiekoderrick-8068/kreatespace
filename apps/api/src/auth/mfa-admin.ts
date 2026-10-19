import { recordAudit } from "../audit.js";
import type { PrismaClient } from "../generated/prisma/client.js";

/** The slice of Supabase's server-side admin client this needs (easy to fake in tests). */
export interface MfaAdminClient {
  listFactors(userId: string): Promise<{ id: string }[]>;
  deleteFactor(userId: string, factorId: string): Promise<void>;
}

export type ResetOutcome =
  | { status: "reset"; removed: number }
  | { status: "no-such-user" }
  | { status: "not-an-administrator" }
  | { status: "nothing-to-reset" };

/**
 * Removes every second-step factor from an administrator so they can enroll a new authenticator
 * after losing the old one. Used by the owner (with the server-side key), never by the website.
 * The person must still sign in with their password and enroll a new factor before the admin area
 * opens again, so this does not hand out access. It is recorded in the audit log.
 */
export async function resetAdministratorMfa(
  prisma: PrismaClient,
  client: MfaAdminClient,
  email: string,
): Promise<ResetOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, role: true },
  });
  if (!user) return { status: "no-such-user" };
  // Only administrators: this must not become a way to strip protection from anyone's account.
  if (user.role !== "ADMIN") return { status: "not-an-administrator" };

  const factors = await client.listFactors(user.id);
  if (factors.length === 0) return { status: "nothing-to-reset" };
  for (const factor of factors) await client.deleteFactor(user.id, factor.id);

  await recordAudit(prisma, {
    actorId: null,
    action: "admin.mfa_reset",
    entityType: "User",
    entityId: user.id,
    metadata: { factorsRemoved: factors.length, via: "owner script" },
  });
  return { status: "reset", removed: factors.length };
}
