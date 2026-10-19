import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  IMAGE_EXTENSIONS,
  IMAGE_MAX_BYTES,
  IMPORT_MAX_JOBS_PER_DAY,
  IMPORT_MAX_PAGES,
  acceptImportItemSchema,
  creationDetailsSchema,
  type AcceptImportItemInput,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound, parseInput } from "../http/errors.js";
import { createDraftCreation } from "../portfolio/service.js";
import {
  InvalidImageError,
  inspectImage,
  type ImageContentType,
} from "../storage/image-validation.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  contentHash,
  extractLinks,
  extractPage,
  normalizeTitle,
  parseRobots,
  resolveHttpUrl,
} from "./extract.js";
import {
  hostMatchesDomain,
  isInternalHostname,
  isSharedSuffix,
  normalizeDomain,
} from "./net-guard.js";
import { FetchRefusedError, type SafeFetcher } from "./safe-fetch.js";

const PAGE_SIZE = 20;
const HTML_TYPES = ["text/html", "application/xhtml+xml"] as const;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const HTML_MAX_BYTES = 1_500_000;
const ROBOTS_MAX_BYTES = 100_000;
const STALE_JOB_MS = 15 * 60_000;

// --- authorisations -------------------------------------------------------------------------------

/**
 * Records that a business has authorised KreateSpace to read its own website. The domain is never
 * typed in: it is taken from the business's approved profile, and the business must have confirmed
 * it owns the content it shows. Shared hosting suffixes and internal names are refused.
 */
export async function grantAuthorization(
  prisma: PrismaClient,
  input: { businessId: string; adminId: string },
) {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      status: true,
      publishedRevision: { select: { websiteUrl: true, contentAuthorizedAt: true } },
    },
  });
  if (!business) throw notFound("Business not found");
  if (business.status !== "APPROVED" || !business.publishedRevision) {
    throw conflict(
      "BUSINESS_NOT_APPROVED",
      "Only approved businesses can have a website imported.",
    );
  }
  const { websiteUrl, contentAuthorizedAt } = business.publishedRevision;
  if (!websiteUrl) {
    throw conflict("NO_WEBSITE", "This business has not listed a website.");
  }
  if (!contentAuthorizedAt) {
    throw conflict(
      "CONTENT_NOT_AUTHORIZED",
      "This business has not confirmed that it owns the content on its website.",
    );
  }

  let host: string;
  try {
    host = new URL(websiteUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw conflict("INVALID_WEBSITE", "The business’s website address isn’t valid.");
  }
  const domain = normalizeDomain(host);
  if (isIP(domain) !== 0 || isInternalHostname(domain) || isSharedSuffix(domain)) {
    throw conflict(
      "DOMAIN_NOT_ELIGIBLE",
      "This website’s address can’t be imported from. It may be an internal address or a shared hosting domain.",
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const authorization = await tx.importAuthorization.create({
        data: { businessId: business.id, domain, grantedById: input.adminId },
      });
      await recordAudit(tx, {
        actorId: input.adminId,
        action: "import.authorization_granted",
        entityType: "ImportAuthorization",
        entityId: authorization.id,
        metadata: { businessId: business.id, domain },
      });
      return authorization;
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      throw conflict("ALREADY_AUTHORIZED", "This website is already authorised for import.");
    }
    throw error;
  }
}

