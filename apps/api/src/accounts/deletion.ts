import {
  DELETION_GRACE_DAYS,
  RECENT_SIGN_IN_MINUTES,
  type DeletionStatus,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { AuthAdmin } from "../auth/supabase-admin.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound } from "../http/errors.js";
import { describeError } from "../http/log.js";
import type { MediaStorage } from "../storage/media-storage.js";

const DAY_MS = 86_400_000;
/** How long a deleted account's opaque id is remembered, longer than any sign-in token lives. */
export const TOMBSTONE_DAYS = 8;

const ACTIVE: DeletionStatus[] = ["REQUESTED", "APPROVED"];

/** What deleting this account would remove, in numbers, so people and reviewers can see the cost. */
export interface DeletionEffects {
  role: "CUSTOMER" | "SELLER" | "ADMIN";
  savedCreations: number;
  business: {
    name: string | null;
    status: string;
    creations: number;
    packages: number;
    openWebsiteRequests: number;
    importInProgress: boolean;
  } | null;
}

export async function describeEffects(
  prisma: PrismaClient,
  userId: string,
): Promise<DeletionEffects> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      business: {
        select: {
          id: true,
          status: true,
          publishedRevision: { select: { businessName: true } },
          revisions: { orderBy: { version: "desc" }, take: 1, select: { businessName: true } },
        },
      },
    },
  });
  if (!user) throw notFound("Account not found");
  const saved = await prisma.savedCreation.count({ where: { userId } });
  const business = user.business;
  if (!business) return { role: user.role, savedCreations: saved, business: null };

  const [creations, packages, openWebsiteRequests, importInProgress] = await Promise.all([
    prisma.creation.count({ where: { businessId: business.id } }),
    prisma.servicePackage.count({ where: { businessId: business.id } }),
    prisma.websiteRequest.count({
      where: {
        businessId: business.id,
        status: { in: ["NEW", "IN_REVIEW", "QUOTED", "ACCEPTED"] },
      },
    }),
    prisma.importJob.count({
      where: { businessId: business.id, status: { in: ["QUEUED", "RUNNING"] } },
    }),
  ]);
  return {
    role: user.role,
    savedCreations: saved,
    business: {
      name: business.publishedRevision?.businessName ?? business.revisions[0]?.businessName ?? null,
      status: business.status,
      creations,
      packages,
      openWebsiteRequests,
      importInProgress: importInProgress > 0,
    },
  };
}

export interface DeletionView {
  id: string;
  status: DeletionStatus;
  requestedAt: Date;
  /** Earliest day it can be carried out. */
  scheduledFor: Date;
  /** True for business owners: an administrator must agree first. */
  needsReview: boolean;
  reviewNote: string | null;
  completedAt: Date | null;
}

const toView = (row: {
  id: string;
  status: DeletionStatus;
  requestedAt: Date;
  scheduledFor: Date;
  hadBusiness: boolean;
  reviewNote: string | null;
  completedAt: Date | null;
}): DeletionView => ({
  id: row.id,
  status: row.status,
  requestedAt: row.requestedAt,
  scheduledFor: row.scheduledFor,
  needsReview: row.hadBusiness,
  reviewNote: row.reviewNote,
  completedAt: row.completedAt,
});

/** The person's current request, or their most recent one, plus what deleting would remove. */
export async function getDeletionStatus(prisma: PrismaClient, userId: string) {
  const [request, effects] = await Promise.all([
    prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: "desc" },
    }),
    describeEffects(prisma, userId),
  ]);
  return {
    request: request ? toView(request) : null,
    effects,
    graceDays: DELETION_GRACE_DAYS,
  };
}

/**
 * Starts a deletion request. The caller has already shown a recent sign-in. Nothing is deleted now:
 * everyone gets a delay in which to change their mind, and business owners also need an
 * administrator's agreement, because their business disappears from the site.
 */
export async function requestDeletion(
  prisma: PrismaClient,
  input: { userId: string; authenticatedAt: Date | undefined; now?: Date },
): Promise<DeletionView> {
  const now = input.now ?? new Date();
  const recent = input.authenticatedAt
    ? now.getTime() - input.authenticatedAt.getTime() <= RECENT_SIGN_IN_MINUTES * 60_000
    : false;
  if (!recent) {
    throw new HttpError(
      403,
      "REAUTHENTICATION_REQUIRED",
      "For your security, please confirm your password again, then retry.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { role: true, business: { select: { id: true } } },
  });
  if (!user) throw notFound("Account not found");
  if (user.role === "ADMIN") {
    throw new HttpError(
      403,
      "ADMIN_DELETION_NOT_SUPPORTED",
      "Administrator accounts are removed by the owner of KreateSpace, not from here.",
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const open = await tx.accountDeletionRequest.findFirst({
        where: { userId: input.userId, status: { in: ACTIVE } },
        select: { id: true },
      });
      if (open) {
        throw conflict(
          "DELETION_ALREADY_REQUESTED",
          "You have already asked to delete this account.",
        );
      }
      const row = await tx.accountDeletionRequest.create({
        data: {
          userId: input.userId,
          roleAtRequest: user.role,
          hadBusiness: user.business !== null,
          scheduledFor: new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS),
        },
      });
      await recordAudit(tx, {
        actorId: input.userId,
        action: "account.deletion_requested",
        entityType: "AccountDeletionRequest",
        entityId: row.id,
        metadata: { role: user.role, hadBusiness: user.business !== null },
      });
      return toView(row);
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      throw conflict(
        "DELETION_ALREADY_REQUESTED",
        "You have already asked to delete this account.",
      );
    }
    throw error;
  }
}

