import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { getPublicBusiness } from "./service.js";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

/** Unauthenticated, read-only endpoints for visitors, mounted at /api/public. */
export function publicRoutes({
  prisma,
  storage,
}: {
  prisma: PrismaClient;
  storage?: MediaStorage;
}) {
  const router = Router();

  router.get("/businesses/:slug", async (req, res) => {
    const slug = parseInput(slugSchema, req.params.slug);
    const business = await getPublicBusiness(prisma, storage, slug);
    // Image URLs are short-lived signed links, so responses must not be cached long-term.
    res.set("Cache-Control", "no-cache");
    res.json({ business });
  });

  return router;
}