export async function revokeAuthorization(
  prisma: PrismaClient,
  input: { authorizationId: string; adminId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.importAuthorization.updateMany({
      where: { id: input.authorizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound("Authorisation not found");
    await recordAudit(tx, {
      actorId: input.adminId,
      action: "import.authorization_revoked",
      entityType: "ImportAuthorization",
      entityId: input.authorizationId,
    });
  });
}

export async function listAuthorizations(prisma: PrismaClient, businessId?: string) {
  const rows = await prisma.importAuthorization.findMany({
    where: businessId ? { businessId } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      business: {
        select: {
          slug: true,
          publishedRevision: { select: { businessName: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    businessName: row.business.publishedRevision?.businessName ?? row.business.slug,
    domain: row.domain,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  }));
}

// --- jobs -----------------------------------------------------------------------------------------

/** Jobs that were running when the server stopped would otherwise block the business forever. */
export async function failStaleJobs(prisma: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await prisma.importJob.updateMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { lt: new Date(now.getTime() - STALE_JOB_MS) },
    },
    data: { status: "FAILED", failureCode: "INTERRUPTED", finishedAt: now },
  });
  return count;
}

export async function startImport(
  prisma: PrismaClient,
  input: { authorizationId: string; adminId: string; startUrl?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  await failStaleJobs(prisma, now);

  const authorization = await prisma.importAuthorization.findFirst({
    where: { id: input.authorizationId, revokedAt: null },
    include: { business: { select: { status: true } } },
  });
  if (!authorization) throw notFound("Authorisation not found");
  if (authorization.business.status !== "APPROVED") {
    throw conflict(
      "BUSINESS_NOT_APPROVED",
      "Only approved businesses can have a website imported.",
    );
  }

  let startUrl = `https://${authorization.domain}/`;
  if (input.startUrl) {
    const resolved = resolveHttpUrl(input.startUrl, startUrl);
    if (!resolved || !hostMatchesDomain(new URL(resolved).hostname, authorization.domain)) {
      throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", {
        fields: { startUrl: `Use an address on ${authorization.domain}` },
      });
    }
    startUrl = resolved;
  }

  const recent = await prisma.importJob.count({
    where: {
      businessId: authorization.businessId,
      createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) },
    },
  });
  if (recent >= IMPORT_MAX_JOBS_PER_DAY) {
    throw new HttpError(
      429,
      "IMPORT_LIMIT",
      `This business has already had ${IMPORT_MAX_JOBS_PER_DAY} imports in the last day. Try again tomorrow.`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const job = await tx.importJob.create({
        data: {
          businessId: authorization.businessId,
          authorizationId: authorization.id,
          requestedById: input.adminId,
          startUrl,
        },
      });
      await recordAudit(tx, {
        actorId: input.adminId,
        action: "import.started",
        entityType: "ImportJob",
        entityId: job.id,
        metadata: { businessId: authorization.businessId, domain: authorization.domain },
      });
      return job;
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      throw conflict("IMPORT_RUNNING", "An import is already running for this business.");
    }
    throw error;
  }
}

