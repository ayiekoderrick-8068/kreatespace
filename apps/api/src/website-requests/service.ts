import {
  OPEN_WEBSITE_REQUEST_STATUSES,
  WEBSITE_REQUEST_TRANSITIONS,
  type WebsiteRequestDetails,
  type WebsiteRequestStatus,
} from "@kreatespace/shared";
import { recordAudit } from "../audit.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { HttpError, conflict, notFound } from "../http/errors.js";
import { requireApprovedBusiness } from "../portfolio/service.js";

const PAGE_SIZE = 20;
const CLOSED: WebsiteRequestStatus[] = ["DECLINED", "COMPLETED", "CANCELLED"];

type Row = Prisma.WebsiteRequestGetPayload<object>;

/** What a seller may see of their own request. Administrator notes are never included. */
export interface SellerWebsiteRequestView {
  id: string;
  type: Row["type"];
  description: string;
  budget: string | null;
  timeline: string | null;
  status: WebsiteRequestStatus;
  responseNote: string | null;
  /** Whether the seller can still withdraw it. */
  cancellable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const isOpen = (status: WebsiteRequestStatus) =>
  (OPEN_WEBSITE_REQUEST_STATUSES as readonly string[]).includes(status);

function toSellerView(row: Row): SellerWebsiteRequestView {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    budget: row.budget,
    timeline: row.timeline,
    status: row.status,
    responseNote: row.responseNote,
    cancellable: row.status === "NEW" || row.status === "IN_REVIEW" || row.status === "QUOTED",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function openRequestExists() {
  return conflict(
    "WEBSITE_REQUEST_OPEN",
    "You already have an open website request. Wait for a reply or withdraw it before sending another.",
  );
}

export async function createWebsiteRequest(
  prisma: PrismaClient,
  input: { userId: string; request: WebsiteRequestDetails },
): Promise<SellerWebsiteRequestView> {
  const business = await requireApprovedBusiness(prisma, input.userId);
  const { type, description, budget, timeline } = input.request;

  try {
    return await prisma.$transaction(async (tx) => {
      const open = await tx.websiteRequest.findFirst({
        where: { businessId: business.id, status: { in: [...OPEN_WEBSITE_REQUEST_STATUSES] } },
        select: { id: true },
      });
      if (open) throw openRequestExists();

      const row = await tx.websiteRequest.create({
        data: {
          businessId: business.id,
          type,
          description,
          budget: budget ?? null,
          timeline: timeline ?? null,
        },
      });
      await recordAudit(tx, {
        actorId: input.userId,
        action: "website_request.created",
        entityType: "WebsiteRequest",
        entityId: row.id,
      });
      return toSellerView(row);
    });
  } catch (error) {
    // The partial unique index is the last line of defence against two simultaneous requests.
    if ((error as { code?: string })?.code === "P2002") throw openRequestExists();
    if (String((error as Error)?.message).includes("website_requests_one_open_per_business")) {
      throw openRequestExists();
    }
    throw error;
  }
}

export async function listOwnWebsiteRequests(
  prisma: PrismaClient,
  userId: string,
): Promise<{ requests: SellerWebsiteRequestView[]; canRequest: boolean }> {
  const business = await requireApprovedBusiness(prisma, userId);
  const rows = await prisma.websiteRequest.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    requests: rows.map(toSellerView),
    canRequest: !rows.some((row) => isOpen(row.status)),
  };
}

/** Withdraws a request that hasn't been accepted yet. Other sellers' requests look like "not found". */
export async function cancelWebsiteRequest(
  prisma: PrismaClient,
  input: { userId: string; requestId: string },
): Promise<SellerWebsiteRequestView> {
  const business = await requireApprovedBusiness(prisma, input.userId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.websiteRequest.findFirst({
      where: { id: input.requestId, businessId: business.id },
    });
    if (!row) throw notFound("Request not found");
    if (!(row.status === "NEW" || row.status === "IN_REVIEW" || row.status === "QUOTED")) {
      throw conflict("WEBSITE_REQUEST_LOCKED", "This request can no longer be withdrawn.");
    }
    const updated = await tx.websiteRequest.update({
      where: { id: row.id },
      data: { status: "CANCELLED", closedAt: new Date() },
    });
    await recordAudit(tx, {
      actorId: input.userId,
      action: "website_request.cancelled",
      entityType: "WebsiteRequest",
      entityId: row.id,
    });
    return toSellerView(updated);
  });
}

