import type { CreationListQuery } from "@kreatespace/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
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

/** What a customer's text is matched against: the creation, its business, category and occasion. */
const searchDocumentSql = Prisma.sql`to_tsvector('english',
  cr."title" || ' ' || cr."description" || ' ' || br."businessName" || ' ' || cat."name" || ' ' || coalesce(o."name", ''))`;

/** Escapes LIKE wildcards so what people type is matched literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Builds the optional filter conditions. Values are always bound as parameters, never
 * concatenated into the SQL text.
 */
function filterSql(query: CreationListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.category) conditions.push(Prisma.sql`cat."slug" = ${query.category}`);
  if (query.occasion) conditions.push(Prisma.sql`o."slug" = ${query.occasion}`);
  if (query.county) conditions.push(Prisma.sql`br."county" = ${query.county}`);
  if (query.city) conditions.push(Prisma.sql`lower(br."city") = lower(${query.city})`);
  if (query.q) {
    // Whole-word matches (with stemming: "cakes" finds "cake") plus partial matches on the
    // title and business name, so results appear while the customer is still typing.
    const pattern = likePattern(query.q);
    conditions.push(Prisma.sql`(
      ${searchDocumentSql} @@ websearch_to_tsquery('english', ${query.q})
      OR cr."title" ILIKE ${pattern} ESCAPE '\\'
      OR br."businessName" ILIKE ${pattern} ESCAPE '\\')`);
  }
  return conditions.length > 0 ? Prisma.sql`AND ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

export async function listCreations(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  query: CreationListQuery,
): Promise<CreationPage> {
  const { page, pageSize } = query;
  const offset = (page - 1) * pageSize;

  const orderBy = query.q
    ? Prisma.sql`ts_rank(${searchDocumentSql}, websearch_to_tsquery('english', ${query.q})) DESC,
        c."publishedAt" DESC, c."id"`
    : Prisma.sql`c."publishedAt" DESC, c."id"`;

  // One extra row tells us whether another page exists without a COUNT over the whole catalogue.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    ${visibleFromSql}
    WHERE ${visibleWhereSql} ${filterSql(query)}
    ORDER BY ${orderBy}
    LIMIT ${pageSize + 1} OFFSET ${offset}`;

  const hasMore = rows.length > pageSize;
  const ids = rows.slice(0, pageSize).map((row) => row.id);
  return { items: await cardsInOrder(prisma, storage, ids), page, pageSize, hasMore };
}

/** Counties and cities where approved businesses with live creations are based. */
export async function listCities(prisma: PrismaClient, county: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ city: string }[]>`
    SELECT DISTINCT br."city"
    ${visibleFromSql}
    WHERE ${visibleWhereSql} AND br."county" = ${county}
    ORDER BY br."city"`;
  return rows.map((row) => row.city);
}

export async function listFilters(prisma: PrismaClient) {
  const [categories, occasions] = await Promise.all([
    prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    }),
    prisma.occasion.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    }),
  ]);
  return { categories, occasions };
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

export const RELATED_LIMIT = 8;

/**
 * Other live creations a customer may like. A creation qualifies when it shares the category
 * (strongest) or the occasion; sharing the county only nudges the ordering. No ML involved.
 */
export async function listRelated(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  id: string,
  limit = RELATED_LIMIT,
): Promise<CreationCard[]> {
  const base = await prisma.creation.findFirst({
    where: { id, ...visibleCreation },
    select: {
      publishedRevision: { select: { categoryId: true, occasionId: true } },
      business: { select: { publishedRevision: { select: { county: true } } } },
    },
  });
  const revision = base?.publishedRevision;
  const county = base?.business.publishedRevision?.county;
  if (!base || !revision || !county) throw notFound("Creation not found");

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id" FROM (
      SELECT c."id", c."publishedAt",
        (CASE WHEN cr."categoryId" = ${revision.categoryId}::uuid THEN 3 ELSE 0 END
         + CASE WHEN ${revision.occasionId}::uuid IS NOT NULL
                     AND cr."occasionId" = ${revision.occasionId}::uuid THEN 2 ELSE 0 END
         + CASE WHEN br."county" = ${county} THEN 1 ELSE 0 END) AS score
      ${visibleFromSql}
      WHERE ${visibleWhereSql} AND c."id" <> ${id}::uuid
    ) t
    WHERE t.score >= 2
    ORDER BY t.score DESC, t."publishedAt" DESC, t."id"
    LIMIT ${limit}`;

  return cardsInOrder(
    prisma,
    storage,
    rows.map((row) => row.id),
  );
}
