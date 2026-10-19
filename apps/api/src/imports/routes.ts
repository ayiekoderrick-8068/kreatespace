import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  acceptImportItemSchema,
  grantImportSchema,
  importItemListQuerySchema,
  startImportSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import { describeError } from "../http/log.js";
import type { MediaStorage } from "../storage/media-storage.js";
import {
  acceptItem,
  getItem,
  grantAuthorization,
  listAuthorizations,
  listItems,
  listJobs,
  rejectItem,
  revokeAuthorization,
  runImportJob,
  startImport,
} from "./service.js";
import type { SafeFetcher } from "./safe-fetch.js";

export interface ImporterDeps {
  fetcher: SafeFetcher;
  /** Starts a crawl in the background. Tests replace this to wait for the result. */
  schedule?: (run: () => Promise<void>) => void;
  delayMs?: number;
}

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
  writeLimiter: RequestHandler;
  importer: ImporterDeps;
}

const idSchema = z.uuid();
const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

const inBackground = (run: () => Promise<void>) => {
  setImmediate(() => {
    run().catch((error) => console.error("Import crashed", describeError(error)));
  });
};

/** Administrator-only website importing, mounted at /api/admin/imports. */
export function adminImportRoutes({
  prisma,
  authenticate,
  storage,
  writeLimiter,
  importer,
}: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"), noStore);

  const businessFilter = z.object({ businessId: z.uuid().optional() });

  router.get("/authorizations", async (req, res) => {
    const { businessId } = parseInput(businessFilter, req.query);
    res.json({ authorizations: await listAuthorizations(prisma, businessId) });
  });

  router.post("/authorizations", writeLimiter, async (req, res) => {
    const { businessId } = parseInput(grantImportSchema, req.body);
    const created = await grantAuthorization(prisma, { businessId, adminId: req.user!.id });
    res.status(201).json({ id: created.id, domain: created.domain });
  });

  router.delete("/authorizations/:id", writeLimiter, async (req, res) => {
    const authorizationId = parseInput(idSchema, req.params.id);
    await revokeAuthorization(prisma, { authorizationId, adminId: req.user!.id });
    res.status(204).end();
  });

  router.get("/jobs", async (req, res) => {
    const { businessId } = parseInput(businessFilter, req.query);
    res.json({ jobs: await listJobs(prisma, businessId) });
  });

  router.post("/jobs", writeLimiter, async (req, res) => {
    const { authorizationId, startUrl } = parseInput(startImportSchema, req.body);
    const job = await startImport(prisma, { authorizationId, startUrl, adminId: req.user!.id });
    (importer.schedule ?? inBackground)(() =>
      runImportJob(prisma, job.id, { fetcher: importer.fetcher, delayMs: importer.delayMs }),
    );
    res.status(202).json({ id: job.id, status: job.status });
  });

  router.get("/items", async (req, res) => {
    const query = parseInput(
      importItemListQuerySchema.extend({
        jobId: z.uuid().optional(),
        businessId: z.uuid().optional(),
      }),
      req.query,
    );
    res.json(await listItems(prisma, query));
  });

  router.get("/items/:id", async (req, res) => {
    res.json(await getItem(prisma, parseInput(idSchema, req.params.id)));
  });

  router.post("/items/:id/accept", writeLimiter, async (req, res) => {
    if (!storage) {
      throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "Image uploads are not available");
    }
    const itemId = parseInput(idSchema, req.params.id);
    const changes = parseInput(acceptImportItemSchema, req.body);
    res
      .status(201)
      .json(
        await acceptItem(
          prisma,
          { storage, fetcher: importer.fetcher },
          { itemId, adminId: req.user!.id, changes },
        ),
      );
  });

  router.post("/items/:id/reject", writeLimiter, async (req, res) => {
    const itemId = parseInput(idSchema, req.params.id);
    await rejectItem(prisma, { itemId, adminId: req.user!.id });
    res.json(await getItem(prisma, itemId));
  });

  return router;
}
