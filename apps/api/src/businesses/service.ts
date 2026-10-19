import { randomUUID } from "node:crypto";
import {
  IMAGE_EXTENSIONS,
  businessSubmissionSchema,
  type BusinessDetails,
  type BusinessDraftInput,
  type UploadRequest,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound, parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  toRevisionView,
  type BusinessSummary,
  type DecisionView,
  type RevisionRecord,
  type RevisionView,
} from "./views.js";
import {
  OPEN_REVISION_STATUSES,
  businessStatusAfterSubmit,
  canOwnerEdit,
  canOwnerSubmit,
  canStartRevision,
} from "./workflow.js";

export const revisionInclude = {
  category: { select: { id: true, slug: true, name: true } },
  images: { select: { path: true, position: true }, orderBy: { position: "asc" } },
} satisfies Prisma.BusinessRevisionInclude;

export interface OwnBusinessView {
  business: BusinessSummary;
  /** The revision the owner is working on, or the latest one when nothing is open. */
  revision: RevisionView;
  /** What visitors currently see, when it differs from `revision`. */
  publishedRevision: RevisionView | null;
  decisions: DecisionView[];
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "business";
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await tx.business.findUnique({ where: { slug: candidate }, select: { id: true } }))) {
      return candidate;
    }
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

const emptyToNull = (value: string | undefined | null) => (value ? value : null);

async function requireActiveCategory(prisma: PrismaClient | Prisma.TransactionClient, id: string) {
  const category = await prisma.category.findFirst({ where: { id, active: true } });
  if (!category) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
      fields: { categoryId: "Choose a valid category" },
    });
  }
}

export function listCategories(prisma: PrismaClient) {
  return prisma.category.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true },
  });
}

export async function createBusiness(
  prisma: PrismaClient,
  input: { ownerId: string; details: BusinessDetails },
): Promise<{ businessId: string }> {
  const { ownerId, details } = input;
  await requireActiveCategory(prisma, details.categoryId);

  return prisma.$transaction(async (tx) => {
    if (await tx.business.findUnique({ where: { ownerId }, select: { id: true } })) {
      throw conflict("BUSINESS_EXISTS", "You have already registered a business");
    }
    const business = await tx.business.create({
      data: {
        ownerId,
        slug: await uniqueSlug(tx, details.businessName),
        revisions: {
          create: {
            version: 1,
            businessName: details.businessName,
            ownerName: details.ownerName,
            description: details.description,
            categoryId: details.categoryId,
            county: details.county,
            city: details.city,
            websiteUrl: emptyToNull(details.websiteUrl),
            whatsappNumber: details.whatsappNumber,
          },
        },
      },
    });
    await recordAudit(tx, {
      actorId: ownerId,
      action: "business.created",
      entityType: "Business",
      entityId: business.id,
    });
    return { businessId: business.id };
  });
}

/** Finds the owner's business with the revision they are currently working on. */
async function loadOwnBusiness(prisma: PrismaClient | Prisma.TransactionClient, ownerId: string) {
  const business = await prisma.business.findUnique({
    where: { ownerId },
    include: {
      revisions: { include: revisionInclude, orderBy: { version: "desc" } },
    },
  });
  if (!business) throw notFound("You have not registered a business yet");

  const open = business.revisions.find((r) => OPEN_REVISION_STATUSES.includes(r.status));
  const working = open ?? business.revisions[0]!;
  return { business, working, open };
}

export async function getOwnBusiness(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  ownerId: string,
): Promise<OwnBusinessView> {
  const { business, working } = await loadOwnBusiness(prisma, ownerId);
  const published = business.publishedRevisionId
    ? business.revisions.find((r) => r.id === business.publishedRevisionId)
    : undefined;
  const decisions = await prisma.reviewDecision.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, action: true, reason: true, createdAt: true, revisionId: true },
  });

  return {
    business: {
      id: business.id,
      slug: business.slug,
      status: business.status,
      createdAt: business.createdAt,
    },
    revision: await toRevisionView(working as RevisionRecord, storage),
    publishedRevision:
      published && published.id !== working.id
        ? await toRevisionView(published as RevisionRecord, storage)
        : null,
    decisions,
  };
}

const ownPathPrefix = (businessId: string) => `businesses/${businessId}/`;

function assertOwnPaths(businessId: string, paths: string[], field: string) {
  if (paths.some((path) => !path.startsWith(ownPathPrefix(businessId)))) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
      fields: { [field]: "Invalid image reference" },
    });
  }
}

