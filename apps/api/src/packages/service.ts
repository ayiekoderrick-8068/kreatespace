import { randomUUID } from "node:crypto";
import {
  IMAGE_EXTENSIONS,
  MAX_PACKAGES,
  packageContentSchema,
  type PackageContent,
  type RevisionStatus,
  type UploadRequest,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound, parseInput } from "../http/errors.js";
import { requireApprovedBusiness } from "../portfolio/service.js";
import { resolveImages, type ImageView } from "../storage/image-urls.js";
import { InvalidImageError, inspectImage } from "../storage/image-validation.js";
import type { MediaStorage } from "../storage/media-storage.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** What is stored in a package's `draft` and `published` columns. */
export interface StoredPackage {
  name?: string;
  description?: string;
  includes?: string[];
  startingPriceKes?: number | null;
  imagePath?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export interface PackageView {
  name: string;
  description: string;
  includes: string[];
  startingPriceKes: number | null;
  image: ImageView | null;
}

const folderFor = (businessId: string, packageId: string) =>
  `businesses/${businessId}/packages/${packageId}`;

export function stored(value: unknown): StoredPackage {
  return (value ?? {}) as StoredPackage;
}

/** Builds the display form of stored content, resolving its image in one batch. */
export async function toPackageViews(
  storage: MediaStorage | undefined,
  contents: StoredPackage[],
): Promise<PackageView[]> {
  const refs = contents.flatMap((c) =>
    c.imagePath
      ? [{ path: c.imagePath, width: c.imageWidth ?? 1, height: c.imageHeight ?? 1 }]
      : [],
  );
  const images = await resolveImages(storage, refs);
  return contents.map((c) => ({
    name: c.name ?? "",
    description: c.description ?? "",
    includes: c.includes ?? [],
    startingPriceKes: c.startingPriceKes ?? null,
    image: c.imagePath ? (images.get(c.imagePath) ?? null) : null,
  }));
}

export async function loadOwnedPackage(db: Db, userId: string, packageId: string) {
  const pkg = await db.servicePackage.findFirst({
    where: { id: packageId, business: { ownerId: userId } },
  });
  if (!pkg) throw notFound("Package not found");
  return pkg;
}

function limitReached() {
  return conflict(
    "PACKAGE_LIMIT_REACHED",
    `You can have up to ${MAX_PACKAGES} service packages. Archive one to add another.`,
  );
}

export interface OwnPackage {
  id: string;
  status: string;
  reviewState: RevisionStatus;
  editable: boolean;
  hasPublishedVersion: boolean;
  draft: PackageView;
  published: PackageView | null;
  latestFeedback: { action: string; reason: string | null } | null;
  updatedAt: Date;
}

async function toOwnPackage(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  pkg: Prisma.ServicePackageGetPayload<Record<string, never>>,
): Promise<OwnPackage> {
  const [draft, published] = await toPackageViews(storage, [
    stored(pkg.draft),
    ...(pkg.published ? [stored(pkg.published)] : []),
  ]);
  const feedback = await prisma.packageReviewDecision.findFirst({
    where: { packageId: pkg.id },
    orderBy: { createdAt: "desc" },
    select: { action: true, reason: true },
  });
  return {
    id: pkg.id,
    status: pkg.status,
    reviewState: pkg.reviewState,
    editable: pkg.status === "ACTIVE" && pkg.reviewState !== "PENDING",
    hasPublishedVersion: pkg.publishedAt !== null,
    draft: draft!,
    published: pkg.published ? (published ?? null) : null,
    latestFeedback: feedback,
    updatedAt: pkg.updatedAt,
  };
}

export async function createPackage(
  prisma: PrismaClient,
  input: { userId: string; content: PackageContent },
): Promise<{ packageId: string }> {
  const business = await requireApprovedBusiness(prisma, input.userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"packages:" + business.id}))::text`;
    const active = await tx.servicePackage.count({
      where: { businessId: business.id, status: { not: "ARCHIVED" } },
    });
    if (active >= MAX_PACKAGES) throw limitReached();

    const created = await tx.servicePackage.create({
      data: {
        businessId: business.id,
        draft: { ...input.content, startingPriceKes: input.content.startingPriceKes ?? null },
        sortOrder: active,
      },
    });
    await recordAudit(tx, {
      actorId: input.userId,
      action: "package.created",
      entityType: "ServicePackage",
      entityId: created.id,
    });
    return { packageId: created.id };
  });
}

export async function listOwnPackages(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  userId: string,
): Promise<{ packages: OwnPackage[]; usage: { used: number; limit: number } }> {
  const business = await requireApprovedBusiness(prisma, userId);
  const rows = await prisma.servicePackage.findMany({
    where: { businessId: business.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const packages = await Promise.all(rows.map((row) => toOwnPackage(prisma, storage, row)));
  return {
    packages,
    usage: { used: rows.filter((r) => r.status !== "ARCHIVED").length, limit: MAX_PACKAGES },
  };
}

export async function getOwnPackage(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { userId: string; packageId: string },
): Promise<OwnPackage> {
  return toOwnPackage(
    prisma,
    storage,
    await loadOwnedPackage(prisma, input.userId, input.packageId),
  );
}

export async function updatePackage(
  prisma: PrismaClient,
  input: { userId: string; packageId: string; changes: Partial<PackageContent> },
): Promise<void> {
  await requireApprovedBusiness(prisma, input.userId);
  await prisma.$transaction(async (tx) => {
    const pkg = await loadOwnedPackage(tx, input.userId, input.packageId);
    if (pkg.status !== "ACTIVE" || pkg.reviewState === "PENDING") {
      throw conflict("PACKAGE_LOCKED", "This package can’t be edited right now.");
    }
    const draft = { ...stored(pkg.draft), ...input.changes };
    await tx.servicePackage.update({
      where: { id: pkg.id },
      data: {
        draft: draft as Prisma.InputJsonValue,
        // Editing an approved or rejected package starts a new draft; the live version is untouched.
        reviewState:
          pkg.reviewState === "APPROVED" || pkg.reviewState === "REJECTED"
            ? "DRAFT"
            : pkg.reviewState,
      },
    });
  });
}

export async function submitPackage(
  prisma: PrismaClient,
  input: { userId: string; packageId: string },
): Promise<void> {
  await requireApprovedBusiness(prisma, input.userId);
  const pkg = await loadOwnedPackage(prisma, input.userId, input.packageId);
  if (pkg.status !== "ACTIVE" || !["DRAFT", "CHANGES_REQUESTED"].includes(pkg.reviewState)) {
    throw conflict("CANNOT_SUBMIT", "This package can’t be submitted for review right now");
  }
  const draft = stored(pkg.draft);
  parseInput(packageContentSchema, {
    name: draft.name,
    description: draft.description,
    includes: draft.includes,
    startingPriceKes: draft.startingPriceKes ?? null,
  });

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.servicePackage.updateMany({
      where: { id: pkg.id, status: "ACTIVE", reviewState: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
      data: { reviewState: "PENDING", submittedAt: new Date() },
    });
    if (count === 0)
      throw conflict("CANNOT_SUBMIT", "This package can’t be submitted for review right now");
    await recordAudit(tx, {
      actorId: input.userId,
      action: "package.submitted",
      entityType: "ServicePackage",
      entityId: pkg.id,
    });
  });
}

/** Archiving removes the package from the public page. */
export async function archivePackage(
  prisma: PrismaClient,
  input: { userId: string; packageId: string },
): Promise<void> {
  await requireApprovedBusiness(prisma, input.userId);
  await prisma.$transaction(async (tx) => {
    const pkg = await loadOwnedPackage(tx, input.userId, input.packageId);
    const { count } = await tx.servicePackage.updateMany({
      where: { id: pkg.id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    if (count === 0) throw conflict("ALREADY_ARCHIVED", "This package is already archived");
    await recordAudit(tx, {
      actorId: input.userId,
      action: "package.archived",
      entityType: "ServicePackage",
      entityId: pkg.id,
    });
  });
}

// --- optional package image ------------------------------------------------------------------

export async function createPackageImageUpload(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { userId: string; packageId: string; upload: UploadRequest },
) {
  const business = await requireApprovedBusiness(prisma, input.userId);
  const pkg = await loadOwnedPackage(prisma, input.userId, input.packageId);
  if (pkg.status !== "ACTIVE" || pkg.reviewState === "PENDING") {
    throw conflict("PACKAGE_LOCKED", "This package can’t be edited right now.");
  }
  const path = `${folderFor(business.id, pkg.id)}/${randomUUID()}.${IMAGE_EXTENSIONS[input.upload.contentType]}`;
  return { path, ...(await storage.createUploadTarget(path)) };
}

export async function confirmPackageImage(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { userId: string; packageId: string; path: string },
): Promise<void> {
  const business = await requireApprovedBusiness(prisma, input.userId);
  const pkg = await loadOwnedPackage(prisma, input.userId, input.packageId);
  if (pkg.status !== "ACTIVE" || pkg.reviewState === "PENDING") {
    throw conflict("PACKAGE_LOCKED", "This package can’t be edited right now.");
  }
  const pattern = new RegExp(`^${folderFor(business.id, pkg.id)}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  if (!pattern.test(input.path)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
      fields: { path: "Invalid image reference" },
    });
  }
  const bytes = await storage.download(input.path);
  if (!bytes) throw new HttpError(400, "UPLOAD_MISSING", "That photo didn’t finish uploading.");

  let inspected;
  try {
    inspected = inspectImage(bytes);
    if (!input.path.endsWith(`.${inspected.extension}`)) {
      throw new InvalidImageError("The file type doesn’t match what was uploaded.");
    }
  } catch (error) {
    if (error instanceof InvalidImageError) {
      await storage.remove([input.path]).catch(() => undefined);
      throw new HttpError(400, "INVALID_IMAGE", error.message);
    }
    throw error;
  }

  const previous = stored(pkg.draft).imagePath;
  await prisma.servicePackage.update({
    where: { id: pkg.id },
    data: {
      draft: {
        ...stored(pkg.draft),
        imagePath: input.path,
        imageWidth: inspected.width,
        imageHeight: inspected.height,
      } as Prisma.InputJsonValue,
      reviewState:
        pkg.reviewState === "APPROVED" || pkg.reviewState === "REJECTED"
          ? "DRAFT"
          : pkg.reviewState,
    },
  });
  await removeIfUnused(prisma, storage, pkg.id, previous);
}

