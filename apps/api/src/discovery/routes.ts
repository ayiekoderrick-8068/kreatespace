import { Router } from "express";
import { z } from "zod";
import { creationListQuerySchema } from "@kreatespace/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { getCreation, listCreations } from "./service.js";

/** Short shared caching: image URLs are signed for an hour, so a brief cache is safe. */
const PUBLIC_CACHE = "public, max-age=30, stale-while-revalidate=120";

/** Public, read-only discovery endpoints, mounted at /api/public. */
export function discoveryRoutes({
  prisma,
  storage,
}: {
  prisma: PrismaClient;
  storage?: MediaStorage;
}): Router {
  const router = Router();

  router.get("/creations", async (req, res) => {
    const query = parseInput(creationListQuerySchema, req.query);
    res.set("Cache-Control", PUBLIC_CACHE);
    res.json(await listCreations(prisma, storage, query));
  });

  router.get("/creations/:id", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    res.set("Cache-Control", PUBLIC_CACHE);
    res.json({ creation: await getCreation(prisma, storage, id) });
  });

  return router;
}
