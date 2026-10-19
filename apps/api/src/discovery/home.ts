import type { PrismaClient } from "../generated/prisma/client.js";
import { resolveImages, type ImageView } from "../storage/image-urls.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { cardSelect, listCreations, toCards, type CreationCard } from "./service.js";
import { visibleCreation, visibleFromSql, visibleWhereSql } from "./visibility.js";

export const HOME_RECENT_LIMIT = 12;
export const HOME_BUSINESS_LIMIT = 6;

export interface HomeCategory {
  slug: string;
  name: string;
  /** Number of live creations in the category. */
  count: number;
  /** The newest live creation's photo, or `null` when the category is still empty. */
  cover: ImageView | null;
}

export interface HomeBusiness {
  slug: string;
  name: string;
  county: string;
  city: string;
  categoryName: string;
  logoUrl: string | null;
  creationCount: number;
  previews: ImageView[];
}

export interface HomeData {
  categories: HomeCategory[];
  recent: CreationCard[];
  businesses: HomeBusiness[];
}

/** Everything the public homepage shows, computed from live approved records only. */
export async function getHomeData(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
): Promise<HomeData> {
  const [categoryRows, coverRows, businessRows, recent] = await Promise.all([
    prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    }),
    // Newest live creation per category, with the category's total.
    prisma.$queryRaw<{ slug: string; id: string; n: number }[]>`
      SELECT DISTINCT ON (cat."slug") cat."slug" AS slug, c."id" AS id,
             (count(*) OVER (PARTITION BY cat."slug"))::int AS n
      ${visibleFromSql}
      WHERE ${visibleWhereSql}
      ORDER BY cat."slug", c."publishedAt" DESC`,
    // Businesses with live creations, most recently active first.
    prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT b."id" AS id, count(*)::int AS n
      ${visibleFromSql}
      WHERE ${visibleWhereSql}
      GROUP BY b."id"
      ORDER BY max(c."publishedAt") DESC
      LIMIT ${HOME_BUSINESS_LIMIT}`,
    listCreations(prisma, storage, {
      page: 1,
      pageSize: HOME_RECENT_LIMIT,
    }),
  ]);

  const coverCards = await toCards(
    storage,
    coverRows.length
      ? await prisma.creation.findMany({
          where: { id: { in: coverRows.map((r) => r.id) }, ...visibleCreation },
          select: cardSelect,
        })
      : [],
  );
  const coverById = new Map(coverCards.map((card) => [card.id, card.image]));
  const coverBySlug = new Map(coverRows.map((r) => [r.slug, r]));

  const categories = categoryRows.map<HomeCategory>((category) => {
    const row = coverBySlug.get(category.slug);
    return {
      ...category,
      count: row?.n ?? 0,
      cover: row ? (coverById.get(row.id) ?? null) : null,
    };
  });

  const businesses = await hydrateBusinesses(prisma, storage, businessRows);
  return { categories, recent: recent.items, businesses };
}

async function hydrateBusinesses(
  prisma: PrismaClient,
  storage: MediaStorage | undefined,
  rows: { id: string; n: number }[],
): Promise<HomeBusiness[]> {
  if (rows.length === 0) return [];
  const businesses = await prisma.business.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: {
      id: true,
      slug: true,
      publishedRevision: {
        select: {
          businessName: true,
          county: true,
          city: true,
          logoPath: true,
          category: { select: { name: true } },
        },
      },
      creations: {
        where: visibleCreation,
        orderBy: { publishedAt: "desc" },
        take: 3,
        select: {
          publishedRevision: {
            select: {
              images: {
                orderBy: { position: "asc" },
                take: 1,
                select: { path: true, width: true, height: true },
              },
            },
          },
        },
      },
    },
  });
  const byId = new Map(businesses.map((b) => [b.id, b]));

  const refs = businesses.flatMap((b) => [
    ...b.creations.flatMap((c) => c.publishedRevision?.images ?? []),
    ...(b.publishedRevision?.logoPath
      ? [{ path: b.publishedRevision.logoPath, width: 1, height: 1 }]
      : []),
  ]);
  const images = await resolveImages(storage, refs);

  return rows.flatMap((row) => {
    const business = byId.get(row.id);
    const profile = business?.publishedRevision;
    if (!business || !profile) return [];
    return [
      {
        slug: business.slug,
        name: profile.businessName,
        county: profile.county,
        city: profile.city,
        categoryName: profile.category.name,
        logoUrl: profile.logoPath ? (images.get(profile.logoPath)?.url ?? null) : null,
        creationCount: row.n,
        previews: business.creations.flatMap((c) => {
          const first = c.publishedRevision?.images[0];
          const view = first ? images.get(first.path) : undefined;
          return view?.url ? [view] : [];
        }),
      },
    ];
  });
}
