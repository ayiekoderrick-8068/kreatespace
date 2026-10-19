import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  confirmImageSchema,
  creationDetailsSchema,
  creationDraftSchema,
  imageOrderSchema,
  uploadRequestSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { confirmImage, createImageUpload, removeImage, reorderImages } from "./images.js";
import {
  archiveCreation,
  createCreation,
  getOwnCreation,
  listOwnCreations,
  startCreationRevision,
  submitCreation,
  updateCreationDraft,
} from "./service.js";

export interface PortfolioDeps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
  writeLimiter: RequestHandler;
}

const idSchema = z.uuid();

/**
 * The signed-in seller's creations, mounted at /api/creations. The business is always resolved
 * from the authenticated user and every creation is checked against it, so a seller can never
 * read or change another business's work.
 */
export function sellerCreationRoutes(deps: PortfolioDeps): Router {
  const { prisma, authenticate, storage, writeLimiter } = deps;
  const router = Router();
  router.use(authenticate, requireRole("SELLER"));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  router.get("/", async (req, res) => {
    res.json(await listOwnCreations(prisma, storage, req.user!.id));
  });

  router.post("/", writeLimiter, async (req, res) => {
    const details = parseInput(creationDetailsSchema, req.body);
    const { creationId } = await createCreation(prisma, { userId: req.user!.id, details });
    res.status(201).json({ creationId });
  });

  router.get("/:id", async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.patch("/:id", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    const changes = parseInput(creationDraftSchema, req.body);
    await updateCreationDraft(prisma, { userId: req.user!.id, creationId, changes });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.post("/:id/submit", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    await submitCreation(prisma, storage, { userId: req.user!.id, creationId });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.post("/:id/revisions", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    await startCreationRevision(prisma, { userId: req.user!.id, creationId });
    res
      .status(201)
      .json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.post("/:id/archive", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    await archiveCreation(prisma, { userId: req.user!.id, creationId });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.post("/:id/uploads", writeLimiter, async (req, res) => {
    if (!storage) {
      throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "Image uploads are not available");
    }
    const creationId = parseInput(idSchema, req.params.id);
    const upload = parseInput(uploadRequestSchema, req.body);
    res
      .status(201)
      .json(await createImageUpload(prisma, storage, { userId: req.user!.id, creationId, upload }));
  });

  router.post("/:id/images", writeLimiter, async (req, res) => {
    if (!storage) {
      throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "Image uploads are not available");
    }
    const creationId = parseInput(idSchema, req.params.id);
    const { path } = parseInput(confirmImageSchema, req.body);
    await confirmImage(prisma, storage, { userId: req.user!.id, creationId, path });
    res
      .status(201)
      .json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.put("/:id/images/order", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    const { imageIds } = parseInput(imageOrderSchema, req.body);
    await reorderImages(prisma, { userId: req.user!.id, creationId, imageIds });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  router.delete("/:id/images/:imageId", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    const imageId = parseInput(idSchema, req.params.imageId);
    await removeImage(prisma, storage, { userId: req.user!.id, creationId, imageId });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  return router;
}

/** Public list of occasions (with ids, so sellers can tag creations), mounted at /api/occasions. */
export function occasionRoutes({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      occasions: await prisma.occasion.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true },
      }),
    });
  });
  return router;
}
