import { randomUUID } from "node:crypto";
import type { BusinessStatus, CreationStatus, RevisionStatus } from "@kreatespace/shared";
import { slugify } from "../businesses/service.js";
import type { PrismaClient } from "../generated/prisma/client.js";

// Helpers that write business and creation records directly to the database. They are used by
// tests and by the clearly-labelled development fixtures; production code never calls them.
// (Sellers create real creations through the seller tools added in a later milestone.)

export interface BuiltBusiness {
  businessId: string;
  ownerId: string;
  revisionId: string;
  slug: string;
}

export interface BusinessOptions {
  name: string;
  slug?: string;
  status?: BusinessStatus;
  county?: string;
  city?: string;
  categorySlug?: string;
  description?: string;
  whatsappNumber?: string;
  websiteUrl?: string | null;
  logoPath?: string | null;
}

const revisionStatusFor = (status: BusinessStatus): RevisionStatus =>
  status === "SUSPENDED" ? "APPROVED" : status;

export async function buildBusiness(
  prisma: PrismaClient,
  options: BusinessOptions,
): Promise<BuiltBusiness> {
  const status = options.status ?? "APPROVED";
  const slug = options.slug ?? slugify(options.name);
  const ownerId = randomUUID();
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: options.categorySlug ?? "cakes" },
  });

  await prisma.user.create({
    data: { id: ownerId, email: `${slug}-${ownerId.slice(0, 8)}@example.test`, role: "SELLER" },
  });
  const business = await prisma.business.create({
    data: {
      ownerId,
      slug,
      status: "DRAFT",
      revisions: {
        create: {
          version: 1,
          status: revisionStatusFor(status),
          businessName: options.name,
          ownerName: "Fixture Owner",
          description:
            options.description ?? `${options.name} creates handmade work to order in Kenya.`,
          categoryId: category.id,
          county: options.county ?? "Nairobi",
          city: options.city ?? "Westlands",
          websiteUrl: options.websiteUrl === undefined ? null : options.websiteUrl,
          whatsappNumber: options.whatsappNumber ?? "+254712345678",
          logoPath: options.logoPath ?? null,
          termsAcceptedAt: new Date(),
          contentAuthorizedAt: new Date(),
          submittedAt: new Date(),
        },
      },
    },
    include: { revisions: true },
  });
  const revision = business.revisions[0]!;
  const published = status === "APPROVED" || status === "SUSPENDED";
  await prisma.business.update({
    where: { id: business.id },
    data: { status, publishedRevisionId: published ? revision.id : null },
  });
  return { businessId: business.id, ownerId, revisionId: revision.id, slug };
}

export interface CreationOptions {
  businessId: string;
  title: string;
  description?: string;
  categorySlug?: string;
  occasionSlug?: string | null;
  status?: CreationStatus;
  publishedAt?: Date;
  images?: { path: string; width: number; height: number }[];
}

export async function buildCreation(
  prisma: PrismaClient,
  options: CreationOptions,
): Promise<{ creationId: string; revisionId: string }> {
  const status = options.status ?? "APPROVED";
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: options.categorySlug ?? "cakes" },
  });
  const occasion = options.occasionSlug
    ? await prisma.occasion.findUniqueOrThrow({ where: { slug: options.occasionSlug } })
    : null;
  const revisionStatus: RevisionStatus =
    status === "ARCHIVED" || status === "APPROVED" ? "APPROVED" : status;
  const images = options.images ?? [
    { path: "dev-fixtures/sample-1.svg", width: 800, height: 1000 },
  ];

  const creation = await prisma.creation.create({
    data: {
      businessId: options.businessId,
      status: "DRAFT",
      revisions: {
        create: {
          version: 1,
          status: revisionStatus,
          title: options.title,
          description:
            options.description ?? `${options.title}, made to order with care and attention.`,
          categoryId: category.id,
          occasionId: occasion?.id ?? null,
          submittedAt: new Date(),
          images: { create: images.map((image, position) => ({ ...image, position })) },
        },
      },
    },
    include: { revisions: true },
  });
  const revision = creation.revisions[0]!;
  const published = status === "APPROVED" || status === "ARCHIVED";
  await prisma.creation.update({
    where: { id: creation.id },
    data: {
      status,
      publishedRevisionId: published ? revision.id : null,
      publishedAt: published ? (options.publishedAt ?? new Date()) : null,
    },
  });
  return { creationId: creation.id, revisionId: revision.id };
}
