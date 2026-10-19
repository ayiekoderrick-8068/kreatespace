import { Router, type RequestHandler } from "express";
import { inquiryEventSchema } from "@kreatespace/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { parseInput } from "../http/errors.js";
import { recordInquiryEvent } from "./service.js";

/**
 * Anonymous analytics events from the public site, mounted at /api/public/events. No sign-in
 * is needed and nothing identifying is read or stored; abuse is held back by rate limiting.
 */
export function inquiryEventRoutes({
  prisma,
  limiter,
}: {
  prisma: PrismaClient;
  limiter: RequestHandler;
}): Router {
  const router = Router();

  router.post("/", limiter, async (req, res) => {
    const event = parseInput(inquiryEventSchema, req.body);
    await recordInquiryEvent(prisma, event);
    res.status(202).json({ recorded: true });
  });

  return router;
}
