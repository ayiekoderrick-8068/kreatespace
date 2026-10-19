import { randomUUID } from "node:crypto";
import { IMAGE_EXTENSIONS, MAX_IMAGES_PER_CREATION, type UploadRequest } from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict } from "../http/errors.js";
import { InvalidImageError, inspectImage } from "../storage/image-validation.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { loadOwnedCreation, requireApprovedBusiness } from "./service.js";
import { canOwnerEdit } from "./workflow.js";

const folderFor = (businessId: string, creationId: string) =>
  `businesses/${businessId}/creations/${creationId}`;

function imageLimitReached() {
  return conflict(
    "IMAGE_LIMIT_REACHED",
    `A creation can have up to ${MAX_IMAGES_PER_CREATION} photos. Remove one to add another.`,
  );
}

/** The open revision the owner may change right now, or a clear refusal. */
async function requireEditable(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  creationId: string,
) {
  const { creation, open } = await loadOwnedCreation(prisma, userId, creationId);
  if (!open || !canOwnerEdit(creation.status, open.status)) {
    throw conflict(
      "REVISION_LOCKED",
      "This creation can’t be edited right now. It may be awaiting review.",
    );
  }
  return { creation, open };
}

/** Issues a one-time upload target inside this creation's own folder. */
export async function createImageUpload(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { userId: string; creationId: string; upload: UploadRequest },
) {
  const { userId, creationId, upload } = input;
  const business = await requireApprovedBusiness(prisma, userId);
  const { open } = await requireEditable(prisma, userId, creationId);
  if (open.images.length >= MAX_IMAGES_PER_CREATION) throw imageLimitReached();

  // A fresh random name per upload: nothing can overwrite an existing image.
  const path = `${folderFor(business.id, creationId)}/${randomUUID()}.${IMAGE_EXTENSIONS[upload.contentType]}`;
  const target = await storage.createUploadTarget(path);
  return { path, ...target };
}

/**
 * Attaches an uploaded file to the draft — but only after the server has downloaded it and
 * confirmed it really is an image of an allowed type, size and shape.
 */
