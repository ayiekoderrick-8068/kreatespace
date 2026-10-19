import { createHash, randomBytes } from "node:crypto";
import type { InvitationStatus } from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { AppUser } from "../auth/user-store.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound } from "../http/errors.js";

export const INVITATION_TTL_DAYS = 14;
const DAY_MS = 86_400_000;

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Only the hash of a token is ever stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface StoredInvitation {
  status: InvitationStatus;
  expiresAt: Date;
}

/** PENDING invitations past their expiry are reported as EXPIRED. */
export function effectiveStatus(invitation: StoredInvitation, now: Date): InvitationStatus {
  if (invitation.status === "PENDING" && invitation.expiresAt <= now) return "EXPIRED";
  return invitation.status;
}

export interface InvitationView {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

function toView(
  invitation: InvitationView & { expiresAt: Date; status: InvitationStatus },
  now: Date,
): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    status: effectiveStatus(invitation, now),
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
  };
}

export async function createInvitation(
  prisma: PrismaClient,
  input: { email: string; adminId: string; now?: Date },
): Promise<{ invitation: InvitationView; token: string }> {
  const now = input.now ?? new Date();
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser && existingUser.role !== "CUSTOMER") {
    throw conflict("ALREADY_SELLER", "This person already has a seller or admin account");
  }

  const active = await prisma.invitation.findFirst({
    where: { email, status: "PENDING", expiresAt: { gt: now } },
  });
  if (active) {
    throw conflict(
      "INVITATION_EXISTS",
      "An active invitation already exists for this email. Revoke it before issuing another.",
    );
  }

  const { token, tokenHash } = generateInvitationToken();
  const created = await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.create({
      data: {
        email,
        tokenHash,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
        invitedById: input.adminId,
      },
    });
    await recordAudit(tx, {
      actorId: input.adminId,
      action: "invitation.created",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email },
    });
    return invitation;
  });

  return { invitation: toView(created, now), token };
}

export async function listInvitations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<InvitationView[]> {
  const rows = await prisma.invitation.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((row) => toView(row, now));
}

export async function revokeInvitation(
  prisma: PrismaClient,
  input: { id: string; adminId: string; now?: Date },
): Promise<InvitationView> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    // Conditional update: only a still-pending invitation can be revoked.
    const { count } = await tx.invitation.updateMany({
      where: { id: input.id, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: now },
    });
    const invitation = await tx.invitation.findUnique({ where: { id: input.id } });
    if (!invitation) throw notFound("Invitation not found");
    if (count === 0) {
      throw conflict("INVITATION_NOT_PENDING", "Only pending invitations can be revoked");
    }
    await recordAudit(tx, {
      actorId: input.adminId,
      action: "invitation.revoked",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email: invitation.email },
    });
    return toView(invitation, now);
  });
}

export type InvitationLookup = { valid: true; email: string } | { valid: false };

/** Lets the invite page check a link. Reveals the invited email only for usable invitations. */
export async function lookupInvitation(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<InvitationLookup> {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitation || effectiveStatus(invitation, now) !== "PENDING") return { valid: false };
  return { valid: true, email: invitation.email };
}

export async function acceptInvitation(
  prisma: PrismaClient,
  input: { token: string; user: AppUser; now?: Date },
): Promise<{ role: "SELLER" | "ADMIN" }> {
  const now = input.now ?? new Date();
  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!invitation) {
      throw new HttpError(400, "INVALID_INVITATION", "This invitation link is not valid");
    }

    if (invitation.email !== input.user.email.toLowerCase()) {
      throw new HttpError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "This invitation was issued to a different email address",
      );
    }

    // Single-use: the status check and the update are one atomic statement.
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedById: input.user.id },
    });
    if (count === 0) {
      const status = effectiveStatus(invitation, now);
      if (status === "ACCEPTED") {
        throw new HttpError(409, "INVITATION_USED", "This invitation has already been used");
      }
      if (status === "REVOKED") {
        throw new HttpError(410, "INVITATION_REVOKED", "This invitation was revoked");
      }
      throw new HttpError(410, "INVITATION_EXPIRED", "This invitation has expired");
    }

    // Admins keep their role; customers become sellers.
    const role = input.user.role === "ADMIN" ? "ADMIN" : "SELLER";
    if (role === "SELLER") {
      await tx.user.update({ where: { id: input.user.id }, data: { role: "SELLER" } });
    }
    await recordAudit(tx, {
      actorId: input.user.id,
      action: "invitation.accepted",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email: invitation.email },
    });
    return { role };
  });
}
