import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { creationDetailsSchema, creationDraftSchema } from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  archiveCreation,
  createCreation,
  getOwnCreation,
  listOwnCreations,
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

  router.post("/:id/archive", writeLimiter, async (req, res) => {
    const creationId = parseInput(idSchema, req.params.id);
    await archiveCreation(prisma, { userId: req.user!.id, creationId });
    res.json(await getOwnCreation(prisma, storage, { userId: req.user!.id, creationId }));
  });

  return router;
}
