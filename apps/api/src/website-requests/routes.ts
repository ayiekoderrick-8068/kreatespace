import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  adminWebsiteRequestListQuerySchema,
  websiteRequestSchema,
  websiteRequestUpdateSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import {
  cancelWebsiteRequest,
  createWebsiteRequest,
  getWebsiteRequestForAdmin,
  listOwnWebsiteRequests,
  listWebsiteRequestsForAdmin,
  updateWebsiteRequest,
} from "./service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  writeLimiter: RequestHandler;
}

const idSchema = z.uuid();
const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

/** The seller's own website requests, mounted at /api/website-requests. */
export function sellerWebsiteRequestRoutes({ prisma, authenticate, writeLimiter }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("SELLER"), noStore);

  router.get("/", async (req, res) => {
    res.json(await listOwnWebsiteRequests(prisma, req.user!.id));
  });

  router.post("/", writeLimiter, async (req, res) => {
    const request = parseInput(websiteRequestSchema, req.body);
    res.status(201).json(await createWebsiteRequest(prisma, { userId: req.user!.id, request }));
  });

  router.post("/:id/cancel", writeLimiter, async (req, res) => {
    const requestId = parseInput(idSchema, req.params.id);
    res.json(await cancelWebsiteRequest(prisma, { userId: req.user!.id, requestId }));
  });

  return router;
}

/** Administrator handling of website requests, mounted at /api/admin/website-requests. */
export function adminWebsiteRequestRoutes({
  prisma,
  authenticate,
}: Omit<Deps, "writeLimiter">): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"), noStore);

  router.get("/", async (req, res) => {
    res.json(
      await listWebsiteRequestsForAdmin(
        prisma,
        parseInput(adminWebsiteRequestListQuerySchema, req.query),
      ),
    );
  });

  router.get("/:id", async (req, res) => {
    res.json(await getWebsiteRequestForAdmin(prisma, parseInput(idSchema, req.params.id)));
  });

  router.patch("/:id", async (req, res) => {
    const requestId = parseInput(idSchema, req.params.id);
    const changes = parseInput(websiteRequestUpdateSchema, req.body);
    await updateWebsiteRequest(prisma, { requestId, adminId: req.user!.id, changes });
    res.json(await getWebsiteRequestForAdmin(prisma, requestId));
  });

  return router;
}
