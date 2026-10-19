import { conflict, notFound } from "../http/errors.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { cardSelect, toCards, type CreationPage } from "./service.js";
import { visibleCreation } from "./visibility.js";

/** A simple safety cap; saved creations are a shortlist, not an archive. */
export const MAX_SAVED_PER_USER = 1000;

/** Saves a creation for the user. Only creations visible to the public can be saved. */
export async function saveCreation(
  prisma: PrismaClient,
  input: { userId: string; creationId: string },
): Promise<void> {
  const { userId, creationId } = input;
  const creation = await prisma.creation.findFirst({
    where: { id: creationId, ...visibleCreation },
    select: { id: true },
  });
  if (!creation) throw notFound("Creation not found");

  const already = await prisma.savedCreation.findUnique({
    where: { userId_creationId: { userId, creationId } },
    select: { userId: true },
  });
  if (already) return;

  if ((await prisma.savedCreation.count({ where: { userId } })) >= MAX_SAVED_PER_USER) {
    throw conflict("SAVED_LIMIT", `You can save up to ${MAX_SAVED_PER_USER} creations`);
  }
  // Atomic and idempotent: simultaneous requests for the same pair cannot conflict.
  await prisma.$executeRaw`
    INSERT INTO "saved_creations" ("userId", "creationId")
    VALUES (${userId}::uuid, ${creationId}::uuid)
    ON CONFLICT ("userId", "creationId") DO NOTHING`;
}

/** Removes a save. Always allowed, even if the creation is no longer public. */
export async function unsaveCreation(
  prisma: PrismaClient,
  input: { userId: string; creationId: string },
): Promise<void> {
  await prisma.savedCreation.deleteMany({ where: input });
}

/** Ids of everything the user has saved, so cards can show the right state. */
export async function listSavedIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const rows = await prisma.savedCreation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_SAVED_PER_USER,
    select: { creationId: true },
  });
  return rows.map((row) => row.creationId);
}

/** The user's saved creations that are still public, most recently saved first. */
export async function listSaved(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  input: { userId: string; page: number; pageSize: number },
): Promise<CreationPage> {
  const { userId, page, pageSize } = input;
  const rows = await prisma.savedCreation.findMany({
    where: { userId, creation: visibleCreation },
    orderBy: [{ createdAt: "desc" }, { creationId: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    select: { creation: { select: cardSelect } },
  });
  const items = await toCards(
    storage,
    rows.slice(0, pageSize).map((row) => row.creation),
  );
  return { items, page, pageSize, hasMore: rows.length > pageSize };
}
