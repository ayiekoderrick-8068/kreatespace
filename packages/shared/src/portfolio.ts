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
  occasionId: z
    .string()
    .nullable()
    .optional()
    // An unset select sends an empty string; that means "no occasion".
    .transform((value) => (value ? value : null))
    .pipe(z.uuid("Choose an occasion").nullable()),
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

/** Optional service packages a business can offer (for example a wedding photography package). */
export const MAX_PACKAGES = 10;

export const packageContentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Give the package a name of at least 3 characters")
    .max(80, "Name must be 80 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(10, "Describe the package in at least 10 characters")
    .max(600, "Description must be 600 characters or fewer"),
  /** What the customer gets, one item per line (for example "Edited photographs"). */
  includes: z
    .array(
      z
        .string()
        .trim()
        .min(2, "Each included item needs at least 2 characters")
        .max(100, "Each included item must be 100 characters or fewer"),
    )
    .min(1, "List at least one thing the package includes")
    .max(10, "List up to 10 included items"),
  /** Optional starting price in Kenyan shillings. Never filled in for the seller. */
  startingPriceKes: z
    .number({ error: "Enter the price as a number" })
    .int("Enter a whole number of shillings")
    .min(1, "The price must be at least KSh 1")
    .max(10_000_000, "The price is too high")
    .nullable()
    .optional(),
});

export const packageDraftSchema = packageContentSchema.partial();

export const adminPackageListQuerySchema = z.object({
  state: z.enum(["DRAFT", "PENDING", "CHANGES_REQUESTED", "APPROVED", "REJECTED"]).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "SUSPENDED"]).optional(),
  businessId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type PackageContent = z.output<typeof packageContentSchema>;
export type PackageContentInput = z.input<typeof packageContentSchema>;