/** Withdraws a request that has not been carried out. */
export async function cancelDeletion(
  prisma: PrismaClient,
  input: { userId: string; now?: Date },
): Promise<DeletionView> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.accountDeletionRequest.findFirst({
      where: { userId: input.userId, status: { in: ACTIVE } },
    });
    if (!row) throw notFound("There is no deletion request to cancel");
    const updated = await tx.accountDeletionRequest.update({
      where: { id: row.id },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    await recordAudit(tx, {
      actorId: input.userId,
      action: "account.deletion_cancelled",
      entityType: "AccountDeletionRequest",
      entityId: row.id,
    });
    return toView(updated);
  });
}

// --- administrators -----------------------------------------------------------------------------

const PAGE_SIZE = 20;

export async function listDeletionsForAdmin(
  prisma: PrismaClient,
  query: { status?: DeletionStatus; page: number },
) {
  const where: Prisma.AccountDeletionRequestWhereInput = query.status
    ? { status: query.status }
    : { status: { in: ACTIVE } };
  const [rows, total] = await Promise.all([
    prisma.accountDeletionRequest.findMany({
      where,
      orderBy: [{ requestedAt: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.accountDeletionRequest.count({ where }),
  ]);

  const items = await Promise.all(
    rows.map(async (row) => ({
      ...toView(row),
      roleAtRequest: row.roleAtRequest,
      // Live numbers while the account still exists; a finished request keeps only its summary.
      effects: row.userId ? await describeEffects(prisma, row.userId).catch(() => null) : null,
      summary: row.summary,
      requester: row.userId
        ? ((
            await prisma.user.findUnique({
              where: { id: row.userId },
              select: { email: true, fullName: true },
            })
          )?.email ?? null)
        : null,
    })),
  );
  return { items, total, page: query.page, pageSize: PAGE_SIZE };
}

export async function decideOnDeletion(
  prisma: PrismaClient,
  input: {
    requestId: string;
    adminId: string;
    action: "APPROVE" | "REJECT";
    note?: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.accountDeletionRequest.findUnique({ where: { id: input.requestId } });
    if (!row) throw notFound("Request not found");
    if (row.status !== "REQUESTED") {
      throw conflict("DELETION_ALREADY_DECIDED", "This request is not waiting for a decision.");
    }
    if (!row.hadBusiness) {
      throw conflict(
        "DELETION_NEEDS_NO_REVIEW",
        "Customer requests go ahead after the waiting period without a decision.",
      );
    }
    const approve = input.action === "APPROVE";
    await tx.accountDeletionRequest.update({
      where: { id: row.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        reviewedById: input.adminId,
        reviewedAt: now,
        reviewNote: approve ? null : (input.note ?? null),
      },
    });
    await recordAudit(tx, {
      actorId: input.adminId,
      action: approve ? "account.deletion_approved" : "account.deletion_rejected",
      entityType: "AccountDeletionRequest",
      entityId: row.id,
    });
  });
}

// --- carrying it out ----------------------------------------------------------------------------

export interface DeletionDeps {
  /** Needed whenever a business has files to remove; without it those requests wait. */
  storage?: MediaStorage;
  authAdmin: AuthAdmin;
  now?: Date;
}

export interface ProcessResult {
  completed: number;
  /** Not ready yet (something is in progress, or it needs a decision). Tried again next time. */
  waiting: number;
  failed: number;
}

/**
 * Carries out every request that is due. Safe to run repeatedly and to interrupt: files go first,
 * then the sign-in identity (so the person can no longer log in and nothing can recreate the
 * account), then all database records in one transaction. If a step fails the request stays due
 * and the whole thing is retried, each step being safe to repeat.
 */
export async function processAccountDeletions(
  prisma: PrismaClient,
  deps: DeletionDeps,
): Promise<ProcessResult> {
  const now = deps.now ?? new Date();
  const result: ProcessResult = { completed: 0, waiting: 0, failed: 0 };

  const due = await prisma.accountDeletionRequest.findMany({
    where: {
      scheduledFor: { lte: now },
      OR: [{ status: "APPROVED" }, { status: "REQUESTED", hadBusiness: false }],
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  for (const request of due) {
    try {
      const outcome = await carryOut(prisma, deps, request, now);
      result[outcome]++;
    } catch (error) {
      result.failed++;
      console.error("Account deletion failed", request.id, describeError(error));
    }
  }
  return result;
}

async function carryOut(
  prisma: PrismaClient,
  deps: DeletionDeps,
  request: { id: string; userId: string | null; status: DeletionStatus; hadBusiness: boolean },
  now: Date,
): Promise<"completed" | "waiting"> {
  const user = request.userId
    ? await prisma.user.findUnique({
        where: { id: request.userId },
        select: {
          id: true,
          email: true,
          role: true,
          business: { select: { id: true } },
        },
      })
    : null;

  if (!user) {
    // The account is already gone; just close the request.
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: now, summary: { alreadyGone: true } },
    });
    return "completed";
  }

  if (user.role === "ADMIN") {
    // Promoted since asking. An administrator is never removed by the automatic job.
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        reviewedAt: now,
        reviewNote: "Administrator accounts are removed by the owner of KreateSpace.",
      },
    });
    return "waiting";
  }

  const business = user.business;
  if (business && request.status === "REQUESTED") {
    // Became a business owner after asking: an administrator must look at it first.
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { hadBusiness: true },
    });
    return "waiting";
  }
  if (business) {
    const running = await prisma.importJob.count({
      where: { businessId: business.id, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (running > 0) return "waiting"; // let the import finish, then delete
  }

  // Everything that will be removed, counted first so the record can say what happened.
  const effects = await describeEffects(prisma, user.id);
  const creationIds = business
    ? (
        await prisma.creation.findMany({ where: { businessId: business.id }, select: { id: true } })
      ).map((c) => c.id)
    : [];
  const packageIds = business
    ? (
        await prisma.servicePackage.findMany({
          where: { businessId: business.id },
          select: { id: true },
        })
      ).map((p) => p.id)
    : [];
  const requestIds = business
    ? (
        await prisma.websiteRequest.findMany({
          where: { businessId: business.id },
          select: { id: true },
        })
      ).map((r) => r.id)
    : [];
  const importIds = business
    ? [
        ...(await prisma.importAuthorization.findMany({
          where: { businessId: business.id },
          select: { id: true },
        })),
        ...(await prisma.importJob.findMany({
          where: { businessId: business.id },
          select: { id: true },
        })),
        ...(await prisma.importItem.findMany({
          where: { businessId: business.id },
          select: { id: true },
        })),
      ].map((r) => r.id)
    : [];
  const invitations = await prisma.invitation.findMany({
    where: { OR: [{ email: user.email }, { acceptedById: user.id }] },
    select: { id: true },
  });

  // 1. Files. Without storage a business cannot be cleaned up, so it waits rather than lying.
  let filesRemoved = 0;
  if (business) {
    if (!deps.storage) throw new Error("Storage is required to remove a business's photos");
    filesRemoved = await deps.storage.removeFolder(`businesses/${business.id}`);
  }
  // 2. The sign-in identity, so the person can no longer log in.
  await deps.authAdmin.deleteUser(user.id);
  // 3. The records, all or nothing.
  await prisma.$transaction(async (tx) => {
    const subjectIds = [
      user.id,
      ...(business ? [business.id] : []),
      ...creationIds,
      ...packageIds,
      ...requestIds,
      ...importIds,
      ...invitations.map((i) => i.id),
    ];
    // Keep that these things happened, but not the details (invitations recorded an email address).
    await tx.auditLog.updateMany({
      where: { entityId: { in: subjectIds } },
      data: { metadata: Prisma.DbNull },
    });
    await tx.invitation.deleteMany({ where: { id: { in: invitations.map((i) => i.id) } } });
    if (business) await tx.business.delete({ where: { id: business.id } });
    await tx.user.delete({ where: { id: user.id } });
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        deletedUserId: user.id,
        summary: {
          savedCreations: effects.savedCreations,
          hadBusiness: business !== null,
          creations: effects.business?.creations ?? 0,
          packages: effects.business?.packages ?? 0,
          websiteRequests: requestIds.length,
          filesRemoved,
        },
      },
    });
    await recordAudit(tx, {
      actorId: null,
      action: "account.deleted",
      entityType: "AccountDeletionRequest",
      entityId: request.id,
    });
  });
  return "completed";
}

/** Forgets the short-lived ids kept to stop deleted accounts being recreated. Safe to repeat. */
export async function purgeDeletionTombstones(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const { count } = await prisma.accountDeletionRequest.updateMany({
    where: {
      deletedUserId: { not: null },
      completedAt: { lt: new Date(now.getTime() - TOMBSTONE_DAYS * DAY_MS) },
    },
    data: { deletedUserId: null },
  });
  return count;
}
