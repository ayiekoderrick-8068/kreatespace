import type { UserRole } from "@kreatespace/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError } from "../http/errors.js";
import type { VerifiedToken } from "./token-verifier.js";

export type { UserRole };

export interface AppUser {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
}

export interface UserStore {
  /** Returns the application profile for an authenticated user, creating it on first sign-in. */
  findOrCreate(identity: VerifiedToken): Promise<AppUser>;
}

export function createPrismaUserStore(prisma: PrismaClient): UserStore {
  const select = { id: true, email: true, fullName: true, role: true } as const;

  return {
    async findOrCreate(identity) {
      const existing = await prisma.user.findUnique({ where: { id: identity.userId }, select });
      if (existing) return existing;

      // A deleted account's sign-in token stays valid for a while after the identity is removed.
      // Without this check, using it would create a fresh empty account.
      const deleted = await prisma.accountDeletionRequest.findFirst({
        where: { deletedUserId: identity.userId, status: "COMPLETED" },
        select: { id: true },
      });
      if (deleted) throw new HttpError(401, "ACCOUNT_DELETED", "This account has been deleted");

      // A new user's first requests often arrive together (for example the page's profile lookup
      // and a pending action right after login). An atomic insert lets exactly one of them
      // create the row while the rest simply read it. Roles are never taken from the token:
      // new accounts are always customers.
      await prisma.$executeRaw`
        INSERT INTO "users" ("id", "email", "fullName", "role", "updatedAt")
        VALUES (${identity.userId}::uuid, ${identity.email}, ${identity.fullName ?? null},
                'CUSTOMER'::"UserRole", now())
        ON CONFLICT DO NOTHING`;

      const user = await prisma.user.findUnique({ where: { id: identity.userId }, select });
      if (!user) {
        // The insert was skipped by the unique email constraint: another account owns this email.
        throw new HttpError(
          409,
          "ACCOUNT_CONFLICT",
          "This email address belongs to a different account",
        );
      }
      return user;
    },
  };
}
