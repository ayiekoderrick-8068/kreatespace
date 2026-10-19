import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { adminCreationListQuerySchema, reviewDecisionSchema } from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  decideOnCreation,
  getCreationForReview,
  listCreationsForReview,
} from "./review-service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
}

/** Admin moderation of creations, mounted at /api/admin/creations. Admin role is required. */
export function adminCreationRoutes({ prisma, authenticate, storage }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  router.get("/", async (req, res) => {
    const query = parseInput(adminCreationListQuerySchema, req.query);
    res.json(await listCreationsForReview(prisma, query));
  });

  router.get("/:id", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    res.json(await getCreationForReview(prisma, storage, id));
  });

  router.post("/:id/decision", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    const decision = parseInput(reviewDecisionSchema, req.body);
    await decideOnCreation(prisma, { creationId: id, adminId: req.user!.id, decision });
    res.json(await getCreationForReview(prisma, storage, id));
  });

  return router;
}
