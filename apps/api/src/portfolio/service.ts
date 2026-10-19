import {
  MAX_ACTIVE_CREATIONS,
  type CreationDetails,
  type CreationDraftInput,
  type CreationStatus,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, forbidden, notFound } from "../http/errors.js";
import { resolveImages } from "../storage/image-urls.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  toSellerRevision,
  type CreationDecisionView,
  type RevisionRecord,
  type SellerRevisionView,
  type UsageView,
} from "./views.js";
import { OPEN_REVISION_STATUSES, canArchive, canOwnerEdit, canStartRevision } from "./workflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const revisionInclude = {
  category: { select: { id: true, slug: true, name: true } },
  occasion: { select: { id: true, slug: true, name: true } },
  images: {
    orderBy: { position: "asc" },
    select: { id: true, path: true, position: true, width: true, height: true },
  },
} satisfies Prisma.CreationRevisionInclude;

/** The signed-in seller's business, which must be approved to manage creations. */
export async function requireApprovedBusiness(db: Db, userId: string) {
  const business = await db.business.findUnique({
    where: { ownerId: userId },
    select: { id: true, status: true, slug: true },
  });
  if (!business) throw notFound("You have not registered a business yet");
  if (business.status !== "APPROVED") {
    throw forbidden("Your business must be approved before you can manage creations");
  }
  return business;
}

/**
 * Loads a creation only if it belongs to the signed-in seller's business. Other people's
 * creations are reported as "not found" so their existence is never revealed.
 */
export async function loadOwnedCreation(db: Db, userId: string, creationId: string) {
  const creation = await db.creation.findFirst({
    where: { id: creationId, business: { ownerId: userId } },
    include: {
      business: { select: { id: true, status: true } },
      revisions: { include: revisionInclude, orderBy: { version: "desc" } },
    },
  });
  if (!creation) throw notFound("Creation not found");
  const open = creation.revisions.find((r) => OPEN_REVISION_STATUSES.includes(r.status));
  return { creation, open, working: open ?? creation.revisions[0]! };
}

/** How much of the free allowance a business is using. Archived creations are free. */
export async function getUsage(db: Db, businessId: string): Promise<UsageView> {
  const groups = await db.creation.groupBy({
    by: ["status"],
    where: { businessId },
    _count: { _all: true },
  });
  const byStatus: Partial<Record<CreationStatus, number>> = {};
  let used = 0;
  for (const group of groups) {
    byStatus[group.status] = group._count._all;
    if (group.status !== "ARCHIVED") used += group._count._all;
  }
  return {
    used,
    limit: MAX_ACTIVE_CREATIONS,
    remaining: Math.max(0, MAX_ACTIVE_CREATIONS - used),
    byStatus,
  };
}

async function requireActiveCategory(db: Db, categoryId: string, occasionId?: string | null) {
  const fields: Record<string, string> = {};
  if (!(await db.category.findFirst({ where: { id: categoryId, active: true } }))) {
    fields.categoryId = "Choose a valid category";
  }
  if (occasionId && !(await db.occasion.findFirst({ where: { id: occasionId, active: true } }))) {
    fields.occasionId = "Choose a valid occasion";
  }
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields });
  }
}

export async function createCreation(
  prisma: PrismaClient,
  input: { userId: string; details: CreationDetails },
): Promise<{ creationId: string }> {
  const { userId, details } = input;
  const business = await requireApprovedBusiness(prisma, userId);
  await requireActiveCategory(prisma, details.categoryId, details.occasionId);

  try {
    return await prisma.$transaction(async (tx) => {
      // One request at a time per business, so the count below cannot go stale.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"creations:" + business.id}))::text`;
      const { used } = await getUsage(tx, business.id);
      if (used >= MAX_ACTIVE_CREATIONS) throw limitReached();

      const creation = await tx.creation.create({
        data: {
          businessId: business.id,
          revisions: {
            create: {
              version: 1,
              title: details.title,
              description: details.description,
              categoryId: details.categoryId,
              occasionId: details.occasionId ?? null,
            },
          },
        },
      });
      await recordAudit(tx, {
        actorId: userId,
        action: "creation.created",
        entityType: "Creation",
        entityId: creation.id,
      });
      return { creationId: creation.id };
    });
  } catch (error) {
    // The database trigger is the last line of defence if anything got past the check above.
    if (String((error as Error)?.message).includes("creation_limit_reached")) throw limitReached();
    throw error;
  }
}

function limitReached() {
  return conflict(
    "CREATION_LIMIT_REACHED",
    `You have used all ${MAX_ACTIVE_CREATIONS} free creations. Archive one to add another.`,
  );
}

export interface CreationSummary {
  id: string;
  status: CreationStatus;
  /** What the owner is working on (the open revision, or the latest). */
  title: string;
  category: { slug: string; name: string };
  revisionStatus: string;
  hasPublishedVersion: boolean;
  imageCount: number;
  cover: { url: string | null; width: number; height: number } | null;
  updatedAt: Date;
  latestFeedback: { action: string; reason: string | null } | null;
}

