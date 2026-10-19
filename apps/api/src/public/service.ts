import { cardSelect, toCards, type CreationCard } from "../discovery/service.js";
import { visibleCreation } from "../discovery/visibility.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { notFound } from "../http/errors.js";
import { resolveImages } from "../storage/image-urls.js";
import type { MediaStorage } from "../storage/media-storage.js";

/** How many creations the profile page loads up front; more are available in discovery. */
export const PROFILE_CREATION_LIMIT = 24;

export interface PublicBusinessView {
  slug: string;
  businessName: string;
  description: string;
  /** Every category the business appears under: its own plus those of its live creations. */
  categories: { slug: string; name: string }[];
  /** @deprecated kept for existing clients: the business's own primary category. */
  category: { slug: string; name: string };
  county: string;
  city: string;
  websiteUrl: string | null;
  /** The seller's WhatsApp number in E.164 form; customers contact the seller directly. */
  whatsappNumber: string;
  logoUrl: string | null;
  images: { url: string }[];
  /** Live creations, newest first. */
  creations: CreationCard[];
  hasMoreCreations: boolean;
}

/**
 * Returns the approved profile of a live business. Anything else — drafts, pending, rejected,
 * changes requested, suspended, unknown — is reported as "not found" so nothing leaks.
 */
export async function getPublicBusiness(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  slug: string,
): Promise<PublicBusinessView> {
  const business = await prisma.business.findFirst({
    where: { slug, status: "APPROVED", publishedRevisionId: { not: null } },
    select: {
      id: true,
      slug: true,
      publishedRevision: {
        select: {
          businessName: true,
          description: true,
          county: true,
          city: true,
          websiteUrl: true,
          whatsappNumber: true,
          logoPath: true,
          category: { select: { slug: true, name: true } },
          images: { select: { path: true }, orderBy: { position: "asc" } },
        },
      },
    },
  });
  const revision = business?.publishedRevision;
  if (!business || !revision) throw notFound("Business not found");

  const [creationRows, creationCategories] = await Promise.all([
    prisma.creation.findMany({
      where: { businessId: business.id, ...visibleCreation },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: PROFILE_CREATION_LIMIT + 1,
      select: cardSelect,
    }),
    prisma.creationRevision.findMany({
      where: { publishedFor: { is: { businessId: business.id, ...visibleCreation } } },
      distinct: ["categoryId"],
      select: { category: { select: { slug: true, name: true } } },
    }),
  ]);

  const paths = [
    ...revision.images.map((i) => ({ path: i.path, width: 1, height: 1 })),
    ...(revision.logoPath ? [{ path: revision.logoPath, width: 1, height: 1 }] : []),
  ];
  const [urls, creations] = await Promise.all([
    resolveImages(storage, paths),
    toCards(storage, creationRows.slice(0, PROFILE_CREATION_LIMIT)),
  ]);

  const categories = new Map([[revision.category.slug, revision.category]]);
  for (const { category } of creationCategories) categories.set(category.slug, category);

  return {
    slug: business.slug,
    businessName: revision.businessName,
    description: revision.description,
    categories: [...categories.values()],
    category: revision.category,
    county: revision.county,
    city: revision.city,
    websiteUrl: revision.websiteUrl,
    whatsappNumber: revision.whatsappNumber,
    logoUrl: revision.logoPath ? (urls.get(revision.logoPath)?.url ?? null) : null,
    images: revision.images.flatMap((image) => {
      const url = urls.get(image.path)?.url;
      return url ? [{ url }] : [];
    }),
    creations,
    hasMoreCreations: creationRows.length > PROFILE_CREATION_LIMIT,
  };
}