// --- administrators ---------------------------------------------------------------------------

export interface AdminWebsiteRequestView extends SellerWebsiteRequestView {
  adminNotes: string | null;
  closedAt: Date | null;
  business: {
    id: string;
    slug: string;
    name: string;
    ownerName: string;
    whatsappNumber: string;
    websiteUrl: string | null;
    ownerEmail: string;
  };
}

const adminInclude = {
  business: {
    select: {
      id: true,
      slug: true,
      owner: { select: { email: true } },
      publishedRevision: {
        select: { businessName: true, ownerName: true, whatsappNumber: true, websiteUrl: true },
      },
      revisions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { businessName: true, ownerName: true, whatsappNumber: true, websiteUrl: true },
      },
    },
  },
} satisfies Prisma.WebsiteRequestInclude;

type AdminRow = Prisma.WebsiteRequestGetPayload<{ include: typeof adminInclude }>;

function toAdminView(row: AdminRow): AdminWebsiteRequestView {
  const profile = row.business.publishedRevision ?? row.business.revisions[0];
  return {
    ...toSellerView(row),
    adminNotes: row.adminNotes,
    closedAt: row.closedAt,
    business: {
      id: row.business.id,
      slug: row.business.slug,
      name: profile?.businessName ?? row.business.slug,
      ownerName: profile?.ownerName ?? "",
      whatsappNumber: profile?.whatsappNumber ?? "",
      websiteUrl: profile?.websiteUrl ?? null,
      ownerEmail: row.business.owner.email,
    },
  };
}

export async function listWebsiteRequestsForAdmin(
  prisma: PrismaClient,
  query: { status?: WebsiteRequestStatus; page: number },
) {
  const where: Prisma.WebsiteRequestWhereInput = query.status ? { status: query.status } : {};
  const [rows, total] = await Promise.all([
    prisma.websiteRequest.findMany({
      where,
      include: adminInclude,
      // Unanswered requests first, then oldest first so nobody waits behind newer ones.
      orderBy: [{ createdAt: "asc" }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.websiteRequest.count({ where }),
  ]);
  return {
    requests: rows.map(toAdminView),
    page: query.page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function getWebsiteRequestForAdmin(
  prisma: PrismaClient,
  requestId: string,
): Promise<AdminWebsiteRequestView> {
  const row = await prisma.websiteRequest.findUnique({
    where: { id: requestId },
    include: adminInclude,
  });
  if (!row) throw notFound("Request not found");
  return toAdminView(row);
}

export async function updateWebsiteRequest(
  prisma: PrismaClient,
  input: {
    requestId: string;
    adminId: string;
    changes: { status?: WebsiteRequestStatus; responseNote?: string; adminNotes?: string };
  },
): Promise<void> {
  const { requestId, adminId, changes } = input;
  await prisma.$transaction(async (tx) => {
    const row = await tx.websiteRequest.findUnique({ where: { id: requestId } });
    if (!row) throw notFound("Request not found");

    const data: Prisma.WebsiteRequestUpdateInput = {};
    if (changes.status !== undefined && changes.status !== row.status) {
      if (!WEBSITE_REQUEST_TRANSITIONS[row.status].includes(changes.status)) {
        throw new HttpError(
          409,
          "INVALID_TRANSITION",
          `A request that is ${row.status.toLowerCase().replace("_", " ")} can’t be moved to ${changes.status
            .toLowerCase()
            .replace("_", " ")}.`,
        );
      }
      data.status = changes.status;
      if (CLOSED.includes(changes.status)) data.closedAt = new Date();
    }
    if (changes.responseNote !== undefined) data.responseNote = changes.responseNote || null;
    if (changes.adminNotes !== undefined) data.adminNotes = changes.adminNotes || null;

    if (Object.keys(data).length === 0) return;
    await tx.websiteRequest.update({ where: { id: requestId }, data });
    await recordAudit(tx, {
      actorId: adminId,
      action: "website_request.updated",
      entityType: "WebsiteRequest",
      entityId: requestId,
      // Notes are not copied into the audit trail; only what changed is.
      metadata: {
        from: row.status,
        to: data.status ?? row.status,
        notesChanged: changes.adminNotes !== undefined,
        replyChanged: changes.responseNote !== undefined,
      },
    });
  });
}
