import { z } from "zod";

/** Sellers can ask KreateSpace for help building or improving a website. */
export const WEBSITE_REQUEST_TYPES = ["NEW_WEBSITE", "REDESIGN", "ONLINE_SHOP", "OTHER"] as const;
export type WebsiteRequestType = (typeof WEBSITE_REQUEST_TYPES)[number];

export const WEBSITE_REQUEST_TYPE_LABELS: Record<WebsiteRequestType, string> = {
  NEW_WEBSITE: "A new website",
  REDESIGN: "Improve my existing website",
  ONLINE_SHOP: "An online shop",
  OTHER: "Something else",
};

export const WEBSITE_REQUEST_BUDGETS = ["UNDER_50K", "50K_150K", "OVER_150K", "NOT_SURE"] as const;
export const WEBSITE_REQUEST_BUDGET_LABELS: Record<
  (typeof WEBSITE_REQUEST_BUDGETS)[number],
  string
> = {
  UNDER_50K: "Under KSh 50,000",
  "50K_150K": "KSh 50,000 – 150,000",
  OVER_150K: "Over KSh 150,000",
  NOT_SURE: "I’m not sure yet",
};

export const WEBSITE_REQUEST_TIMELINES = ["ASAP", "ONE_TO_THREE_MONTHS", "FLEXIBLE"] as const;
export const WEBSITE_REQUEST_TIMELINE_LABELS: Record<
  (typeof WEBSITE_REQUEST_TIMELINES)[number],
  string
> = {
  ASAP: "As soon as possible",
  ONE_TO_THREE_MONTHS: "In 1–3 months",
  FLEXIBLE: "I’m flexible",
};

export const WEBSITE_REQUEST_STATUSES = [
  "NEW",
  "IN_REVIEW",
  "QUOTED",
  "ACCEPTED",
  "DECLINED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type WebsiteRequestStatus = (typeof WEBSITE_REQUEST_STATUSES)[number];

/** Requests in these states are still being worked on; a business may have only one at a time. */
export const OPEN_WEBSITE_REQUEST_STATUSES = ["NEW", "IN_REVIEW", "QUOTED", "ACCEPTED"] as const;

/** Which status changes an administrator may make. Closed requests stay closed. */
export const WEBSITE_REQUEST_TRANSITIONS: Record<WebsiteRequestStatus, WebsiteRequestStatus[]> = {
  NEW: ["IN_REVIEW", "QUOTED", "DECLINED"],
  IN_REVIEW: ["QUOTED", "DECLINED"],
  QUOTED: ["ACCEPTED", "DECLINED"],
  ACCEPTED: ["COMPLETED", "DECLINED"],
  DECLINED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export const websiteRequestSchema = z.object({
  type: z.enum(WEBSITE_REQUEST_TYPES, { error: "Choose what you need" }),
  description: z
    .string()
    .trim()
    .min(20, "Tell us a little more (at least 20 characters)")
    .max(1000, "Keep the description under 1,000 characters"),
  budget: z.enum(WEBSITE_REQUEST_BUDGETS).nullable().optional(),
  timeline: z.enum(WEBSITE_REQUEST_TIMELINES).nullable().optional(),
});
export type WebsiteRequestInput = z.input<typeof websiteRequestSchema>;
export type WebsiteRequestDetails = z.output<typeof websiteRequestSchema>;

/** What an administrator can change: the status and the notes. */
export const websiteRequestUpdateSchema = z
  .object({
    // Administrators never set NEW (the starting state) or CANCELLED (the seller's own action).
    status: z.enum(["IN_REVIEW", "QUOTED", "ACCEPTED", "DECLINED", "COMPLETED"]).optional(),
    /** Shown to the seller. */
    responseNote: z.string().trim().max(1000, "Keep the reply under 1,000 characters").optional(),
    /** Private to administrators. */
    adminNotes: z.string().trim().max(2000, "Keep the notes under 2,000 characters").optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.responseNote !== undefined ||
      value.adminNotes !== undefined,
    { message: "Nothing to update" },
  );

export const adminWebsiteRequestListQuerySchema = z.object({
  status: z.enum(WEBSITE_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
