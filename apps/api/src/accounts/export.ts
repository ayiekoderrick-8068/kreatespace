import type { PrismaClient } from "../generated/prisma/client.js";
import { notFound } from "../http/errors.js";

/**
 * Everything KreateSpace holds about one person, in a form they can read and keep. This answers an
 * access request without anyone having to ask. It is built only from the signed-in person's own
 * records, never from a parameter.
 */
export async function exportAccountData(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, role: true, createdAt: true },
  });
  if (!user) throw notFound("Account not found");

  const [saved, business, deletionRequests, actions] = await Promise.all([
    prisma.savedCreation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        creationId: true,
        creation: { select: { publishedRevision: { select: { title: true } } } },
      },
    }),
    prisma.business.findUnique({
      where: { ownerId: userId },
      select: {
        id: true,
        slug: true,
        status: true,
        createdAt: true,
        revisions: {
          orderBy: { version: "asc" },
          select: {
            version: true,
            status: true,
            businessName: true,
            ownerName: true,
            description: true,
            county: true,
            city: true,
            websiteUrl: true,
            whatsappNumber: true,
            termsAcceptedAt: true,
            termsVersion: true,
            contentAuthorizedAt: true,
            submittedAt: true,
            category: { select: { name: true } },
          },
        },
        decisions: {
          orderBy: { createdAt: "asc" },
          select: { action: true, reason: true, createdAt: true },
        },
        creations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            createdAt: true,
            revisions: {
              orderBy: { version: "asc" },
              select: {
                version: true,
                status: true,
                title: true,
                description: true,
                category: { select: { name: true } },
                occasion: { select: { name: true } },
                images: { orderBy: { position: "asc" }, select: { width: true, height: true } },
              },
            },
          },
        },
        packages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, reviewState: true, draft: true, published: true },
        },
        websiteRequests: {
          orderBy: { createdAt: "asc" },
          select: {
            type: true,
            description: true,
            budget: true,
            timeline: true,
            status: true,
            responseNote: true,
            createdAt: true,
          },
        },
        importAuthorizations: {
          select: { domain: true, createdAt: true, revokedAt: true },
        },
      },
    }),
    prisma.accountDeletionRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: "asc" },
      select: {
        status: true,
        requestedAt: true,
        scheduledFor: true,
        completedAt: true,
        cancelledAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { action: true, entityType: true, createdAt: true },
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    about:
      "This file lists the personal data KreateSpace holds about your account. Photographs are not " +
      "included in the file; they remain available from your dashboard.",
    account: user,
    savedCreations: saved.map((s) => ({
      creationId: s.creationId,
      savedAt: s.createdAt,
      title: s.creation.publishedRevision?.title ?? null,
    })),
    business,
    deletionRequests,
    yourActions: actions,
    notIncluded: [
      "Private notes written by our administrators about requests (ask the privacy contact for these).",
      "Anonymous view and click counts, which are not linked to any person.",
      "Your password, which we never hold in readable form.",
      "Copies held by our providers in backups, which expire on their normal schedule.",
    ],
  };
}
