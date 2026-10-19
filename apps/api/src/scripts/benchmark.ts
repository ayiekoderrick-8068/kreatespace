import "dotenv/config";
import { performance } from "node:perf_hooks";
import { getBusinessAnalytics } from "../analytics/service.js";
import { getHomeData } from "../discovery/home.js";
import { getCreation, listCities, listCreations, listRelated } from "../discovery/service.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";
import { getPublicBusiness } from "../public/service.js";
import { listSitemapEntries } from "../seo/service.js";

// Measures the public query paths against a synthetic catalogue.
//
//   BENCHMARK_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kreatespace_bench \
//   pnpm --filter @kreatespace/api benchmark [businesses] [events]
//
// The database must already have the migrations applied. THIS SCRIPT ERASES ALL USERS AND
// BUSINESSES IN THE DATABASE IT IS GIVEN, so it refuses anything that is not on this machine.
const url = process.env.BENCHMARK_DATABASE_URL;
if (
  !url ||
  !/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(url) ||
  process.env.NODE_ENV === "production"
) {
  console.error(
    "Set BENCHMARK_DATABASE_URL to a database on localhost (it will be erased). Refusing to run.",
  );
  process.exit(2);
}

const integer = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : fallback;
};
const BUSINESSES = integer(process.argv[2], 250); // 20 creations each
const EVENTS = integer(process.argv[3], 100_000);

const prisma = getPrisma(url);

async function seed() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, email, "fullName", role, "updatedAt")
    SELECT gen_random_uuid(), 'bench-' || g || '@example.test', 'Bench ' || g, 'SELLER', now()
    FROM generate_series(1, ${BUSINESSES}) g`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO businesses (id, "ownerId", slug, status, "updatedAt")
    SELECT gen_random_uuid(), u.id, 'bench-biz-' || n, 'DRAFT', now()
    FROM (SELECT id, row_number() OVER (ORDER BY email) AS n FROM users) u`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO business_revisions (id, "businessId", version, status, "businessName", "ownerName", description,
      "categoryId", county, city, "whatsappNumber", "updatedAt")
    SELECT gen_random_uuid(), b.id, 1, 'APPROVED', 'Bench Business ' || b.slug, 'Owner',
      'A bench business making handmade work to order in Kenya.',
      (SELECT id FROM categories ORDER BY slug OFFSET (abs(hashtext(b.slug)) % 8) LIMIT 1),
      (ARRAY['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Kiambu'])[1 + abs(hashtext(b.slug)) % 6],
      (ARRAY['Westlands','Nyali','Milimani','Section 58','Elgon View','Thika Road'])[1 + abs(hashtext(b.slug)) % 6],
      '+254712345678', now()
    FROM businesses b`);
  await prisma.$executeRawUnsafe(`
    UPDATE businesses b SET status = 'APPROVED',
      "publishedRevisionId" = (SELECT id FROM business_revisions r WHERE r."businessId" = b.id)`);

  // In batches: the database enforces the 20-creation limit with a lock per business, and one
  // enormous statement would exhaust the server's lock table.
  for (let offset = 0; offset < BUSINESSES; offset += 50) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO creations (id, "businessId", status, "publishedAt", "updatedAt")
      SELECT gen_random_uuid(), b.id, 'DRAFT', now() - (random() * interval '90 days'), now()
      FROM (SELECT id FROM businesses ORDER BY slug OFFSET ${offset} LIMIT 50) b
      CROSS JOIN generate_series(1, 20) g`);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO creation_revisions (id, "creationId", version, status, title, description, "categoryId", "occasionId", "updatedAt")
    SELECT gen_random_uuid(), c.id, 1, 'APPROVED',
      (ARRAY['Floral','Rustic','Elegant','Handmade','Bold','Classic','Modern','Vintage'])[1 + abs(hashtext(c.id::text)) % 8]
        || ' ' || (ARRAY['wedding cake','birthday cake','bridal makeup','kitenge dress','photo shoot','event decor','beaded necklace','tote bag'])[1 + abs(hashtext(c.id::text || 'x')) % 8]
        || ' ' || (abs(hashtext(c.id::text)) % 1000),
      'Made to order with care. ' || (ARRAY['Fresh flowers and buttercream','Hand stitched with bright fabric','Natural light portraits','Colourful beads from Kajiado'])[1 + abs(hashtext(c.id::text || 'y')) % 4] || ' for your special day in Kenya.',
      (SELECT id FROM categories ORDER BY slug OFFSET (abs(hashtext(c.id::text)) % 8) LIMIT 1),
      (SELECT id FROM occasions ORDER BY slug OFFSET (abs(hashtext(c.id::text || 'z')) % 9) LIMIT 1),
      now()
    FROM creations c`);
  // The photo limit is enforced with a lock per creation, so this is batched too.
  for (let offset = 0; offset < BUSINESSES * 20; offset += 1000) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO creation_images (id, "revisionId", path, position, width, height)
      SELECT gen_random_uuid(), r.id, 'bench/' || r.id || '-' || p || '.jpg', p, 800, 1000
      FROM (SELECT id FROM creation_revisions ORDER BY id OFFSET ${offset} LIMIT 1000) r
      CROSS JOIN generate_series(0, 2) p`);
  }
  await prisma.$executeRawUnsafe(`
    UPDATE creations c SET status = 'APPROVED',
      "publishedRevisionId" = (SELECT id FROM creation_revisions r WHERE r."creationId" = c.id)`);

  await prisma.$executeRawUnsafe(`
    INSERT INTO inquiry_events (id, type, "businessId", "creationId", "createdAt")
    SELECT gen_random_uuid(),
      (ARRAY['CREATION_VIEW','CREATION_VIEW','CREATION_VIEW','BUSINESS_VIEW','WHATSAPP_CLICK','WEBSITE_CLICK'])[1 + (g % 6)]::"InquiryEventType",
      c."businessId", c.id, now() - (random() * interval '90 days')
    FROM generate_series(1, ${EVENTS}) g
    JOIN LATERAL (SELECT id, "businessId" FROM creations OFFSET (g * 7919) % ${BUSINESSES * 20} LIMIT 1) c ON true`);
  await prisma.$executeRawUnsafe("ANALYZE");
}

