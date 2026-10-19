import type { CreationStatus, ReviewDecisionInput, RevisionStatus } from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { revisionInclude } from "./service.js";
import { toSellerRevision, type RevisionRecord, type SellerRevisionView } from "./views.js";
import { planCreationDecision } from "./workflow.js";

const PAGE_SIZE = 20;

export interface AdminCreationListItem {
  id: string;
  status: CreationStatus;
  title: string;
  categoryName: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  /** True when a submission (first version or an edit) awaits review. */
  hasPendingSubmission: boolean;
  pendingSubmittedAt: Date | null;
  updatedAt: Date;
}

export async function listCreationsForReview(
  prisma: PrismaClient,
  query: {
    status?: CreationStatus;
    businessId?: string;
    category?: string;
    q?: string;
    page: number;
  },
): Promise<{ items: AdminCreationListItem[]; total: number; page: number; pageSize: number }> {
  const and: Prisma.CreationWhereInput[] = [];
  if (query.status) {
    // A pending edit of a live creation also belongs in the pending queue.
    and.push(
      query.status === "PENDING"
        ? { OR: [{ status: "PENDING" }, { revisions: { some: { status: "PENDING" } } }] }
        : { status: query.status },
    );
  }
  if (query.businessId) and.push({ businessId: query.businessId });
  if (query.category) {
    and.push({ revisions: { some: { category: { slug: query.category } } } });
  }
  if (query.q) {
    and.push({
      OR: [
        { business: { slug: { contains: query.q, mode: "insensitive" } } },
        {
          business: {
            revisions: { some: { businessName: { contains: query.q, mode: "insensitive" } } },
          },
        },
        {
          revisions: {
            some: {
              OR: [
                { title: { contains: query.q, mode: "insensitive" } },
                { description: { contains: query.q, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }
  const where: Prisma.CreationWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.creation.count({ where }),
    prisma.creation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        business: {
          select: {
            id: true,
            slug: true,
            revisions: { orderBy: { version: "desc" }, take: 1, select: { businessName: true } },
          },
        },
        revisions: {
          orderBy: { version: "desc" },
          select: {
            status: true,
            title: true,
            submittedAt: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const items = rows.map<AdminCreationListItem>((row) => {
    const latest = row.revisions[0]!;
    const pending = row.revisions.find((r) => r.status === "PENDING");
    return {
      id: row.id,
      status: row.status,
      title: (pending ?? latest).title,
      categoryName: (pending ?? latest).category.name,
      businessId: row.business.id,
      businessName: row.business.revisions[0]?.businessName ?? row.business.slug,
      businessSlug: row.business.slug,
      hasPendingSubmission: Boolean(pending),
      pendingSubmittedAt: pending?.submittedAt ?? null,
      updatedAt: row.updatedAt,
    };
  });
  return { items, total, page: query.page, pageSize: PAGE_SIZE };
}

export interface AdminCreationDetail {
  creation: { id: string; status: CreationStatus; createdAt: Date; publishedAt: Date | null };
  business: { id: string; slug: string; name: string; status: string };
  reviewRevision: SellerRevisionView;
  publishedRevision: SellerRevisionView | null;
  revisions: { id: string; version: number; status: RevisionStatus; submittedAt: Date | null }[];
  decisions: {
    id: string;
    action: string;
    reason: string | null;
    createdAt: Date;
    revisionId: string | null;
    admin: { id: string; email: string; fullName: string | null };
  }[];
}

export async function getCreationForReview(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  creationId: string,
): Promise<AdminCreationDetail> {
  const creation = await prisma.creation.findUnique({
    where: { id: creationId },
    include: {
      business: {
        select: {
          id: true,
          slug: true,
          status: true,
          revisions: { orderBy: { version: "desc" }, take: 1, select: { businessName: true } },
        },
      },
      revisions: { include: revisionInclude, orderBy: { version: "desc" } },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, email: true, fullName: true } } },
      },
    },
  });
  if (!creation) throw notFound("Creation not found");

  const pending = creation.revisions.find((r) => r.status === "PENDING");
  const review = pending ?? creation.revisions[0]!;
  const published = creation.revisions.find((r) => r.id === creation.publishedRevisionId);

  return {
    creation: {
      id: creation.id,
      status: creation.status,
      createdAt: creation.createdAt,
      publishedAt: creation.publishedAt,
    },
    business: {
      id: creation.business.id,
      slug: creation.business.slug,
      name: creation.business.revisions[0]?.businessName ?? creation.business.slug,
      status: creation.business.status,
    },
    reviewRevision: await toSellerRevision(review as RevisionRecord, storage),
    publishedRevision:
      published && published.id !== review.id
        ? await toSellerRevision(published as RevisionRecord, storage)
        : null,
    revisions: creation.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      submittedAt: r.submittedAt,
    })),
    decisions: creation.decisions.map((d) => ({
      id: d.id,
      action: d.action,
      reason: d.reason,
      createdAt: d.createdAt,
      revisionId: d.revisionId,
      admin: d.admin,
    })),
  };
}

/** Applies an admin decision. Every transition is validated by `planCreationDecision`. */
export async function decideOnCreation(
  prisma: PrismaClient,
  input: { creationId: string; adminId: string; decision: ReviewDecisionInput },
): Promise<void> {
  const { creationId, adminId, decision } = input;

  await prisma.$transaction(async (tx) => {
    const creation = await tx.creation.findUnique({
      where: { id: creationId },
      include: { revisions: { where: { status: "PENDING" } } },
    });
    if (!creation) throw notFound("Creation not found");

    const pending = creation.revisions[0] ?? null;
    if (decision.revisionId && pending && decision.revisionId !== pending.id) {
      throw conflict("STALE_REVIEW", "This submission has changed since you opened it. Reload it.");
    }

    const result = planCreationDecision({
      command: decision.action,
      creation: creation.status,
      hasPublishedRevision: creation.publishedRevisionId !== null,
      revision: pending?.status ?? null,
    });
    if (!result.ok) throw new HttpError(409, result.code, result.message);
    const { plan } = result;

    // Both updates are conditional on the state the plan was made for, so two admins acting
    // at once cannot both succeed.
    if (plan.revisionStatus && pending) {
      const { count } = await tx.creationRevision.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: { status: plan.revisionStatus },
      });
      if (count === 0) throw conflict("NOTHING_TO_REVIEW", "This submission was already reviewed");
    }
    if (plan.creationStatus || plan.publish) {
      const { count } = await tx.creation.updateMany({
        where: { id: creation.id, status: creation.status },
        data: {
          ...(plan.creationStatus ? { status: plan.creationStatus } : {}),
          ...(plan.publish && pending
            ? {
                publishedRevisionId: pending.id,
                // The first publication date stays; later edits don't push it back to "new".
                publishedAt: creation.publishedAt ?? new Date(),
              }
            : {}),
        },
      });
      if (count === 0)
        throw conflict("CONCURRENT_CHANGE", "The creation was changed by someone else");
    }

    await tx.creationReviewDecision.create({
      data: {
        creationId: creation.id,
        revisionId: plan.revisionStatus ? (pending?.id ?? null) : null,
        adminId,
        action: plan.action,
        reason: decision.reason || null,
      },
    });
    await recordAudit(tx, {
      actorId: adminId,
      action: `creation.${plan.action.toLowerCase()}`,
      entityType: "Creation",
      entityId: creation.id,
      metadata: {
        revisionId: pending?.id ?? null,
        from: creation.status,
        to: plan.creationStatus ?? creation.status,
        reason: decision.reason || null,
      },
    });
  });
}
