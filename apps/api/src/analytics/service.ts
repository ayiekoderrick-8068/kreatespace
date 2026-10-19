import type { AnalyticsDay, AnalyticsTotals } from "@kreatespace/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { requireApprovedBusiness } from "../portfolio/service.js";

/** Visitors are in Kenya, so "a day" means a Nairobi calendar day. */
const TIME_ZONE = "Africa/Nairobi";

/**
 * The Nairobi calendar day of a timestamp column. Prisma stores times as UTC without a zone, so
 * the value is first declared as UTC and then converted. `column` is always a literal below.
 */
const QUOTED_COLUMN = { createdAt: '"createdAt"', "e.createdAt": 'e."createdAt"' } as const;
const localDay = (column: keyof typeof QUOTED_COLUMN) =>
  Prisma.raw(`((${QUOTED_COLUMN[column]} AT TIME ZONE 'UTC') AT TIME ZONE '${TIME_ZONE}')::date`);

type EventType = "CREATION_VIEW" | "BUSINESS_VIEW" | "WHATSAPP_CLICK" | "WEBSITE_CLICK";

const emptyTotals = (): AnalyticsTotals => ({
  creationViews: 0,
  businessViews: 0,
  whatsappClicks: 0,
  websiteClicks: 0,
});

function addTo(totals: AnalyticsTotals, type: EventType, count: number): void {
  if (type === "CREATION_VIEW") totals.creationViews += count;
  if (type === "BUSINESS_VIEW") totals.businessViews += count;
  if (type === "WHATSAPP_CLICK") totals.whatsappClicks += count;
  if (type === "WEBSITE_CLICK") totals.websiteClicks += count;
}

const dayKey = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);

/** One entry per calendar day ending today, so quiet days show as zero rather than disappearing. */
function emptySeries(days: number, now: Date): AnalyticsDay[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dayKey(new Date(now.getTime() - (days - 1 - index) * 86_400_000)),
    ...emptyTotals(),
  }));
}

export interface BusinessAnalytics {
  days: number;
  /** Start of the window, as a Nairobi calendar day. */
  from: string;
  totals: AnalyticsTotals;
  series: AnalyticsDay[];
  topCreations: {
    creationId: string;
    title: string;
    views: number;
    whatsappClicks: number;
    websiteClicks: number;
  }[];
  /** Whether any event at all was recorded in the window (so the page can explain an empty state). */
  hasData: boolean;
}

/**
 * Analytics for the signed-in seller's own business. Counts are of page views and link
 * clicks only; a WhatsApp click means the link was opened, not that a message was sent.
 */
export async function getBusinessAnalytics(
  prisma: PrismaClient,
  input: { userId: string; days: number; now?: Date },
): Promise<BusinessAnalytics> {
  const business = await requireApprovedBusiness(prisma, input.userId);
  const now = input.now ?? new Date();
  const series = emptySeries(input.days, now);
  const from = series[0]!.date;

  // Window starts at the beginning of the first Nairobi day, expressed in UTC.
  const rows = await prisma.$queryRaw<{ day: string; type: EventType; n: number }[]>(Prisma.sql`
    SELECT to_char(${localDay("createdAt")}, 'YYYY-MM-DD') AS day,
           type::text AS type,
           count(*)::int AS n
    FROM inquiry_events
    WHERE "businessId" = ${business.id}::uuid
      AND ${localDay("createdAt")} >= ${from}::date
    GROUP BY 1, 2
  `);

  const totals = emptyTotals();
  const byDay = new Map(series.map((entry) => [entry.date, entry]));
  for (const row of rows) {
    addTo(totals, row.type, row.n);
    const entry = byDay.get(row.day);
    if (entry) addTo(entry, row.type, row.n);
  }

  const perCreation = await prisma.$queryRaw<{ creation_id: string; type: EventType; n: number }[]>(
    Prisma.sql`
      SELECT e."creationId"::text AS creation_id, e.type::text AS type, count(*)::int AS n
      FROM inquiry_events e
      JOIN creations c ON c.id = e."creationId" AND c."businessId" = e."businessId"
      WHERE e."businessId" = ${business.id}::uuid
        AND ${localDay("e.createdAt")} >= ${from}::date
      GROUP BY 1, 2
    `,
  );
  const grouped = new Map<
    string,
    { views: number; whatsappClicks: number; websiteClicks: number }
  >();
  for (const row of perCreation) {
    const entry = grouped.get(row.creation_id) ?? { views: 0, whatsappClicks: 0, websiteClicks: 0 };
    if (row.type === "CREATION_VIEW") entry.views += row.n;
    if (row.type === "WHATSAPP_CLICK") entry.whatsappClicks += row.n;
    if (row.type === "WEBSITE_CLICK") entry.websiteClicks += row.n;
    grouped.set(row.creation_id, entry);
  }

  const ranked = [...grouped.entries()]
    .sort(
      ([, a], [, b]) =>
        b.whatsappClicks - a.whatsappClicks ||
        b.views - a.views ||
        b.websiteClicks - a.websiteClicks,
    )
    .slice(0, 10);
  const titles = await prisma.creation.findMany({
    where: { id: { in: ranked.map(([id]) => id) }, businessId: business.id },
    select: {
      id: true,
      publishedRevision: { select: { title: true } },
      revisions: { orderBy: { version: "desc" }, take: 1, select: { title: true } },
    },
  });
  const titleOf = new Map(
    titles.map((row) => [row.id, row.publishedRevision?.title ?? row.revisions[0]?.title ?? ""]),
  );

  return {
    days: input.days,
    from,
    totals,
    series,
    topCreations: ranked.map(([creationId, counts]) => ({
      creationId,
      title: titleOf.get(creationId) ?? "Untitled creation",
      ...counts,
    })),
    hasData: rows.length > 0,
  };
}

