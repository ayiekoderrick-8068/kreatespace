import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  RECENT_SIGN_IN_MINUTES,
  adminDeletionListQuerySchema,
  deletionDecisionSchema,
} from "@kreatespace/shared";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import {
  cancelDeletion,
  decideOnDeletion,
  getDeletionStatus,
  listDeletionsForAdmin,
  requestDeletion,
} from "./deletion.js";
import { exportAccountData } from "./export.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  writeLimiter: RequestHandler;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
};

/** A person's own deletion request and data export, mounted at /api/me. */
export function accountRoutes({ prisma, authenticate, writeLimiter }: Deps): Router {
  const router = Router();
  router.use(["/deletion", "/export"], authenticate, noStore);

  router.get("/deletion", async (req, res) => {
    res.json(await getDeletionStatus(prisma, req.user!.id));
  });

  router.post("/deletion", writeLimiter, async (req, res) => {
    const request = await requestDeletion(prisma, {
      userId: req.user!.id,
      authenticatedAt: req.auth?.authenticatedAt,
    });
    res.status(201).json({ request });
  });

  router.delete("/deletion", writeLimiter, async (req, res) => {
    res.json({ request: await cancelDeletion(prisma, { userId: req.user!.id }) });
  });

  router.get("/export", writeLimiter, async (req, res) => {
    // A copy of everything about a person is only handed over to someone who has just proved who
    // they are, so a borrowed or stolen session cannot walk away with it.
    const at = req.auth?.authenticatedAt;
    if (!at || Date.now() - at.getTime() > RECENT_SIGN_IN_MINUTES * 60_000) {
      throw new HttpError(
        403,
        "REAUTHENTICATION_REQUIRED",
        "For your security, please confirm your password again, then retry.",
      );
    }
    res
      .set("Content-Disposition", 'attachment; filename="kreatespace-my-data.json"')
      .json(await exportAccountData(prisma, req.user!.id));
  });

  return router;
}

/** Administrators' handling of deletion requests, mounted at /api/admin/deletions. */
export function adminDeletionRoutes({ prisma, authenticate }: Omit<Deps, "writeLimiter">): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"), noStore);

  router.get("/", async (req, res) => {
    res.json(
      await listDeletionsForAdmin(prisma, parseInput(adminDeletionListQuerySchema, req.query)),
    );
  });

  router.post("/:id/decision", async (req, res) => {
    const requestId = parseInput(z.uuid(), req.params.id);
    const { action, note } = parseInput(deletionDecisionSchema, req.body);
    await decideOnDeletion(prisma, { requestId, adminId: req.user!.id, action, note });
    res.json({ ok: true });
  });

  return router;
}