export interface ImportRunOptions {
  fetcher: SafeFetcher;
  /** Pause between page requests so a small website is never hammered. */
  delayMs?: number;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function findDuplicate(
  prisma: PrismaClient,
  input: { businessId: string; title: string; hash: string },
): Promise<{ reason: string; creationId: string | null } | null> {
  const revisions = await prisma.creationRevision.findMany({
    where: { creation: { businessId: input.businessId } },
    select: { title: true, creationId: true },
  });
  const wanted = normalizeTitle(input.title);
  const sameTitle = revisions.find((r) => normalizeTitle(r.title) === wanted);
  if (sameTitle) {
    return {
      reason: "A creation with the same title already exists.",
      creationId: sameTitle.creationId,
    };
  }
  const sameContent = await prisma.importItem.findFirst({
    where: {
      businessId: input.businessId,
      contentHash: input.hash,
      status: { not: "REJECTED" },
    },
    select: { id: true },
  });
  if (sameContent) {
    return { reason: "Another imported page has the same content.", creationId: null };
  }
  return null;
}

/** Reads an authorised website and stages what it finds for review. Never publishes anything. */
export async function runImportJob(
  prisma: PrismaClient,
  jobId: string,
  options: ImportRunOptions,
): Promise<void> {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    include: { authorization: true },
  });
  if (!job || job.status !== "QUEUED") return;
  const { domain } = job.authorization;
  const delayMs = options.delayMs ?? 400;
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const counts = { pagesFetched: 0, itemsFound: 0, duplicates: 0, skipped: 0 };
  let failureCode: string | null = null;

  try {
    if (job.authorization.revokedAt) throw new FetchRefusedError("NOT_AUTHORIZED", "Revoked");
    const start = new URL(job.startUrl);

    // Respect the website's own rules about automated visitors.
    let allowed = (_path: string) => true;
    try {
      const robots = await options.fetcher.fetch(`${start.origin}/robots.txt`, {
        domain,
        allowedTypes: ["text/plain"],
        maxBytes: ROBOTS_MAX_BYTES,
      });
      allowed = parseRobots(robots.body.toString("utf8"), "KreateSpaceImporter");
    } catch (error) {
      // A missing or unusable robots.txt means there are no restrictions to follow.
      if (error instanceof FetchRefusedError && error.code === "BLOCKED_ADDRESS") throw error;
    }
    if (!allowed(start.pathname)) throw new FetchRefusedError("ROBOTS", "Disallowed by robots.txt");

    const queue: string[] = [job.startUrl];
    const seen = new Set<string>(queue);
    for (let index = 0; index < queue.length && counts.pagesFetched < IMPORT_MAX_PAGES; index++) {
      const url = queue[index]!;
      if (index > 0) await sleep(delayMs);

      let html: string;
      try {
        const page = await options.fetcher.fetch(url, {
          domain,
          allowedTypes: HTML_TYPES,
          maxBytes: HTML_MAX_BYTES,
        });
        html = page.body.toString("utf8");
      } catch (error) {
        // Only the first page matters: if it can't be read there is nothing to import.
        if (index === 0) throw error;
        counts.skipped++;
        continue;
      }
      counts.pagesFetched++;

      // Depth is limited to the start page and the pages it links to directly.
      if (index === 0) {
        for (const link of extractLinks(html, url, domain)) {
          if (seen.has(link) || !allowed(new URL(link).pathname)) continue;
          seen.add(link);
          queue.push(link);
          if (queue.length >= IMPORT_MAX_PAGES) break;
        }
      }

      const extraction = extractPage(html, url);
      if (!("item" in extraction)) {
        counts.skipped++;
        continue;
      }
      const { item } = extraction;
      const hash = contentHash(item.title, item.description);

      const already = await prisma.importItem.findUnique({
        where: { businessId_sourceUrl: { businessId: job.businessId, sourceUrl: item.sourceUrl } },
        select: { id: true },
      });
      if (already) {
        counts.skipped++;
        continue;
      }
      const duplicate = await findDuplicate(prisma, {
        businessId: job.businessId,
        title: item.title,
        hash,
      });
      try {
        await prisma.importItem.create({
          data: {
            jobId: job.id,
            businessId: job.businessId,
            sourceUrl: item.sourceUrl,
            title: item.title,
            description: item.description,
            imageUrls: item.imageUrls,
            contentHash: hash,
            status: duplicate ? "DUPLICATE" : "PENDING_REVIEW",
            duplicateReason: duplicate?.reason ?? null,
            duplicateOfCreationId: duplicate?.creationId ?? null,
          },
        });
        counts.itemsFound++;
        if (duplicate) counts.duplicates++;
      } catch (error) {
        if ((error as { code?: string })?.code === "P2002") counts.skipped++;
        else throw error;
      }
    }
  } catch (error) {
    if (error instanceof FetchRefusedError) {
      failureCode = error.code;
      console.warn(`Import ${jobId} stopped: ${error.code} ${error.detail ?? ""}`);
    } else {
      failureCode = "INTERNAL";
      console.error(`Import ${jobId} failed`, error);
    }
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      ...counts,
      status: failureCode ? "FAILED" : "COMPLETED",
      failureCode,
      finishedAt: new Date(),
    },
  });
}

/** What an administrator is told when a crawl stops. Never includes addresses or raw errors. */
export const FAILURE_MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED:
    "The website sent us somewhere we aren’t authorised to go, so the import stopped.",
  BLOCKED_ADDRESS: "The website’s address can’t be imported from.",
  ROBOTS: "The website asks automated visitors not to read this page.",
  TIMEOUT: "The website took too long to respond.",
  TOO_LARGE: "The page was too large to import.",
  UNSUPPORTED_TYPE: "The address didn’t return a web page.",
  HTTP_ERROR: "The website returned an error.",
  UNREACHABLE: "The website couldn’t be reached.",
  TOO_MANY_REDIRECTS: "The website redirected too many times.",
  INVALID_URL: "The starting address isn’t valid.",
  UNSUPPORTED_PORT: "The starting address uses an unsupported port.",
  INTERRUPTED: "The import was interrupted. You can start it again.",
  INTERNAL: "Something went wrong while importing. Please try again.",
};

