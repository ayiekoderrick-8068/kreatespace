import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  adminPackageListQuerySchema,
  confirmImageSchema,
  packageContentSchema,
  packageDraftSchema,
  reviewDecisionSchema,
  uploadRequestSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { decideOnPackage, getPackageForReview, listPackagesForReview } from "./review.js";
import {
  archivePackage,
  confirmPackageImage,
  createPackage,
  createPackageImageUpload,
  getOwnPackage,
  listOwnPackages,
  removePackageImage,
  submitPackage,
  updatePackage,
} from "./service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  storage?: MediaStorage;
  writeLimiter: RequestHandler;
}

const idSchema = z.uuid();
const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

/** The seller's own service packages, mounted at /api/packages. */
export function sellerPackageRoutes({ prisma, authenticate, storage, writeLimiter }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("SELLER"), noStore);

  const view = (userId: string, packageId: string) =>
    getOwnPackage(prisma, storage, { userId, packageId });
  const needStorage = () => {
    if (!storage)
      throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "Image uploads are not available");
    return storage;
  };

  router.get("/", async (req, res) => {
    res.json(await listOwnPackages(prisma, storage, req.user!.id));
  });

  router.post("/", writeLimiter, async (req, res) => {
    const content = parseInput(packageContentSchema, req.body);
    const { packageId } = await createPackage(prisma, { userId: req.user!.id, content });
    res.status(201).json(await view(req.user!.id, packageId));
  });

  router.get("/:id", async (req, res) => {
    res.json(await view(req.user!.id, parseInput(idSchema, req.params.id)));
  });

  router.patch("/:id", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    const changes = parseInput(packageDraftSchema, req.body);
    await updatePackage(prisma, { userId: req.user!.id, packageId, changes });
    res.json(await view(req.user!.id, packageId));
  });

  router.post("/:id/submit", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    await submitPackage(prisma, { userId: req.user!.id, packageId });
    res.json(await view(req.user!.id, packageId));
  });

  router.post("/:id/archive", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    await archivePackage(prisma, { userId: req.user!.id, packageId });
    res.json(await view(req.user!.id, packageId));
  });

  router.post("/:id/image-upload", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    const upload = parseInput(uploadRequestSchema, req.body);
    res.status(201).json(
      await createPackageImageUpload(prisma, needStorage(), {
        userId: req.user!.id,
        packageId,
        upload,
      }),
    );
  });

  router.post("/:id/image", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    const { path } = parseInput(confirmImageSchema, req.body);
    await confirmPackageImage(prisma, needStorage(), { userId: req.user!.id, packageId, path });
    res.json(await view(req.user!.id, packageId));
  });

  router.delete("/:id/image", writeLimiter, async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    await removePackageImage(prisma, storage, { userId: req.user!.id, packageId });
    res.json(await view(req.user!.id, packageId));
  });

  return router;
}

/** Admin moderation of packages, mounted at /api/admin/packages. */
export function adminPackageRoutes({
  prisma,
  authenticate,
  storage,
}: Omit<Deps, "writeLimiter">): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"), noStore);

  router.get("/", async (req, res) => {
    res.json(
      await listPackagesForReview(prisma, parseInput(adminPackageListQuerySchema, req.query)),
    );
  });

  router.get("/:id", async (req, res) => {
    res.json(await getPackageForReview(prisma, storage, parseInput(idSchema, req.params.id)));
  });

  router.post("/:id/decision", async (req, res) => {
    const packageId = parseInput(idSchema, req.params.id);
    const decision = parseInput(reviewDecisionSchema, req.body);
    await decideOnPackage(prisma, { packageId, adminId: req.user!.id, decision });
    res.json(await getPackageForReview(prisma, storage, packageId));
  });

  return router;
}
