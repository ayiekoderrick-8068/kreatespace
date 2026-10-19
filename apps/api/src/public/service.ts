import type { PrismaClient } from "../generated/prisma/client.js";
import { notFound } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";

export interface PublicBusinessView {
  slug: string;
  businessName: string;
  description: string;
  category: { slug: string; name: string };
  county: string;
  city: string;
  websiteUrl: string | null;
  /** The seller's WhatsApp number in E.164 form; customers contact the seller directly. */
  whatsappNumber: string;
  logoUrl: string | null;
  images: { url: string }[];
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

  const paths = [
    ...revision.images.map((i) => i.path),
    ...(revision.logoPath ? [revision.logoPath] : []),
  ];
  const urls = storage ? await storage.createReadUrls(paths) : new Map<string, string>();

  return {
    slug: business.slug,
    businessName: revision.businessName,
    description: revision.description,
    category: revision.category,
    county: revision.county,
    city: revision.city,
    websiteUrl: revision.websiteUrl,
    whatsappNumber: revision.whatsappNumber,
    logoUrl: revision.logoPath ? (urls.get(revision.logoPath) ?? null) : null,
    images: revision.images.flatMap((image) => {
      const url = urls.get(image.path);
      return url ? [{ url }] : [];
    }),
  };
}
