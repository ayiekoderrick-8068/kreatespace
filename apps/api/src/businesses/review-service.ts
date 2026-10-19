import type { BusinessStatus, ReviewDecisionInput, RevisionStatus } from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { revisionInclude } from "./service.js";
import { toRevisionView, type RevisionRecord, type RevisionView } from "./views.js";
import { planDecision } from "./workflow.js";

const PAGE_SIZE = 20;

export interface AdminBusinessListItem {
  id: string;
  slug: string;
  status: BusinessStatus;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  categoryName: string;
  county: string;
  city: string;
  /** True when a submission (first application or profile update) awaits review. */
  hasPendingSubmission: boolean;
  pendingSubmittedAt: Date | null;
  updatedAt: Date;
}

export async function listBusinessesForReview(
  prisma: PrismaClient,
  query: { status?: BusinessStatus; q?: string; page: number },
): Promise<{ items: AdminBusinessListItem[]; total: number; page: number; pageSize: number }> {
  const and: Prisma.BusinessWhereInput[] = [];
  if (query.status) {
    // A pending profile update on an approved business should also appear in the pending queue.
    and.push(
      query.status === "PENDING"
        ? { OR: [{ status: "PENDING" }, { revisions: { some: { status: "PENDING" } } }] }
        : { status: query.status },
    );
  }
  if (query.q) {
    and.push({
      OR: [
        { slug: { contains: query.q, mode: "insensitive" } },
        { owner: { email: { contains: query.q, mode: "insensitive" } } },
        { owner: { fullName: { contains: query.q, mode: "insensitive" } } },
        {
          revisions: {
            some: {
              OR: [
                { businessName: { contains: query.q, mode: "insensitive" } },
                { ownerName: { contains: query.q, mode: "insensitive" } },
                { city: { contains: query.q, mode: "insensitive" } },
                { county: { contains: query.q, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }
  const where: Prisma.BusinessWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        owner: { select: { email: true } },
        revisions: {
          orderBy: { version: "desc" },
          select: {
            status: true,
            businessName: true,
            ownerName: true,
            county: true,
            city: true,
            submittedAt: true,
            category: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const items = rows.map((row) => {
    const latest = row.revisions[0]!;
    const pending = row.revisions.find((r) => r.status === "PENDING");
    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      businessName: latest.businessName,
      ownerName: latest.ownerName,
      ownerEmail: row.owner.email,
      categoryName: latest.category.name,
      county: latest.county,
      city: latest.city,
      hasPendingSubmission: Boolean(pending),
      pendingSubmittedAt: pending?.submittedAt ?? null,
      updatedAt: row.updatedAt,
    };
  });

  return { items, total, page: query.page, pageSize: PAGE_SIZE };
}

export interface AdminBusinessDetail {
  business: {
    id: string;
    slug: string;
    status: BusinessStatus;
    createdAt: Date;
    owner: { id: string; email: string; fullName: string | null };
  };
  /** The submission awaiting review, or the most recent revision when none is pending. */
  reviewRevision: RevisionView;
  publishedRevision: RevisionView | null;
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

export async function getBusinessForReview(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  businessId: string,
): Promise<AdminBusinessDetail> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      owner: { select: { id: true, email: true, fullName: true } },
      revisions: { include: revisionInclude, orderBy: { version: "desc" } },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, email: true, fullName: true } } },
      },
    },
  });
  if (!business) throw notFound("Business not found");

  const pending = business.revisions.find((r) => r.status === "PENDING");
  const reviewRevision = pending ?? business.revisions[0]!;
  const published = business.revisions.find((r) => r.id === business.publishedRevisionId);

  return {
    business: {
      id: business.id,
      slug: business.slug,
      status: business.status,
      createdAt: business.createdAt,
      owner: business.owner,
    },
    reviewRevision: await toRevisionView(reviewRevision as RevisionRecord, storage),
    publishedRevision:
      published && published.id !== reviewRevision.id
        ? await toRevisionView(published as RevisionRecord, storage)
        : null,
    revisions: business.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      submittedAt: r.submittedAt,
    })),
    decisions: business.decisions.map((d) => ({
      id: d.id,
      action: d.action,
      reason: d.reason,
      createdAt: d.createdAt,
      revisionId: d.revisionId,
      admin: d.admin,
    })),
  };
}

/** Applies an admin decision. Every transition is validated by `planDecision`. */
export async function decideOnBusiness(
  prisma: PrismaClient,
  input: { businessId: string; adminId: string; decision: ReviewDecisionInput },
): Promise<void> {
  const { businessId, adminId, decision } = input;

  await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      include: { revisions: { where: { status: "PENDING" } } },
    });
    if (!business) throw notFound("Business not found");

    const pending = business.revisions[0] ?? null;
    if (decision.revisionId && pending && decision.revisionId !== pending.id) {
      throw conflict("STALE_REVIEW", "This submission has changed since you opened it. Reload it.");
    }

    const result = planDecision({
      command: decision.action,
      business: business.status,
      hasPublishedRevision: business.publishedRevisionId !== null,
      revision: pending?.status ?? null,
    });
    if (!result.ok) throw new HttpError(409, result.code, result.message);
    const { plan } = result;

    // Both updates are conditional on the state the plan was made for, so two admins
    // acting at once cannot both succeed.
    if (plan.revisionStatus && pending) {
      const { count } = await tx.businessRevision.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: { status: plan.revisionStatus },
      });
      if (count === 0) throw conflict("NOTHING_TO_REVIEW", "This submission was already reviewed");
    }
    if (plan.businessStatus || plan.publish) {
      const { count } = await tx.business.updateMany({
        where: { id: business.id, status: business.status },
        data: {
          ...(plan.businessStatus ? { status: plan.businessStatus } : {}),
          ...(plan.publish && pending ? { publishedRevisionId: pending.id } : {}),
        },
      });
      if (count === 0)
        throw conflict("CONCURRENT_CHANGE", "The business was changed by someone else");
    }

    await tx.reviewDecision.create({
      data: {
        businessId: business.id,
        revisionId: plan.revisionStatus ? (pending?.id ?? null) : null,
        adminId,
        action: plan.action,
        reason: decision.reason || null,
      },
    });
    await recordAudit(tx, {
      actorId: adminId,
      action: `business.${plan.action.toLowerCase()}`,
      entityType: "Business",
      entityId: business.id,
      metadata: {
        revisionId: pending?.id ?? null,
        from: business.status,
        to: plan.businessStatus ?? business.status,
        reason: decision.reason || null,
      },
    });
  });
}
