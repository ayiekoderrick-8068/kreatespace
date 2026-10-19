import { Router, type RequestHandler } from "express";
import { analyticsQuerySchema } from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import { getBusinessAnalytics, getPlatformAnalytics } from "./service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

/** A seller's own analytics, mounted at /api/analytics. There is no way to ask about another business. */
export function sellerAnalyticsRoutes({ prisma, authenticate }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("SELLER"), noStore);

  router.get("/", async (req, res) => {
    const { days } = parseInput(analyticsQuerySchema, req.query);
    res.json(await getBusinessAnalytics(prisma, { userId: req.user!.id, days }));
  });

  return router;
}

/** Platform-wide analytics for administrators, mounted at /api/admin/analytics. */
export function adminAnalyticsRoutes({ prisma, authenticate }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"), noStore);

  router.get("/", async (req, res) => {
    const { days } = parseInput(analyticsQuerySchema, req.query);
    res.json(await getPlatformAnalytics(prisma, { days }));
  });

  return router;
}