export async function updateDraft(
  prisma: PrismaClient,
  input: { ownerId: string; changes: BusinessDraftInput },
): Promise<void> {
  const { ownerId, changes } = input;

  await prisma.$transaction(async (tx) => {
    const { business, open } = await loadOwnBusiness(tx, ownerId);
    if (!open || !canOwnerEdit(business.status, open.status)) {
      throw conflict(
        "REVISION_LOCKED",
        "Your business can’t be edited right now. It may be awaiting review.",
      );
    }

    if (changes.categoryId) await requireActiveCategory(tx, changes.categoryId);
    const paths = [
      ...(changes.portfolioPaths ?? []),
      ...(changes.logoPath ? [changes.logoPath] : []),
    ];
    assertOwnPaths(business.id, paths, "portfolioPaths");

    const data: Prisma.BusinessRevisionUpdateInput = {};
    if (changes.businessName !== undefined) data.businessName = changes.businessName;
    if (changes.ownerName !== undefined) data.ownerName = changes.ownerName;
    if (changes.description !== undefined) data.description = changes.description;
    if (changes.categoryId !== undefined) data.category = { connect: { id: changes.categoryId } };
    if (changes.county !== undefined) data.county = changes.county;
    if (changes.city !== undefined) data.city = changes.city;
    if (changes.websiteUrl !== undefined) data.websiteUrl = emptyToNull(changes.websiteUrl);
    if (changes.whatsappNumber !== undefined) data.whatsappNumber = changes.whatsappNumber;
    if (changes.logoPath !== undefined) data.logoPath = changes.logoPath;
    if (changes.termsAccepted !== undefined) {
      data.termsAcceptedAt = changes.termsAccepted ? (open.termsAcceptedAt ?? new Date()) : null;
    }
    if (changes.contentAuthorization !== undefined) {
      data.contentAuthorizedAt = changes.contentAuthorization
        ? (open.contentAuthorizedAt ?? new Date())
        : null;
    }

    await tx.businessRevision.update({ where: { id: open.id }, data });

    if (changes.portfolioPaths !== undefined) {
      await tx.businessImage.deleteMany({ where: { revisionId: open.id } });
      await tx.businessImage.createMany({
        data: changes.portfolioPaths.map((path, position) => ({
          revisionId: open.id,
          path,
          position,
        })),
      });
    }
  });
}

/**
 * Starts an editable copy of the published profile. The published version stays live and
 * unchanged until an admin approves the new revision.
 */
export async function startRevision(
  prisma: PrismaClient,
  input: { ownerId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { ownerId: input.ownerId },
      include: {
        publishedRevision: { include: { images: { orderBy: { position: "asc" } } } },
        revisions: { select: { version: true, status: true } },
      },
    });
    if (!business) throw notFound("You have not registered a business yet");

    const hasOpen = business.revisions.some((r) => OPEN_REVISION_STATUSES.includes(r.status));
    const published = business.publishedRevision;
    if (!published || !canStartRevision(business.status, hasOpen)) {
      throw conflict(
        "CANNOT_START_REVISION",
        "You can only edit an approved profile that has no update in progress",
      );
    }

    const version = Math.max(...business.revisions.map((r) => r.version)) + 1;
    await tx.businessRevision.create({
      data: {
        businessId: business.id,
        version,
        businessName: published.businessName,
        ownerName: published.ownerName,
        description: published.description,
        categoryId: published.categoryId,
        county: published.county,
        city: published.city,
        websiteUrl: published.websiteUrl,
        whatsappNumber: published.whatsappNumber,
        logoPath: published.logoPath,
        termsAcceptedAt: published.termsAcceptedAt,
        contentAuthorizedAt: published.contentAuthorizedAt,
        images: {
          create: published.images.map((image) => ({ path: image.path, position: image.position })),
        },
      },
    });
    await recordAudit(tx, {
      actorId: input.ownerId,
      action: "business.revision_started",
      entityType: "Business",
      entityId: business.id,
      metadata: { version },
    });
  });
}

export async function createUploadTarget(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { ownerId: string; upload: UploadRequest },
) {
  const { business, open } = await loadOwnBusiness(prisma, input.ownerId);
  if (!open || !canOwnerEdit(business.status, open.status)) {
    throw conflict("REVISION_LOCKED", "Your business can’t be edited right now.");
  }
  const extension = IMAGE_EXTENSIONS[input.upload.contentType];
  const path = `${ownPathPrefix(business.id)}${randomUUID()}.${extension}`;
  const target = await storage.createUploadTarget(path);
  return { path, ...target };
}

export async function submitForReview(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { ownerId: string },
): Promise<void> {
  const { business, open } = await loadOwnBusiness(prisma, input.ownerId);
  if (!open || !canOwnerSubmit(business.status, open.status)) {
    throw conflict("CANNOT_SUBMIT", "This business can’t be submitted for review right now");
  }

  const submission = parseInput(businessSubmissionSchema, {
    businessName: open.businessName,
    ownerName: open.ownerName,
    description: open.description,
    categoryId: open.categoryId,
    county: open.county,
    city: open.city,
    websiteUrl: open.websiteUrl ?? "",
    whatsappNumber: open.whatsappNumber,
    logoPath: open.logoPath,
    portfolioPaths: open.images.map((image) => image.path),
    termsAccepted: open.termsAcceptedAt !== null,
    contentAuthorization: open.contentAuthorizedAt !== null,
  });

  if (storage) {
    const stored = new Set(await storage.listFolder(ownPathPrefix(business.id)));
    const missing = [
      ...submission.portfolioPaths,
      ...(submission.logoPath ? [submission.logoPath] : []),
    ].filter((path) => !stored.has(path.slice(ownPathPrefix(business.id).length)));
    if (missing.length > 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
        fields: {
          portfolioPaths: "One or more photos did not finish uploading. Please try again.",
        },
      });
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Guard against double submission: only a still-editable revision may move to PENDING.
    const { count } = await tx.businessRevision.updateMany({
      where: { id: open.id, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
      data: { status: "PENDING", submittedAt: now },
    });
    if (count === 0) {
      throw conflict("CANNOT_SUBMIT", "This business can’t be submitted for review right now");
    }
    await tx.business.update({
      where: { id: business.id },
      data: {
        status: businessStatusAfterSubmit(business.status, business.publishedRevisionId !== null),
      },
    });
    await recordAudit(tx, {
      actorId: input.ownerId,
      action: "business.submitted",
      entityType: "Business",
      entityId: business.id,
      metadata: { revisionId: open.id, version: open.version },
    });
  });
}
