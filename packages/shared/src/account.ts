import { z } from "zod";

/** An administrator's decision on a business owner's request to delete their account. */
export const deletionDecisionSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    /** Shown to the person when a request is refused, so it must say why. */
    note: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
  })
  .refine((value) => value.action !== "REJECT" || Boolean(value.note), {
    path: ["note"],
    message: "Tell the person why the request can’t go ahead",
  });

export const DELETION_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export const adminDeletionListQuerySchema = z.object({
  status: z.enum(DELETION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