export async function listOwnCreations(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  userId: string,
): Promise<{ creations: CreationSummary[]; usage: UsageView }> {
  const business = await requireApprovedBusiness(prisma, userId);
  const rows = await prisma.creation.findMany({
    where: { businessId: business.id },
    orderBy: { updatedAt: "desc" },
    include: {
      revisions: { include: revisionInclude, orderBy: { version: "desc" } },
      decisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const covers = rows.flatMap((row) => {
    const working = pickWorking(row.revisions);
    return working?.images[0] ? [working.images[0]] : [];
  });
  const resolved = await resolveImages(storage, covers);

  const creations = rows.map<CreationSummary>((row) => {
    const working = pickWorking(row.revisions)!;
    const cover = working.images[0];
    return {
      id: row.id,
      status: row.status,
      title: working.title,
      category: { slug: working.category.slug, name: working.category.name },
      revisionStatus: working.status,
      hasPublishedVersion: row.publishedRevisionId !== null,
      imageCount: working.images.length,
      cover: cover
        ? { url: resolved.get(cover.path)?.url ?? null, width: cover.width, height: cover.height }
        : null,
      updatedAt: row.updatedAt,
      latestFeedback: row.decisions[0]
        ? { action: row.decisions[0].action, reason: row.decisions[0].reason }
        : null,
    };
  });
  return { creations, usage: await getUsage(prisma, business.id) };
}

function pickWorking<T extends { status: string }>(revisions: T[]): T | undefined {
  return revisions.find((r) => OPEN_REVISION_STATUSES.includes(r.status as never)) ?? revisions[0];
}

export interface OwnCreationView {
  creation: {
    id: string;
    status: CreationStatus;
    createdAt: Date;
    updatedAt: Date;
    editable: boolean;
    canStartRevision: boolean;
  };
  revision: SellerRevisionView;
  /** What visitors currently see, when it differs from `revision`. */
  publishedRevision: SellerRevisionView | null;
  decisions: CreationDecisionView[];
}

export async function getOwnCreation(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { userId: string; creationId: string },
): Promise<OwnCreationView> {
  const { creation, open, working } = await loadOwnedCreation(
    prisma,
    input.userId,
    input.creationId,
  );
  const published = creation.publishedRevisionId
    ? creation.revisions.find((r) => r.id === creation.publishedRevisionId)
    : undefined;
  const decisions = await prisma.creationReviewDecision.findMany({
    where: { creationId: creation.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, action: true, reason: true, createdAt: true, revisionId: true },
  });

  return {
    creation: {
      id: creation.id,
      status: creation.status,
      createdAt: creation.createdAt,
      updatedAt: creation.updatedAt,
      editable: canOwnerEdit(creation.status, working.status) && Boolean(open),
      canStartRevision: canStartRevision(creation.status, Boolean(open)),
    },
    revision: await toSellerRevision(working as RevisionRecord, storage),
    publishedRevision:
      published && published.id !== working.id
        ? await toSellerRevision(published as RevisionRecord, storage)
        : null,
    decisions,
  };
}

export async function updateCreationDraft(
  prisma: PrismaClient,
  input: { userId: string; creationId: string; changes: CreationDraftInput },
): Promise<void> {
  const { userId, creationId, changes } = input;
  await requireApprovedBusiness(prisma, userId);

  await prisma.$transaction(async (tx) => {
    const { creation, open } = await loadOwnedCreation(tx, userId, creationId);
    if (!open || !canOwnerEdit(creation.status, open.status)) {
      throw conflict(
        "REVISION_LOCKED",
        "This creation can’t be edited right now. It may be awaiting review.",
      );
    }
    if (changes.categoryId || changes.occasionId) {
      await requireActiveCategory(
        tx,
        changes.categoryId ?? open.categoryId,
        changes.occasionId ?? undefined,
      );
    }

    const data: Prisma.CreationRevisionUpdateInput = {};
    if (changes.title !== undefined) data.title = changes.title;
    if (changes.description !== undefined) data.description = changes.description;
    if (changes.categoryId !== undefined) data.category = { connect: { id: changes.categoryId } };
    if (changes.occasionId !== undefined) {
      data.occasion = changes.occasionId
        ? { connect: { id: changes.occasionId } }
        : { disconnect: true };
    }
    await tx.creationRevision.update({ where: { id: open.id }, data });
    await tx.creation.update({ where: { id: creation.id }, data: { updatedAt: new Date() } });
  });
}

/** Archiving hides the creation from the public and frees one of the business's slots. */
export async function archiveCreation(
  prisma: PrismaClient,
  input: { userId: string; creationId: string },
): Promise<void> {
  const { userId, creationId } = input;
  await requireApprovedBusiness(prisma, userId);

  await prisma.$transaction(async (tx) => {
    const { creation } = await loadOwnedCreation(tx, userId, creationId);
    if (!canArchive(creation.status)) {
      throw conflict("ALREADY_ARCHIVED", "This creation is already archived");
    }
    const { count } = await tx.creation.updateMany({
      where: { id: creation.id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    if (count === 0) throw conflict("ALREADY_ARCHIVED", "This creation is already archived");
    await recordAudit(tx, {
      actorId: userId,
      action: "creation.archived",
      entityType: "Creation",
      entityId: creation.id,
      metadata: { from: creation.status },
    });
  });
}
