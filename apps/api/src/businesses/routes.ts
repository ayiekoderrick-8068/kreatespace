import { Router, type RequestHandler } from "express";
import {
  businessDetailsSchema,
  businessDraftSchema,
  uploadRequestSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  createBusiness,
  createUploadTarget,
  getOwnBusiness,
  listCategories,
  submitForReview,
  updateDraft,
} from "./service.js";

export interface BusinessRouteDeps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
  /** Limits sensitive write endpoints (submission, upload URLs). */
  writeLimiter: RequestHandler;
}

/** Public list of categories, mounted at /api/categories. */
export function categoryRoutes({ prisma }: Pick<BusinessRouteDeps, "prisma">): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.json({ categories: await listCategories(prisma) });
  });
  return router;
}

/**
 * The signed-in seller's own business, mounted at /api/businesses.
 * Routes never take a business id: the business is always resolved from the authenticated user,
 * so one seller can never reach another seller's data.
 */
export function sellerBusinessRoutes(deps: BusinessRouteDeps): Router {
  const { prisma, authenticate, storage, writeLimiter } = deps;
  const router = Router();
  router.use(authenticate, requireRole("SELLER"));

  router.get("/me", async (req, res) => {
    res.json(await getOwnBusiness(prisma, storage, req.user!.id));
  });

  router.post("/", async (req, res) => {
    const details = parseInput(businessDetailsSchema, req.body);
    const { businessId } = await createBusiness(prisma, { ownerId: req.user!.id, details });
    res.status(201).json({ businessId });
  });

  router.patch("/me", async (req, res) => {
    const changes = parseInput(businessDraftSchema, req.body);
    await updateDraft(prisma, { ownerId: req.user!.id, changes });
    res.json(await getOwnBusiness(prisma, storage, req.user!.id));
  });

  router.post("/me/uploads", writeLimiter, async (req, res) => {
    if (!storage) {
      throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "Image uploads are not available");
    }
    const upload = parseInput(uploadRequestSchema, req.body);
    res
      .status(201)
      .json(await createUploadTarget(prisma, storage, { ownerId: req.user!.id, upload }));
  });

  router.post("/me/submit", writeLimiter, async (req, res) => {
    await submitForReview(prisma, storage, { ownerId: req.user!.id });
    res.json(await getOwnBusiness(prisma, storage, req.user!.id));
  });

  return router;
}
