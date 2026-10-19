import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { adminBusinessListQuerySchema, reviewDecisionSchema } from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  decideOnBusiness,
  getBusinessForReview,
  listBusinessesForReview,
} from "./review-service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
}

/** Admin moderation of businesses, mounted at /api/admin/businesses. Admin role is required. */
export function adminBusinessRoutes({ prisma, authenticate, storage }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"));

  router.get("/", async (req, res) => {
    const query = parseInput(adminBusinessListQuerySchema, req.query);
    res.json(await listBusinessesForReview(prisma, query));
  });

  router.get("/:id", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    res.json(await getBusinessForReview(prisma, storage, id));
  });

  router.post("/:id/decision", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    const decision = parseInput(reviewDecisionSchema, req.body);
    await decideOnBusiness(prisma, { businessId: id, adminId: req.user!.id, decision });
    res.json(await getBusinessForReview(prisma, storage, id));
  });

  return router;
}
