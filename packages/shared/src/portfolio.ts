import { z } from "zod";
import { CREATION_STATUSES } from "./discovery.js";

/** Free-plan limits, enforced by the API and the database. */
export const MAX_ACTIVE_CREATIONS = 20;
export const MAX_IMAGES_PER_CREATION = 5;

export const creationDetailsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give your creation a title of at least 3 characters")
    .max(80, "Title must be 80 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(20, "Describe it in at least 20 characters")
    .max(1000, "Description must be 1,000 characters or fewer"),
  categoryId: z.uuid("Choose a category"),
  /** Optional: not every creation belongs to an occasion. */
  occasionId: z.uuid("Choose an occasion").nullable().optional(),
});

/** Any subset of the details while drafting. */
export const creationDraftSchema = creationDetailsSchema.partial();

export const imageOrderSchema = z.object({
  imageIds: z.array(z.uuid()).min(1).max(MAX_IMAGES_PER_CREATION),
});

export const confirmImageSchema = z.object({
  /** The storage path returned when the upload target was issued. */
  path: z.string().min(10).max(300),
});

export const adminCreationListQuerySchema = z.object({
  status: z.enum(CREATION_STATUSES).optional(),
  businessId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  category: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
  ),
  q: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type CreationDetailsInput = z.input<typeof creationDetailsSchema>;
export type CreationDetails = z.output<typeof creationDetailsSchema>;
export type CreationDraftInput = z.input<typeof creationDraftSchema>;
