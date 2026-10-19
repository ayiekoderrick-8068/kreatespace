import { Router, type RequestHandler } from "express";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  invitationTokenSchema,
} from "@kreatespace/shared";
import { z } from "zod";
import { requireRole } from "../auth/authorize.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  lookupInvitation,
  revokeInvitation,
} from "./service.js";

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  webUrl: string;
  limiter: RequestHandler;
}

/** Admin-only invitation management, mounted at /api/admin/invitations. */
export function adminInvitationRoutes({ prisma, authenticate, webUrl }: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole("ADMIN"));

  router.get("/", async (_req, res) => {
    res.json({ invitations: await listInvitations(prisma) });
  });

  router.post("/", async (req, res) => {
    const { email } = parseInput(createInvitationSchema, req.body);
    const { invitation, token } = await createInvitation(prisma, {
      email,
      adminId: req.user!.id,
    });
    // The raw token is shown once; only its hash is stored.
    res
      .status(201)
      .json({ invitation, inviteUrl: `${webUrl.replace(/\/+$/, "")}/invite/${token}` });
  });

  router.post("/:id/revoke", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    const invitation = await revokeInvitation(prisma, { id, adminId: req.user!.id });
    res.json({ invitation });
  });

  return router;
}

/** Invitation checks and acceptance for invitees, mounted at /api/invitations. */
export function inviteeInvitationRoutes({ prisma, authenticate, limiter }: Deps): Router {
  const router = Router();

  router.get("/lookup", limiter, async (req, res) => {
    const token = parseInput(invitationTokenSchema, req.query.token);
    res.json(await lookupInvitation(prisma, token));
  });

  router.post("/accept", limiter, authenticate, async (req, res) => {
    const { token } = parseInput(acceptInvitationSchema, req.body);
    const result = await acceptInvitation(prisma, { token, user: req.user! });
    res.json({ role: result.role });
  });

  return router;
}
