import type { PrismaClient } from "../generated/prisma/client.js";
import { visibleBusiness, visibleCreation } from "../discovery/visibility.js";
import { notFound } from "../http/errors.js";
import { summarize, type SharePage, type SitemapEntry } from "./render.js";

export interface SeoUrls {
  /** Public address of the web app, with no trailing slash. */
  web: string;
  /** Public address of this API, used for preview images. Previews omit images without it. */
  api?: string;
}

const MAX_SITEMAP_ITEMS = 20_000;

/** Page details for a published creation. Anything not public looks like it doesn't exist. */
export async function getCreationSharePage(
  prisma: PrismaClient,
  urls: SeoUrls,
  id: string,
): Promise<SharePage> {
  const creation = await prisma.creation.findFirst({
    where: { id, ...visibleCreation },
    select: {
      id: true,
      publishedAt: true,
      publishedRevision: {
        select: {
          title: true,
          description: true,
          category: { select: { name: true } },
          occasion: { select: { name: true } },
          images: { orderBy: { position: "asc" }, take: 1, select: { id: true } },
        },
      },
      business: {
        select: {
          slug: true,
          publishedRevision: { select: { businessName: true, county: true, city: true } },
        },
      },
    },
  });
  const revision = creation?.publishedRevision;
  const business = creation?.business.publishedRevision;
  if (!creation || !revision || !business) throw notFound("Not found");

  const url = `${urls.web}/creations/${creation.id}`;
  const image =
    urls.api && revision.images.length > 0
      ? `${urls.api}/api/public/seo/image/creations/${creation.id}`
      : undefined;
  const description = summarize(
    `${revision.description} By ${business.businessName} in ${business.city}, ${business.county}.`,
  );

  return {
    title: `${revision.title} by ${business.businessName}`,
    description,
    url,
    image,
    type: "article",
    heading: revision.title,
    body: `${revision.description} Made by ${business.businessName}, ${business.city}, ${business.county}. Category: ${revision.category.name}${
      revision.occasion ? `. Occasion: ${revision.occasion.name}` : ""
    }.`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: revision.title,
      description: revision.description,
      url,
      ...(image ? { image } : {}),
      genre: revision.category.name,
      ...(creation.publishedAt ? { datePublished: creation.publishedAt.toISOString() } : {}),
      creator: {
        "@type": "Organization",
        name: business.businessName,
        url: `${urls.web}/businesses/${creation.business.slug}`,
      },
    },
  };
}

/** Page details for an approved business. */
export async function getBusinessSharePage(
  prisma: PrismaClient,
  urls: SeoUrls,
  slug: string,
): Promise<SharePage> {
  const business = await prisma.business.findFirst({
    where: { slug, ...visibleBusiness },
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
          category: { select: { name: true } },
        },
      },
    },
  });
  const profile = business?.publishedRevision;
  if (!business || !profile) throw notFound("Not found");

  // A stable preview image: the cover of the newest published creation, if there is one.
  const cover = urls.api
    ? await prisma.creation.findFirst({
        where: { businessId: business.id, ...visibleCreation },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          publishedRevision: { select: { images: { take: 1, select: { id: true } } } },
        },
      })
    : null;
  const image =
    cover && (cover.publishedRevision?.images.length ?? 0) > 0
      ? `${urls.api}/api/public/seo/image/creations/${cover.id}`
      : undefined;

  const url = `${urls.web}/businesses/${business.slug}`;
  return {
    title: `${profile.businessName} — ${profile.category.name} in ${profile.city}`,
    description: summarize(`${profile.description} ${profile.city}, ${profile.county}.`),
    url,
    image,
    type: "profile",
    heading: profile.businessName,
    body: `${profile.description} ${profile.category.name} in ${profile.city}, ${profile.county}.`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: profile.businessName,
      description: profile.description,
      url,
      ...(image ? { image } : {}),
      address: {
        "@type": "PostalAddress",
        addressLocality: profile.city,
        addressRegion: profile.county,
        addressCountry: "KE",
      },
      ...(profile.websiteUrl ? { sameAs: [profile.websiteUrl] } : {}),
    },
  };
}

/** The address of a creation's cover image in storage, only while the creation is public. */
export async function getPublicCoverPath(prisma: PrismaClient, id: string): Promise<string> {
  const creation = await prisma.creation.findFirst({
    where: { id, ...visibleCreation },
    select: {
      publishedRevision: {
        select: { images: { orderBy: { position: "asc" }, take: 1, select: { path: true } } },
      },
    },
  });
  const path = creation?.publishedRevision?.images[0]?.path;
  if (!path) throw notFound("Not found");
  return path;
}

const STATIC_PAGES: {
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
}[] = [
  { path: "/", changefreq: "daily", priority: 1 },
  { path: "/explore", changefreq: "daily", priority: 0.9 },
  { path: "/for-businesses", changefreq: "monthly", priority: 0.5 },
  { path: "/about", changefreq: "monthly", priority: 0.4 },
];

/** Everything public and nothing else: the same visibility rules as the site itself. */
export async function listSitemapEntries(
  prisma: PrismaClient,
  urls: SeoUrls,
): Promise<SitemapEntry[]> {
  const [businesses, creations] = await Promise.all([
    prisma.business.findMany({
      where: visibleBusiness,
      orderBy: { updatedAt: "desc" },
      take: MAX_SITEMAP_ITEMS,
      select: { slug: true, updatedAt: true },
    }),
    prisma.creation.findMany({
      where: visibleCreation,
      orderBy: { publishedAt: "desc" },
      take: MAX_SITEMAP_ITEMS,
      select: { id: true, updatedAt: true },
    }),
  ]);
  return [
    ...STATIC_PAGES.map((page) => ({
      loc: `${urls.web}${page.path === "/" ? "" : page.path}` || urls.web,
      changefreq: page.changefreq,
      priority: page.priority,
    })),
    ...businesses.map((b) => ({
      loc: `${urls.web}/businesses/${b.slug}`,
      lastmod: b.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.7,
    })),
    ...creations.map((c) => ({
      loc: `${urls.web}/creations/${c.id}`,
      lastmod: c.updatedAt,
      changefreq: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
