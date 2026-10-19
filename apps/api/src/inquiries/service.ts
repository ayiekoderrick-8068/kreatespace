import type { InquiryEventInput, InquiryEventType } from "@kreatespace/shared";
import { visibleBusiness, visibleCreation } from "../discovery/visibility.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { notFound } from "../http/errors.js";

/**
 * Records one analytics event for a public business or creation. Targets must be live: events
 * about unapproved, suspended or unknown content are refused, so nothing private is revealed
 * or counted. Nothing about the visitor is stored.
 */
export async function recordInquiryEvent(
  prisma: PrismaClient,
  event: InquiryEventInput,
): Promise<void> {
  let businessId: string | undefined;
  let creationId: string | undefined;
  let packageId: string | undefined;

  if (event.creationId) {
    const creation = await prisma.creation.findFirst({
      where: { id: event.creationId, ...visibleCreation },
      select: { id: true, businessId: true, business: { select: { slug: true } } },
    });
    if (!creation) throw notFound("Not found");
    if (event.businessSlug && event.businessSlug !== creation.business.slug) {
      throw notFound("Not found");
    }
    creationId = creation.id;
    businessId = creation.businessId;
  } else if (event.businessSlug) {
    const business = await prisma.business.findFirst({
      where: { slug: event.businessSlug, ...visibleBusiness },
      select: { id: true },
    });
    if (!business) throw notFound("Not found");
    businessId = business.id;
  }
  if (!businessId) throw notFound("Not found");

  if (event.packageId) {
    const pkg = await prisma.servicePackage.findFirst({
      where: { id: event.packageId, businessId, status: "ACTIVE", publishedAt: { not: null } },
      select: { id: true },
    });
    if (!pkg) throw notFound("Not found");
    packageId = pkg.id;
  }

  await prisma.inquiryEvent.create({
    data: { type: event.type, businessId, creationId, packageId, source: event.source ?? null },
  });
}

export interface InquirySummary {
  since: Date;
  totals: Record<InquiryEventType, number>;
  /** Creations ranked by WhatsApp link clicks, then views. */
  creations: { creationId: string; views: number; whatsappClicks: number; websiteClicks: number }[];
}

/**
 * Counts for a business's analytics dashboard (built in a later milestone). Counts are of
 * views and link clicks; they say nothing about whether a conversation actually happened.
 */
export async function getInquirySummary(
  prisma: PrismaClient,
  input: { businessId: string; since: Date },
): Promise<InquirySummary> {
  const grouped = await prisma.inquiryEvent.groupBy({
    by: ["type", "creationId"],
    where: { businessId: input.businessId, createdAt: { gte: input.since } },
    _count: { _all: true },
  });

  const totals: Record<InquiryEventType, number> = {
    CREATION_VIEW: 0,
    BUSINESS_VIEW: 0,
    WHATSAPP_CLICK: 0,
    WEBSITE_CLICK: 0,
  };
  const perCreation = new Map<
    string,
    { views: number; whatsappClicks: number; websiteClicks: number }
  >();
  for (const row of grouped) {
    totals[row.type] += row._count._all;
    if (!row.creationId) continue;
    const entry = perCreation.get(row.creationId) ?? {
      views: 0,
      whatsappClicks: 0,
      websiteClicks: 0,
    };
    if (row.type === "CREATION_VIEW") entry.views += row._count._all;
    if (row.type === "WHATSAPP_CLICK") entry.whatsappClicks += row._count._all;
    if (row.type === "WEBSITE_CLICK") entry.websiteClicks += row._count._all;
    perCreation.set(row.creationId, entry);
  }

  return {
    since: input.since,
    totals,
    creations: [...perCreation.entries()]
      .map(([creationId, counts]) => ({ creationId, ...counts }))
      .sort((a, b) => b.whatsappClicks - a.whatsappClicks || b.views - a.views),
  };
}

/** Deletes raw events past the retention period (default 13 months). Safe to run repeatedly. */
export async function purgeOldInquiryEvents(
  prisma: PrismaClient,
  options: { olderThanDays?: number; now?: Date } = {},
): Promise<number> {
  const days = options.olderThanDays ?? 396;
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000);
  const { count } = await prisma.inquiryEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
