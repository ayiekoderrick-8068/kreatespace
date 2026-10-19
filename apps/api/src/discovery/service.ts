import type { CreationListQuery } from "@kreatespace/shared";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { notFound } from "../http/errors.js";
import { resolveImages, type ImageView } from "../storage/image-urls.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { visibleCreation, visibleFromSql, visibleWhereSql } from "./visibility.js";

export interface CreationCard {
  id: string;
  title: string;
  image: ImageView | null;
  category: { slug: string; name: string };
  occasion: { slug: string; name: string } | null;
  business: { slug: string; name: string; county: string; city: string };
  publishedAt: string | null;
}

export interface CreationPage {
  items: CreationCard[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export const cardSelect = {
  id: true,
  publishedAt: true,
  publishedRevision: {
    select: {
      title: true,
      category: { select: { slug: true, name: true } },
      occasion: { select: { slug: true, name: true } },
      images: {
        orderBy: { position: "asc" },
        take: 1,
        select: { path: true, width: true, height: true },
      },
    },
  },
  business: {
    select: {
      slug: true,
      publishedRevision: { select: { businessName: true, county: true, city: true } },
    },
  },
} satisfies Prisma.CreationSelect;

type CardRow = Prisma.CreationGetPayload<{ select: typeof cardSelect }>;

/** Turns database rows into cards, resolving all image URLs in one batch. */
export async function toCards(
  storage: MediaStorage | undefined,
  rows: CardRow[],
): Promise<CreationCard[]> {
  const refs = rows.flatMap((row) => row.publishedRevision?.images ?? []);
  const images = await resolveImages(storage, refs);

  return rows.flatMap((row) => {
    const revision = row.publishedRevision;
    const business = row.business.publishedRevision;
    if (!revision || !business) return [];
    const first = revision.images[0];
    return [
      {
        id: row.id,
        title: revision.title,
        image: first ? (images.get(first.path) ?? null) : null,
        category: revision.category,
        occasion: revision.occasion,
        business: {
          slug: row.business.slug,
          name: business.businessName,
          county: business.county,
          city: business.city,
        },
        publishedAt: row.publishedAt?.toISOString() ?? null,
      },
    ];
  });
}

/** Loads cards for the given ids, in that order, re-applying the visibility rule. */
async function cardsInOrder(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  ids: string[],
): Promise<CreationCard[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.creation.findMany({
    where: { id: { in: ids }, ...visibleCreation },
    select: cardSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return toCards(storage, ordered);
}

export async function listCreations(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  query: CreationListQuery,
): Promise<CreationPage> {
  const { page, pageSize } = query;
  const offset = (page - 1) * pageSize;

  // One extra row tells us whether another page exists without a COUNT over the whole catalogue.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    ${visibleFromSql}
    WHERE ${visibleWhereSql}
    ORDER BY c."publishedAt" DESC, c."id"
    LIMIT ${pageSize + 1} OFFSET ${offset}`;

  const hasMore = rows.length > pageSize;
  const ids = rows.slice(0, pageSize).map((row) => row.id);
  return { items: await cardsInOrder(prisma, storage, ids), page, pageSize, hasMore };
}

export interface CreationDetail {
  id: string;
  title: string;
  description: string;
  category: { slug: string; name: string };
  occasion: { slug: string; name: string } | null;
  images: ImageView[];
  publishedAt: string | null;
  business: {
    slug: string;
    name: string;
    county: string;
    city: string;
    logoUrl: string | null;
    websiteUrl: string | null;
    whatsappNumber: string;
  };
}

export async function getCreation(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  id: string,
): Promise<CreationDetail> {
  const creation = await prisma.creation.findFirst({
    where: { id, ...visibleCreation },
    select: {
      id: true,
      publishedAt: true,
      publishedRevision: {
        select: {
          title: true,
          description: true,
          category: { select: { slug: true, name: true } },
          occasion: { select: { slug: true, name: true } },
          images: {
            orderBy: { position: "asc" },
            select: { path: true, width: true, height: true },
          },
        },
      },
      business: {
        select: {
          slug: true,
          publishedRevision: {
            select: {
              businessName: true,
              county: true,
              city: true,
              logoPath: true,
              websiteUrl: true,
              whatsappNumber: true,
            },
          },
        },
      },
    },
  });
  const revision = creation?.publishedRevision;
  const business = creation?.business.publishedRevision;
  if (!creation || !revision || !business) throw notFound("Creation not found");

  const logoRef = business.logoPath ? [{ path: business.logoPath, width: 1, height: 1 }] : [];
  const resolved = await resolveImages(storage, [...revision.images, ...logoRef]);

  return {
    id: creation.id,
    title: revision.title,
    description: revision.description,
    category: revision.category,
    occasion: revision.occasion,
    images: revision.images.flatMap((image) => {
      const view = resolved.get(image.path);
      return view?.url ? [view] : [];
    }),
    publishedAt: creation.publishedAt?.toISOString() ?? null,
    business: {
      slug: creation.business.slug,
      name: business.businessName,
      county: business.county,
      city: business.city,
      logoUrl: business.logoPath ? (resolved.get(business.logoPath)?.url ?? null) : null,
      websiteUrl: business.websiteUrl,
      whatsappNumber: business.whatsappNumber,
    },
  };
}
