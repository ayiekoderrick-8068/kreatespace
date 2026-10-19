import { buildBusiness, buildCreation } from "../../apps/api/src/dev/builders.ts";
import { disconnectPrisma, getPrisma } from "../../apps/api/src/lib/prisma.ts";
import { DATABASE_URL } from "./env.ts";

/** The records one discovery test needs, all carrying a unique tag so runs never collide. */
export interface Catalogue {
  tag: string;
  kisumuBakery: { name: string; slug: string; weddingCakeId: string; birthdayCakeId: string };
  nairobiMakeup: { name: string; bridalId: string };
  hidden: { pendingId: string; suspendedId: string };
}

export async function seedCatalogue(tag: string): Promise<Catalogue> {
  const prisma = getPrisma(DATABASE_URL);

  // Tests share one database and run one at a time. Starting from an empty catalogue keeps
  // rankings (such as related creations) independent of what earlier tests left behind.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "businesses" CASCADE');

  const bakeryName = `Bakery ${tag}`;
  const bakery = await buildBusiness(prisma, {
    name: bakeryName,
    slug: `bakery-${tag}`,
    county: "Kisumu",
    city: "Milimani",
    categorySlug: "cakes",
    websiteUrl: "https://example.com",
    description: "Celebration cakes baked to order in Kisumu.",
  });
  const wedding = await buildCreation(prisma, {
    businessId: bakery.businessId,
    title: `Wedding cake zq${tag}`,
    description: "A three-tier wedding cake with fresh flowers.",
    categorySlug: "cakes",
    occasionSlug: "wedding",
    images: [
      { path: "dev-fixtures/sample-1.svg", width: 800, height: 1000 },
      { path: "dev-fixtures/sample-7.svg", width: 800, height: 1000 },
    ],
  });
  const birthday = await buildCreation(prisma, {
    businessId: bakery.businessId,
    title: `Birthday cake zq${tag}`,
    categorySlug: "cakes",
    occasionSlug: "birthday",
    images: [{ path: "dev-fixtures/sample-2.svg", width: 800, height: 800 }],
  });

  const makeupName = `Glow ${tag}`;
  const makeup = await buildBusiness(prisma, {
    name: makeupName,
    slug: `glow-${tag}`,
    county: "Nairobi",
    city: "Westlands",
    categorySlug: "beauty",
  });
  const bridal = await buildCreation(prisma, {
    businessId: makeup.businessId,
    title: `Bridal makeup zq${tag}`,
    categorySlug: "beauty",
    occasionSlug: "wedding",
    images: [{ path: "dev-fixtures/sample-4.svg", width: 800, height: 1000 }],
  });

  // Content that must never be public, written to match the same search word.
  const pending = await buildCreation(prisma, {
    businessId: bakery.businessId,
    title: `Secret pending cake zq${tag}`,
    status: "PENDING",
  });
  const suspendedBusiness = await buildBusiness(prisma, {
    name: `Suspended ${tag}`,
    slug: `suspended-${tag}`,
    status: "SUSPENDED",
  });
  const suspended = await buildCreation(prisma, {
    businessId: suspendedBusiness.businessId,
    title: `Secret suspended cake zq${tag}`,
  });

  return {
    tag,
    kisumuBakery: {
      name: bakeryName,
      slug: bakery.slug,
      weddingCakeId: wedding.creationId,
      birthdayCakeId: birthday.creationId,
    },
    nairobiMakeup: { name: makeupName, bridalId: bridal.creationId },
    hidden: { pendingId: pending.creationId, suspendedId: suspended.creationId },
  };
}

export async function closeDatabase(): Promise<void> {
  await disconnectPrisma();
}
