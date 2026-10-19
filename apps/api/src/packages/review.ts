import type { ReviewCommand, ReviewDecisionInput, RevisionStatus } from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, notFound } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { stored, toPackageViews, type PackageView } from "./service.js";

const PAGE_SIZE = 20;

type PlanResult =
  | {
      ok: true;
      action: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "SUSPENDED" | "REINSTATED";
      reviewState?: RevisionStatus;
      status?: "ACTIVE" | "SUSPENDED";
      publish?: boolean;
    }
  | { ok: false; code: string; message: string };

/** Transitions an admin may apply to a service package. */
export function planPackageDecision(input: {
  command: ReviewCommand;
  status: "ACTIVE" | "ARCHIVED" | "SUSPENDED";
  reviewState: RevisionStatus;
  hasPublished: boolean;
}): PlanResult {
  const { command, status, reviewState, hasPublished } = input;
  switch (command) {
    case "APPROVE":
    case "REQUEST_CHANGES":
    case "REJECT":
      if (reviewState !== "PENDING") {
        return {
          ok: false,
          code: "NOTHING_TO_REVIEW",
          message: "There is no submission awaiting review",
        };
      }
      if (status !== "ACTIVE") {
        return {
          ok: false,
          code: "PACKAGE_LOCKED",
          message: `A ${status.toLowerCase()} package can’t be reviewed`,
        };
      }
      if (command === "APPROVE") {
        return { ok: true, action: "APPROVED", reviewState: "APPROVED", publish: true };
      }
      return command === "REJECT"
        ? { ok: true, action: "REJECTED", reviewState: "REJECTED" }
        : { ok: true, action: "CHANGES_REQUESTED", reviewState: "CHANGES_REQUESTED" };
    case "SUSPEND":
      if (status !== "ACTIVE" || !hasPublished) {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          message: "Only live packages can be suspended",
        };
      }
      return { ok: true, action: "SUSPENDED", status: "SUSPENDED" };
    case "REINSTATE":
      if (status !== "SUSPENDED") {
        return {
          ok: false,
          code: "INVALID_TRANSITION",
          message: "Only suspended packages can be reinstated",
        };
      }
      return { ok: true, action: "REINSTATED", status: "ACTIVE" };
  }
}

export async function listPackagesForReview(
  prisma: PrismaClient,
  query: {
    state?: RevisionStatus;
    status?: "ACTIVE" | "ARCHIVED" | "SUSPENDED";
    businessId?: string;
    page: number;
  },
) {
  const where: Prisma.ServicePackageWhereInput = {
    ...(query.state ? { reviewState: query.state } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.businessId ? { businessId: query.businessId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.servicePackage.count({ where }),
    prisma.servicePackage.findMany({
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
      },
    }),
  ]);
  return {
    total,
    page: query.page,
    pageSize: PAGE_SIZE,
    items: rows.map((row) => ({
      id: row.id,
      name: stored(row.draft).name ?? "",
      status: row.status,
      reviewState: row.reviewState,
      businessId: row.business.id,
      businessName: row.business.revisions[0]?.businessName ?? row.business.slug,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    })),
  };
}

export async function getPackageForReview(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  packageId: string,
) {
  const pkg = await prisma.servicePackage.findUnique({
    where: { id: packageId },
    include: {
      business: {
        select: {
          id: true,
          slug: true,
          status: true,
          revisions: { orderBy: { version: "desc" }, take: 1, select: { businessName: true } },
        },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, email: true, fullName: true } } },
      },
    },
  });
  if (!pkg) throw notFound("Package not found");
  const views = await toPackageViews(storage, [
    stored(pkg.draft),
    ...(pkg.published ? [stored(pkg.published)] : []),
  ]);
  const draft: PackageView = views[0]!;
  return {
    package: {
      id: pkg.id,
      status: pkg.status,
      reviewState: pkg.reviewState,
      submittedAt: pkg.submittedAt,
      publishedAt: pkg.publishedAt,
    },
    business: {
      id: pkg.business.id,
      slug: pkg.business.slug,
      name: pkg.business.revisions[0]?.businessName ?? pkg.business.slug,
      status: pkg.business.status,
    },
    draft,
    published: pkg.published ? (views[1] ?? null) : null,
    decisions: pkg.decisions.map((d) => ({
      id: d.id,
      action: d.action,
      reason: d.reason,
      createdAt: d.createdAt,
      admin: d.admin,
    })),
  };
}

export async function decideOnPackage(
  prisma: PrismaClient,
  input: { packageId: string; adminId: string; decision: ReviewDecisionInput },
): Promise<void> {
  const { packageId, adminId, decision } = input;
  await prisma.$transaction(async (tx) => {
    const pkg = await tx.servicePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw notFound("Package not found");

    const plan = planPackageDecision({
      command: decision.action,
      status: pkg.status,
      reviewState: pkg.reviewState,
      hasPublished: pkg.publishedAt !== null,
    });
    if (!plan.ok) throw new HttpError(409, plan.code, plan.message);

    // Conditional on the state the plan was made for, so simultaneous decisions cannot both apply.
    const { count } = await tx.servicePackage.updateMany({
      where: { id: pkg.id, status: pkg.status, reviewState: pkg.reviewState },
      data: {
        ...(plan.reviewState ? { reviewState: plan.reviewState } : {}),
        ...(plan.status ? { status: plan.status } : {}),
        ...(plan.publish
          ? { published: pkg.draft as Prisma.InputJsonValue, publishedAt: new Date() }
          : {}),
      },
    });
    if (count === 0) {
      throw new HttpError(409, "CONCURRENT_CHANGE", "This package was changed by someone else");
    }
    await tx.packageReviewDecision.create({
      data: { packageId: pkg.id, adminId, action: plan.action, reason: decision.reason || null },
    });
    await recordAudit(tx, {
      actorId: adminId,
      action: `package.${plan.action.toLowerCase()}`,
      entityType: "ServicePackage",
      entityId: pkg.id,
      metadata: { reason: decision.reason || null },
    });
  });
}
