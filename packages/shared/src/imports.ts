import { z } from "zod";
import { creationDetailsSchema } from "./portfolio.js";

/** How far one import may go. Small on purpose: this reads a small business's own website. */
export const IMPORT_MAX_PAGES = 12;
export const IMPORT_MAX_DEPTH = 1;
export const IMPORT_MAX_JOBS_PER_DAY = 5;

export const grantImportSchema = z.object({
  businessId: z.uuid(),
});

export const startImportSchema = z.object({
  authorizationId: z.uuid(),
  /** Optional: where to begin. Defaults to the home page of the authorised domain. */
  startUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

/**
 * Accepting an item turns it into a draft creation. The reviewer may correct the text and must
 * choose a category; the occasion is optional.
 */
export const acceptImportItemSchema = creationDetailsSchema
  .partial({
    title: true,
    description: true,
  })
  .extend({
    /** Required to import a page that was flagged as a possible duplicate. */
    confirmDuplicate: z.boolean().optional(),
  });

export const importItemListQuerySchema = z.object({
  status: z.enum(["PENDING_REVIEW", "DUPLICATE", "ACCEPTED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type AcceptImportItemInput = z.input<typeof acceptImportItemSchema>;