export interface PlatformAnalytics {
  days: number;
  from: string;
  totals: AnalyticsTotals;
  series: AnalyticsDay[];
  businesses: Record<string, number>;
  creations: Record<string, number>;
  users: Record<string, number>;
  /** Work waiting for an administrator. */
  queues: {
    businessesPending: number;
    creationsPending: number;
    packagesPending: number;
    websiteRequestsNew: number;
  };
  topBusinesses: {
    businessId: string;
    name: string;
    slug: string;
    views: number;
    whatsappClicks: number;
    websiteClicks: number;
  }[];
}

async function countByStatus(rows: { status: string; _count: { _all: number } }[]) {
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/** Platform-wide figures for administrators. */
export async function getPlatformAnalytics(
  prisma: PrismaClient,
  input: { days: number; now?: Date },
): Promise<PlatformAnalytics> {
  const now = input.now ?? new Date();
  const series = emptySeries(input.days, now);
  const from = series[0]!.date;

  const [
    days,
    perBusiness,
    businesses,
    creations,
    users,
    businessesPending,
    creationsPending,
    packagesPending,
    websiteRequestsNew,
  ] = await Promise.all([
    prisma.$queryRaw<{ day: string; type: EventType; n: number }[]>(Prisma.sql`
        SELECT to_char(${localDay("createdAt")}, 'YYYY-MM-DD') AS day,
               type::text AS type, count(*)::int AS n
        FROM inquiry_events
        WHERE ${localDay("createdAt")} >= ${from}::date
        GROUP BY 1, 2
      `),
    prisma.$queryRaw<{ business_id: string; type: EventType; n: number }[]>(Prisma.sql`
        SELECT "businessId"::text AS business_id, type::text AS type, count(*)::int AS n
        FROM inquiry_events
        WHERE ${localDay("createdAt")} >= ${from}::date
        GROUP BY 1, 2
      `),
    prisma.business.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.creation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.business.count({ where: { status: "PENDING" } }),
    prisma.creation.count({ where: { status: "PENDING" } }),
    prisma.servicePackage.count({ where: { reviewState: "PENDING", status: "ACTIVE" } }),
    prisma.websiteRequest.count({ where: { status: "NEW" } }),
  ]);

  const totals = emptyTotals();
  const byDay = new Map(series.map((entry) => [entry.date, entry]));
  for (const row of days) {
    addTo(totals, row.type, row.n);
    const entry = byDay.get(row.day);
    if (entry) addTo(entry, row.type, row.n);
  }

  const grouped = new Map<
    string,
    { views: number; whatsappClicks: number; websiteClicks: number }
  >();
  for (const row of perBusiness) {
    const entry = grouped.get(row.business_id) ?? { views: 0, whatsappClicks: 0, websiteClicks: 0 };
    if (row.type === "CREATION_VIEW" || row.type === "BUSINESS_VIEW") entry.views += row.n;
    if (row.type === "WHATSAPP_CLICK") entry.whatsappClicks += row.n;
    if (row.type === "WEBSITE_CLICK") entry.websiteClicks += row.n;
    grouped.set(row.business_id, entry);
  }
  const ranked = [...grouped.entries()]
    .sort(([, a], [, b]) => b.whatsappClicks - a.whatsappClicks || b.views - a.views)
    .slice(0, 10);
  const names = await prisma.business.findMany({
    where: { id: { in: ranked.map(([id]) => id) } },
    select: {
      id: true,
      slug: true,
      revisions: { orderBy: { version: "desc" }, take: 1, select: { businessName: true } },
      publishedRevision: { select: { businessName: true } },
    },
  });
  const infoOf = new Map(
    names.map((row) => [
      row.id,
      {
        slug: row.slug,
        name: row.publishedRevision?.businessName ?? row.revisions[0]?.businessName ?? row.slug,
      },
    ]),
  );

  return {
    days: input.days,
    from,
    totals,
    series,
    businesses: await countByStatus(businesses),
    creations: await countByStatus(creations),
    users: Object.fromEntries(users.map((row) => [row.role, row._count._all])),
    queues: { businessesPending, creationsPending, packagesPending, websiteRequestsNew },
    topBusinesses: ranked.flatMap(([businessId, counts]) => {
      const info = infoOf.get(businessId);
      return info ? [{ businessId, name: info.name, slug: info.slug, ...counts }] : [];
    }),
  };
}