async function measure(name: string, run: () => Promise<unknown>, runs = 25) {
  for (let i = 0; i < 3; i++) await run(); // warm up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const at = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  return { name, median: at(0.5), p95: at(0.95), max: times[times.length - 1]! };
}

async function main() {
  console.log(
    `Seeding ${BUSINESSES} businesses, ${BUSINESSES * 20} creations, ${EVENTS} events...`,
  );
  const t0 = performance.now();
  await seed();
  console.log(`Seeded in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

  const sample = await prisma.creation.findFirstOrThrow({
    select: { id: true, business: { select: { id: true, slug: true, ownerId: true } } },
  });
  const base = { page: 1, pageSize: 24 };
  const results = [
    await measure("Feed, first page", () => listCreations(prisma, undefined, base)),
    await measure("Feed, page 50 (deep)", () =>
      listCreations(prisma, undefined, { ...base, page: 50 }),
    ),
    await measure("Search: whole word (cake)", () =>
      listCreations(prisma, undefined, { ...base, q: "cake" }),
    ),
    await measure("Search: partial typing (wed)", () =>
      listCreations(prisma, undefined, { ...base, q: "wed" }),
    ),
    await measure("Search: nothing matches", () =>
      listCreations(prisma, undefined, { ...base, q: "submarine" }),
    ),
    await measure("Filters: category + county", () =>
      listCreations(prisma, undefined, { ...base, category: "cakes", county: "Nairobi" }),
    ),
    await measure("Cities for a county", () => listCities(prisma, "Nairobi")),
    await measure("Home page data", () => getHomeData(prisma, undefined)),
    await measure("Creation page", () => getCreation(prisma, undefined, sample.id)),
    await measure("Related creations", () => listRelated(prisma, undefined, sample.id)),
    await measure("Business page", () =>
      getPublicBusiness(prisma, undefined, sample.business.slug),
    ),
    await measure("Sitemap", () => listSitemapEntries(prisma, { web: "https://example.test" }), 8),
    await measure("Seller analytics (90 days)", () =>
      getBusinessAnalytics(prisma, { userId: sample.business.ownerId, days: 90 }),
    ),
  ];

  console.log(
    `| Query (${BUSINESSES * 20} creations, ${EVENTS} events) | median ms | 95th percentile ms | slowest ms |`,
  );
  console.log("| --- | ---: | ---: | ---: |");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.median.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.max.toFixed(1)} |`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