export async function confirmImage(
  prisma: PrismaClient,
  storage: MediaStorage,
  input: { userId: string; creationId: string; path: string },
): Promise<void> {
  const { userId, creationId, path } = input;
  const business = await requireApprovedBusiness(prisma, userId);
  await requireEditable(prisma, userId, creationId);

  const pattern = new RegExp(
    `^${folderFor(business.id, creationId)}/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
  );
  if (!pattern.test(path)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
      fields: { path: "Invalid image reference" },
    });
  }

  const bytes = await storage.download(path);
  if (!bytes) {
    throw new HttpError(
      400,
      "UPLOAD_MISSING",
      "That photo didn’t finish uploading. Please try again.",
    );
  }
  try {
    const inspected = inspectImage(bytes);
    if (!path.endsWith(`.${inspected.extension}`)) {
      throw new InvalidImageError("The file type doesn’t match what was uploaded.");
    }
    await attach(prisma, { userId, creationId, path, inspected });
  } catch (error) {
    if (error instanceof InvalidImageError) {
      // Never keep a rejected file in storage.
      await storage.remove([path]).catch(() => undefined);
      throw new HttpError(400, "INVALID_IMAGE", error.message);
    }
    throw error;
  }
}

async function attach(
  prisma: PrismaClient,
  input: {
    userId: string;
    creationId: string;
    path: string;
    inspected: { width: number; height: number };
  },
) {
  const { userId, creationId, path, inspected } = input;
  try {
    await prisma.$transaction(async (tx) => {
      const { open } = await requireEditable(tx, userId, creationId);
      // Serialise concurrent additions to this draft.
      await tx.$queryRaw`SELECT "id" FROM "creation_revisions" WHERE "id" = ${open.id}::uuid FOR UPDATE`;
      const existing = await tx.creationImage.findMany({
        where: { revisionId: open.id },
        select: { path: true },
      });
      if (existing.length >= MAX_IMAGES_PER_CREATION) throw imageLimitReached();
      if (existing.some((image) => image.path === path)) {
        throw conflict("IMAGE_ALREADY_ADDED", "This photo is already on the creation");
      }
      await tx.creationImage.create({
        data: {
          revisionId: open.id,
          path,
          position: existing.length,
          width: inspected.width,
          height: inspected.height,
        },
      });
      await tx.creation.update({ where: { id: creationId }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        actorId: userId,
        action: "creation.image_added",
        entityType: "Creation",
        entityId: creationId,
      });
    });
  } catch (error) {
    if (String((error as Error)?.message).includes("image_limit_reached"))
      throw imageLimitReached();
    throw error;
  }
}

/** Puts the draft's photos in the order given; the first is the cover photo. */
export async function reorderImages(
  prisma: PrismaClient,
  input: { userId: string; creationId: string; imageIds: string[] },
): Promise<void> {
  const { userId, creationId, imageIds } = input;
  await requireApprovedBusiness(prisma, userId);

  await prisma.$transaction(async (tx) => {
    const { open } = await requireEditable(tx, userId, creationId);
    const current = open.images.map((image) => image.id);
    const sameSet =
      imageIds.length === current.length &&
      new Set(imageIds).size === imageIds.length &&
      imageIds.every((id) => current.includes(id));
    if (!sameSet) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "List every photo of this creation exactly once",
        { fields: { imageIds: "List every photo of this creation exactly once" } },
      );
    }
    // Two passes so the unique (revision, position) rule is never violated midway.
    for (const [index, id] of imageIds.entries()) {
      await tx.creationImage.update({ where: { id }, data: { position: 1000 + index } });
    }
    for (const [index, id] of imageIds.entries()) {
      await tx.creationImage.update({ where: { id }, data: { position: index } });
    }
    await tx.creation.update({ where: { id: creationId }, data: { updatedAt: new Date() } });
  });
}

/** Removes a photo from the draft, and from storage when nothing else uses the file. */
export async function removeImage(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { userId: string; creationId: string; imageId: string },
): Promise<void> {
  const { userId, creationId, imageId } = input;
  await requireApprovedBusiness(prisma, userId);

  const path = await prisma.$transaction(async (tx) => {
    const { open } = await requireEditable(tx, userId, creationId);
    const image = open.images.find((i) => i.id === imageId);
    if (!image) throw new HttpError(404, "NOT_FOUND", "Photo not found");

    await tx.creationImage.delete({ where: { id: image.id } });
    const remaining = open.images.filter((i) => i.id !== image.id);
    for (const [index, item] of remaining.entries()) {
      await tx.creationImage.update({ where: { id: item.id }, data: { position: 1000 + index } });
    }
    for (const [index, item] of remaining.entries()) {
      await tx.creationImage.update({ where: { id: item.id }, data: { position: index } });
    }
    await tx.creation.update({ where: { id: creationId }, data: { updatedAt: new Date() } });
    await recordAudit(tx, {
      actorId: userId,
      action: "creation.image_removed",
      entityType: "Creation",
      entityId: creationId,
    });
    return image.path;
  });

  // Revisions can share a file (an edit starts from a copy), so only delete unused ones.
  if (storage && (await prisma.creationImage.count({ where: { path } })) === 0) {
    await storage.remove([path]).catch(() => undefined);
  }
}

/**
 * Deletes uploaded files that never became part of a creation (abandoned uploads), once they
 * are older than the grace period. Safe to run repeatedly.
 */
export async function cleanupOrphanedUploads(
  prisma: PrismaClient,
  storage: MediaStorage,
  options: { olderThanMs?: number; now?: Date } = {},
): Promise<{ removed: number }> {
  const olderThanMs = options.olderThanMs ?? 24 * 3_600_000;
  const now = options.now ?? new Date();
  let removed = 0;
  let cursor: string | undefined;

  for (;;) {
    const creations = await prisma.creation.findMany({
      take: 200,
      orderBy: { id: "asc" },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, businessId: true },
    });
    if (creations.length === 0) break;
    cursor = creations[creations.length - 1]!.id;

    for (const creation of creations) {
      const folder = folderFor(creation.businessId, creation.id);
      const objects = await storage.listObjects(folder);
      if (objects.length === 0) continue;
      const referenced = new Set(
        (
          await prisma.creationImage.findMany({
            where: { revision: { creationId: creation.id } },
            select: { path: true },
          })
        ).map((image) => image.path),
      );
      const stale = objects
        .filter((object) => !referenced.has(`${folder}/${object.name}`))
        // Without an upload time we can't tell it's old, so leave it.
        .filter(
          (object) => object.createdAt && now.getTime() - object.createdAt.getTime() > olderThanMs,
        )
        .map((object) => `${folder}/${object.name}`);
      if (stale.length > 0) {
        await storage.remove(stale);
        removed += stale.length;
      }
    }
  }
  return { removed };
}