export async function listJobs(prisma: PrismaClient, businessId?: string) {
  await failStaleJobs(prisma);
  const rows = await prisma.importJob.findMany({
    where: businessId ? { businessId } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      authorization: { select: { domain: true } },
      business: { select: { slug: true, publishedRevision: { select: { businessName: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    businessId: row.businessId,
    businessName: row.business.publishedRevision?.businessName ?? row.business.slug,
    domain: row.authorization.domain,
    startUrl: row.startUrl,
    status: row.status,
    pagesFetched: row.pagesFetched,
    itemsFound: row.itemsFound,
    duplicates: row.duplicates,
    skipped: row.skipped,
    failure: row.failureCode
      ? (FAILURE_MESSAGES[row.failureCode] ?? FAILURE_MESSAGES.INTERNAL)
      : null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  }));
}

// --- reviewing what was found ---------------------------------------------------------------------

const itemSelect = {
  id: true,
  jobId: true,
  businessId: true,
  sourceUrl: true,
  title: true,
  description: true,
  imageUrls: true,
  status: true,
  duplicateReason: true,
  duplicateOfCreationId: true,
  creationId: true,
  createdAt: true,
  business: { select: { slug: true, publishedRevision: { select: { businessName: true } } } },
} satisfies Prisma.ImportItemSelect;

type ItemRow = Prisma.ImportItemGetPayload<{ select: typeof itemSelect }>;

function toItemView(row: ItemRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    businessId: row.businessId,
    businessName: row.business.publishedRevision?.businessName ?? row.business.slug,
    sourceUrl: row.sourceUrl,
    title: row.title,
    description: row.description,
    imageUrls: Array.isArray(row.imageUrls) ? (row.imageUrls as string[]) : [],
    status: row.status,
    duplicateReason: row.duplicateReason,
    duplicateOfCreationId: row.duplicateOfCreationId,
    creationId: row.creationId,
    createdAt: row.createdAt,
  };
}

export async function listItems(
  prisma: PrismaClient,
  query: { jobId?: string; businessId?: string; status?: string; page: number },
) {
  const where: Prisma.ImportItemWhereInput = {
    ...(query.jobId ? { jobId: query.jobId } : {}),
    ...(query.businessId ? { businessId: query.businessId } : {}),
    ...(query.status ? { status: query.status as ItemRow["status"] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.importItem.findMany({
      where,
      select: itemSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.importItem.count({ where }),
  ]);
  return { items: rows.map(toItemView), page: query.page, pageSize: PAGE_SIZE, total };
}

export async function getItem(prisma: PrismaClient, itemId: string) {
  const row = await prisma.importItem.findUnique({ where: { id: itemId }, select: itemSelect });
  if (!row) throw notFound("Imported page not found");
  return toItemView(row);
}

export async function rejectItem(
  prisma: PrismaClient,
  input: { itemId: string; adminId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.importItem.updateMany({
      where: { id: input.itemId, status: { in: ["PENDING_REVIEW", "DUPLICATE"] } },
      data: { status: "REJECTED", decidedById: input.adminId, decidedAt: new Date() },
    });
    if (count === 0) {
      const exists = await tx.importItem.findUnique({
        where: { id: input.itemId },
        select: { id: true },
      });
      if (!exists) throw notFound("Imported page not found");
      throw conflict("ITEM_DECIDED", "This page has already been reviewed.");
    }
    await recordAudit(tx, {
      actorId: input.adminId,
      action: "import.item_rejected",
      entityType: "ImportItem",
      entityId: input.itemId,
    });
  });
}

interface StoredImage {
  path: string;
  width: number;
  height: number;
}

/**
 * Turns a reviewed page into a *draft* creation. Photos are downloaded from the authorised
 * website only, checked as real images, and copied into KreateSpace's own private storage. The
 * draft still has to be submitted by the seller and approved before anyone can see it.
 */
export async function acceptItem(
  prisma: PrismaClient,
  deps: { storage: MediaStorage; fetcher: SafeFetcher },
  input: {
    itemId: string;
    adminId: string;
    changes: AcceptImportItemInput & { confirmDuplicate?: boolean };
  },
): Promise<{ creationId: string; imagesImported: number; imagesSkipped: number }> {
  const item = await prisma.importItem.findUnique({
    where: { id: input.itemId },
    include: {
      job: { include: { authorization: true } },
      business: { select: { id: true, status: true } },
    },
  });
  if (!item) throw notFound("Imported page not found");
  if (item.status !== "PENDING_REVIEW" && item.status !== "DUPLICATE") {
    throw conflict("ITEM_DECIDED", "This page has already been reviewed.");
  }
  if (item.status === "DUPLICATE" && !input.changes.confirmDuplicate) {
    throw conflict(
      "DUPLICATE_UNCONFIRMED",
      "This page looks like a duplicate. Confirm that you want to import it anyway.",
    );
  }
  const authorization = item.job.authorization;
  if (authorization.revokedAt) {
    throw conflict("AUTHORIZATION_REVOKED", "This website’s authorisation has been revoked.");
  }
  if (item.business.status !== "APPROVED") {
    throw conflict(
      "BUSINESS_NOT_APPROVED",
      "Only approved businesses can receive imported drafts.",
    );
  }

  const edits = parseInput(acceptImportItemSchema, input.changes);
  const details = parseInput(creationDetailsSchema, {
    title: edits.title ?? item.title,
    description: edits.description ?? item.description,
    categoryId: edits.categoryId,
    occasionId: edits.occasionId,
  });

  // Fetch and check every photo first; nothing is stored until at least one passes.
  const urls = Array.isArray(item.imageUrls) ? (item.imageUrls as string[]) : [];
  const accepted: {
    bytes: Buffer;
    contentType: ImageContentType;
    extension: "jpg" | "png" | "webp";
    width: number;
    height: number;
  }[] = [];
  let skipped = 0;
  for (const url of urls) {
    try {
      const file = await deps.fetcher.fetch(url, {
        domain: authorization.domain,
        allowedTypes: IMAGE_TYPES,
        maxBytes: IMAGE_MAX_BYTES,
      });
      const inspected = inspectImage(file.body);
      accepted.push({ bytes: file.body, ...inspected });
    } catch (error) {
      if (error instanceof FetchRefusedError || error instanceof InvalidImageError) skipped++;
      else throw error;
    }
  }
  if (accepted.length === 0) {
    throw new HttpError(
      422,
      "NO_USABLE_PHOTOS",
      "None of this page’s photos could be imported. Reject it, or ask the seller to upload photos themselves.",
    );
  }

  const creationId = randomUUID();
  const folder = `businesses/${item.businessId}/creations/${creationId}`;
  const stored: StoredImage[] = [];
  try {
    for (const image of accepted) {
      const path = `${folder}/${randomUUID()}.${IMAGE_EXTENSIONS[image.contentType]}`;
      await deps.storage.upload(path, image.bytes, image.contentType);
      stored.push({ path, width: image.width, height: image.height });
    }

    await createDraftCreation(prisma, {
      businessId: item.businessId,
      actorId: input.adminId,
      details,
      creationId,
      images: stored,
      auditAction: "creation.imported",
      afterCreate: async (tx, newCreationId) => {
        // Only one reviewer can win: a second, simultaneous accept rolls the whole draft back.
        const { count } = await tx.importItem.updateMany({
          where: { id: item.id, status: { in: ["PENDING_REVIEW", "DUPLICATE"] } },
          data: {
            status: "ACCEPTED",
            creationId: newCreationId,
            decidedById: input.adminId,
            decidedAt: new Date(),
          },
        });
        if (count === 0) {
          throw conflict("ITEM_DECIDED", "This page has already been reviewed.");
        }
        await recordAudit(tx, {
          actorId: input.adminId,
          action: "import.item_accepted",
          entityType: "ImportItem",
          entityId: item.id,
          metadata: { creationId: newCreationId, photos: stored.length },
        });
      },
    });
  } catch (error) {
    // Never leave photos behind for a draft that was not created.
    await deps.storage.remove(stored.map((s) => s.path)).catch(() => undefined);
    throw error;
  }

  return { creationId, imagesImported: stored.length, imagesSkipped: skipped };
}