export async function removePackageImage(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { userId: string; packageId: string },
): Promise<void> {
  await requireApprovedBusiness(prisma, input.userId);
  const pkg = await loadOwnedPackage(prisma, input.userId, input.packageId);
  if (pkg.status !== "ACTIVE" || pkg.reviewState === "PENDING") {
    throw conflict("PACKAGE_LOCKED", "This package can’t be edited right now.");
  }
  const previous = stored(pkg.draft).imagePath;
  await prisma.servicePackage.update({
    where: { id: pkg.id },
    data: {
      draft: { ...stored(pkg.draft), imagePath: null, imageWidth: null, imageHeight: null },
      reviewState:
        pkg.reviewState === "APPROVED" || pkg.reviewState === "REJECTED"
          ? "DRAFT"
          : pkg.reviewState,
    },
  });
  await removeIfUnused(prisma, storage, pkg.id, previous);
}

/** A replaced image stays in storage while the live (published) version still uses it. */
async function removeIfUnused(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  packageId: string,
  path: string | null | undefined,
) {
  if (!storage || !path) return;
  const pkg = await prisma.servicePackage.findUnique({ where: { id: packageId } });
  const inUse = stored(pkg?.draft).imagePath === path || stored(pkg?.published).imagePath === path;
  if (!inUse) await storage.remove([path]).catch(() => undefined);
}

// --- public ----------------------------------------------------------------------------------

export interface PublicPackage extends PackageView {
  id: string;
}

/** Live packages of a business: approved, active, and only ever the published version. */
export async function listPublicPackages(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  businessId: string,
): Promise<PublicPackage[]> {
  const rows = await prisma.servicePackage.findMany({
    where: { businessId, status: "ACTIVE", publishedAt: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, published: true },
  });
  const views = await toPackageViews(
    storage,
    rows.map((row) => stored(row.published)),
  );
  return rows.map((row, index) => ({ id: row.id, ...views[index]! }));
}
