import { z } from "zod";
import { BUSINESS_STATUSES } from "./businesses.js";

export const REVIEW_COMMANDS = [
  "APPROVE",
  "REQUEST_CHANGES",
  "REJECT",
  "SUSPEND",
  "REINSTATE",
] as const;
export type ReviewCommand = (typeof REVIEW_COMMANDS)[number];

/** Commands that must explain themselves to the seller or to the audit trail. */
const REASON_REQUIRED: readonly ReviewCommand[] = ["REQUEST_CHANGES", "REJECT", "SUSPEND"];

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 1000;

export const reviewDecisionSchema = z
  .object({
    action: z.enum(REVIEW_COMMANDS, { error: "Choose a decision" }),
    reason: z.string().trim().max(REASON_MAX_LENGTH, "Reason is too long").optional(),
    /** Optional guard: the revision the admin was looking at when they decided. */
    revisionId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (REASON_REQUIRED.includes(value.action)) {
      if (!value.reason || value.reason.length < REASON_MIN_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["reason"],
          message: `Explain your decision in at least ${REASON_MIN_LENGTH} characters`,
        });
      }
    }
  });

export const adminBusinessListQuerySchema = z.object({
  status: z.enum(BUSINESS_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
