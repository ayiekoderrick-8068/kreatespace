import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { savedListQuerySchema } from "@kreatespace/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { listSaved, listSavedIds, saveCreation, unsaveCreation } from "./saved.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
  writeLimiter: RequestHandler;
}

/**
 * The signed-in user's saved creations, mounted at /api/me/saved. Any signed-in account may
 * save; every operation is scoped to the caller, so one user can never see or change another's.
 */
export function savedRoutes({ prisma, authenticate, storage, writeLimiter }: Deps): Router {
  const router = Router();
  router.use(authenticate);
  // Responses are personal and must never be stored by shared caches.
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  router.get("/", async (req, res) => {
    const query = parseInput(savedListQuerySchema, req.query);
    res.json(await listSaved(prisma, storage, { userId: req.user!.id, ...query }));
  });

  router.get("/ids", async (req, res) => {
    res.json({ ids: await listSavedIds(prisma, req.user!.id) });
  });

  router.put("/:creationId", writeLimiter, async (req, res) => {
    const creationId = parseInput(z.uuid(), req.params.creationId);
    await saveCreation(prisma, { userId: req.user!.id, creationId });
    res.json({ saved: true });
  });

  router.delete("/:creationId", writeLimiter, async (req, res) => {
    const creationId = parseInput(z.uuid(), req.params.creationId);
    await unsaveCreation(prisma, { userId: req.user!.id, creationId });
    res.json({ saved: false });
  });

  return router;
}
