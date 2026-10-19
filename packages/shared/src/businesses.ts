import { z } from "zod";
import { KENYAN_COUNTIES } from "./kenya.js";
import { whatsappNumberSchema } from "./phone.js";

export const BUSINESS_STATUSES = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const REVISION_STATUSES = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVIEW_ACTIONS = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
  "SUSPENDED",
  "REINSTATED",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Image upload limits, enforced by the API and the storage bucket. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const IMAGE_EXTENSIONS: Record<(typeof IMAGE_CONTENT_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const PORTFOLIO_MIN_IMAGES = 1;
export const PORTFOLIO_MAX_IMAGES = 6;

/** Accepts only absolute http(s) URLs with a real hostname. */
export function isSafeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const optionalWebsiteSchema = z
  .string()
  .trim()
  .max(200, "Website address is too long")
  .refine((value) => value === "" || isSafeWebUrl(value), {
    message: "Enter a full website address starting with https://",
  });

export const countySchema = z.enum(KENYAN_COUNTIES, { error: "Choose a county" });

export const businessDetailsSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Enter your business name")
    .max(80, "Business name must be 80 characters or fewer"),
  ownerName: z
    .string()
    .trim()
    .min(2, "Enter the business owner's name")
    .max(100, "Name must be 100 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(30, "Describe your business in at least 30 characters")
    .max(1000, "Description must be 1,000 characters or fewer"),
  categoryId: z.uuid("Choose a category"),
  county: countySchema,
  city: z
    .string()
    .trim()
    .min(2, "Enter your city or town")
    .max(80, "City or town must be 80 characters or fewer"),
  /** Optional: businesses without a website can still join. Empty string means none. */
  websiteUrl: optionalWebsiteSchema.optional(),
  whatsappNumber: whatsappNumberSchema,
});

/** Storage paths look like `businesses/<businessId>/<imageId>.<ext>`. */
export const storagePathSchema = z
  .string()
  .regex(/^businesses\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/, "Invalid image reference");

export const businessMediaSchema = z.object({
  logoPath: storagePathSchema.nullable().optional(),
  portfolioPaths: z
    .array(storagePathSchema)
    .min(PORTFOLIO_MIN_IMAGES, "Add at least one portfolio photo")
    .max(PORTFOLIO_MAX_IMAGES, `You can add up to ${PORTFOLIO_MAX_IMAGES} portfolio photos`),
});

export const agreementsSchema = z.object({
  termsAccepted: z.literal(true, { error: "You must accept the seller terms" }),
  contentAuthorization: z.literal(true, {
    error: "You must confirm you own or are authorised to share these images",
  }),
});

/** Everything required before a business (or an update to it) can be sent for review. */
export const businessSubmissionSchema = businessDetailsSchema
  .extend(businessMediaSchema.shape)
  .extend(agreementsSchema.shape);

/** Partial save while drafting: any subset of details, media and agreements. */
export const businessDraftSchema = businessDetailsSchema.partial().extend({
  logoPath: storagePathSchema.nullable().optional(),
  portfolioPaths: z.array(storagePathSchema).max(PORTFOLIO_MAX_IMAGES).optional(),
  termsAccepted: z.boolean().optional(),
  contentAuthorization: z.boolean().optional(),
});

export const uploadRequestSchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES, { error: "Only JPEG, PNG or WebP images are allowed" }),
  size: z.number().int().positive().max(IMAGE_MAX_BYTES, "Images must be 5 MB or smaller"),
});

export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;
export type BusinessDetails = z.output<typeof businessDetailsSchema>;
export type BusinessDraftInput = z.input<typeof businessDraftSchema>;
export type BusinessSubmission = z.output<typeof businessSubmissionSchema>;
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
