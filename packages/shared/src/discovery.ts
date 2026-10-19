import { z } from "zod";
import { countySchema } from "./businesses.js";

export const CREATION_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export type CreationStatus = (typeof CREATION_STATUSES)[number];

export const DISCOVERY_PAGE_SIZE = 24;
export const DISCOVERY_MAX_PAGE_SIZE = 48;

/** Query strings arrive as "" when a control is cleared; treat that as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

/** Filters for the public discovery feed. Every field is optional and they combine with AND. */
export const creationListQuerySchema = z.object({
  q: optional(z.string().trim().max(100)),
  category: optional(slugSchema),
  occasion: optional(slugSchema),
  county: optional(countySchema),
  city: optional(z.string().trim().max(80)),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DISCOVERY_MAX_PAGE_SIZE)
    .default(DISCOVERY_PAGE_SIZE),
});

export type CreationListQuery = z.infer<typeof creationListQuerySchema>;

export const savedListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(DISCOVERY_MAX_PAGE_SIZE)
    .default(DISCOVERY_PAGE_SIZE),
});
