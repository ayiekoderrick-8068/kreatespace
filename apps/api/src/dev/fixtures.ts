import type { PrismaClient } from "../generated/prisma/client.js";
import { buildBusiness, buildCreation } from "./builders.js";

// DEVELOPMENT FIXTURES — NOT REAL BUSINESSES.
// These records exist only so the discovery pages have something to show while sellers are not
// yet able to publish their own creations. Every name carries "Dev Fixture", every description
// says so, and every image is a labelled placeholder. They never run in production.

export const FIXTURE_SLUG_PREFIX = "dev-fixture-";

const image = (n: number, width: number, height: number) => ({
  path: `dev-fixtures/sample-${n}.svg`,
  width,
  height,
});

interface FixtureCreation {
  title: string;
  categorySlug: string;
  occasionSlug?: string;
  images: ReturnType<typeof image>[];
}

interface FixtureBusiness {
  slug: string;
  name: string;
  county: string;
  city: string;
  categorySlug: string;
  creations: FixtureCreation[];
}

const FIXTURES: FixtureBusiness[] = [
  {
    slug: `${FIXTURE_SLUG_PREFIX}cake-studio`,
    name: "Dev Fixture · Cake Studio",
    county: "Kisumu",
    city: "Milimani",
    categorySlug: "cakes",
    creations: [
      {
        title: "Sample floral birthday cake",
        categorySlug: "cakes",
        occasionSlug: "birthday",
        images: [image(1, 800, 1000), image(7, 800, 1000)],
      },
      {
        title: "Sample tiered wedding cake",
        categorySlug: "cakes",
        occasionSlug: "wedding",
        images: [image(1, 800, 1000)],
      },
      {
        title: "Sample graduation cake",
        categorySlug: "cakes",
        occasionSlug: "graduation",
        images: [image(7, 800, 1000)],
      },
      {
        title: "Sample baby shower cupcakes",
        categorySlug: "cakes",
        occasionSlug: "baby-shower",
        images: [image(2, 800, 800)],
      },
    ],
  },
  {
    slug: `${FIXTURE_SLUG_PREFIX}glam-lounge`,
    name: "Dev Fixture · Glam Lounge",
    county: "Nairobi",
    city: "Westlands",
    categorySlug: "beauty",
    creations: [
      {
        title: "Sample bridal makeup look",
        categorySlug: "beauty",
        occasionSlug: "bridal",
        images: [image(4, 800, 1000), image(8, 1000, 800)],
      },
      {
        title: "Sample soft glam for a party",
        categorySlug: "beauty",
        occasionSlug: "birthday",
        images: [image(4, 800, 1000)],
      },
      {
        title: "Sample natural everyday makeup",
        categorySlug: "beauty",
        occasionSlug: "everyday",
        images: [image(8, 1000, 800)],
      },
      {
        title: "Sample graduation outfit",
        categorySlug: "fashion",
        occasionSlug: "graduation",
        images: [image(2, 800, 800)],
      },
    ],
  },
  {
    slug: `${FIXTURE_SLUG_PREFIX}lens-works`,
    name: "Dev Fixture · Lens Works",
    county: "Mombasa",
    city: "Nyali",
    categorySlug: "photography",
    creations: [
      {
        title: "Sample wedding photography",
        categorySlug: "photography",
        occasionSlug: "wedding",
        images: [image(3, 1000, 800), image(8, 1000, 800)],
      },
      {
        title: "Sample family portrait session",
        categorySlug: "photography",
        occasionSlug: "everyday",
        images: [image(8, 1000, 800)],
      },
      {
        title: "Sample graduation portraits",
        categorySlug: "photography",
        occasionSlug: "graduation",
        images: [image(3, 1000, 800)],
      },
      {
        title: "Sample corporate event coverage",
        categorySlug: "photography",
        occasionSlug: "corporate",
        images: [image(3, 1000, 800)],
      },
    ],
  },
  {
    slug: `${FIXTURE_SLUG_PREFIX}bloom-and-decor`,
    name: "Dev Fixture · Bloom & Decor",
    county: "Nakuru",
    city: "Nakuru",
    categorySlug: "event-decor",
    creations: [
      {
        title: "Sample wedding arch with flowers",
        categorySlug: "event-decor",
        occasionSlug: "wedding",
        images: [image(5, 800, 900), image(6, 800, 800)],
      },
      {
        title: "Sample birthday balloon backdrop",
        categorySlug: "event-decor",
        occasionSlug: "birthday",
        images: [image(5, 800, 900)],
      },
      {
        title: "Sample hand-tied bouquet",
        categorySlug: "flowers",
        occasionSlug: "anniversary",
        images: [image(6, 800, 800)],
      },
      {
        title: "Sample personalised gift box",
        categorySlug: "creative-gifts",
        occasionSlug: "valentines",
        images: [image(7, 800, 1000)],
      },
    ],
  },
];

export interface SeedResult {
  businesses: number;
  creations: number;
  skipped: number;
}

/** Inserts the development fixtures. Safe to run repeatedly: existing fixtures are left alone. */
export async function seedDevFixtures(prisma: PrismaClient): Promise<SeedResult> {
  const result: SeedResult = { businesses: 0, creations: 0, skipped: 0 };
  let tick = 0;

  for (const fixture of FIXTURES) {
    if (await prisma.business.findUnique({ where: { slug: fixture.slug } })) {
      result.skipped += 1;
      continue;
    }
    const { businessId } = await buildBusiness(prisma, {
      name: fixture.name,
      slug: fixture.slug,
      county: fixture.county,
      city: fixture.city,
      categorySlug: fixture.categorySlug,
      description: `${fixture.name} is a development fixture, not a real business. It exists only to show how KreateSpace looks with content.`,
    });
    result.businesses += 1;

    for (const creation of fixture.creations) {
      tick += 1;
      await buildCreation(prisma, {
        businessId,
        title: creation.title,
        description: `Development fixture: a placeholder entry for "${creation.title}". It is not a real product.`,
        categorySlug: creation.categorySlug,
        occasionSlug: creation.occasionSlug,
        images: creation.images,
        // Spread publish times so the feed has a realistic newest-first order.
        publishedAt: new Date(Date.now() - tick * 3_600_000),
      });
      result.creations += 1;
    }
  }
  return result;
}

/** Removes everything `seedDevFixtures` created. */
export async function removeDevFixtures(prisma: PrismaClient): Promise<number> {
  const businesses = await prisma.business.findMany({
    where: { slug: { startsWith: FIXTURE_SLUG_PREFIX } },
    select: { id: true, ownerId: true },
  });
  // Deleting the owner removes the business and its creations, revisions and images.
  await prisma.business.deleteMany({ where: { id: { in: businesses.map((b) => b.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: businesses.map((b) => b.ownerId) } } });
  return businesses.length;
}
