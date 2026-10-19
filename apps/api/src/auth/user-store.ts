import type { PrismaClient } from "../generated/prisma/client.js";
import type { VerifiedToken } from "./token-verifier.js";

export type UserRole = "CUSTOMER" | "SELLER" | "ADMIN";

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
  return {
    async findOrCreate(identity) {
      // Roles are never taken from the token: new accounts are always customers.
      return prisma.user.upsert({
        where: { id: identity.userId },
        update: {},
        create: {
          id: identity.userId,
          email: identity.email,
          fullName: identity.fullName ?? null,
        },
        select: { id: true, email: true, fullName: true, role: true },
      });
    },
  };
}
