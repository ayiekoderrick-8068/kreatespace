import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { PLATFORM_NAME } from "@kreatespace/shared";
import { requireAuth, type AuthDeps } from "./auth/middleware.js";
import type { Env } from "./config/env.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { HttpError } from "./http/errors.js";
import { createRateLimiter } from "./http/rate-limit.js";
import { adminBusinessRoutes } from "./businesses/admin-routes.js";
import { categoryRoutes, sellerBusinessRoutes } from "./businesses/routes.js";
import { adminInvitationRoutes, inviteeInvitationRoutes } from "./invitations/routes.js";
import { publicRoutes } from "./public/routes.js";
import type { MediaStorage } from "./storage/media-storage.js";

export interface AppDeps {
  /** Authentication dependencies; when absent, protected routes respond with 503. */
  auth?: AuthDeps;
  /** Database client; when absent, data routes respond with 503. */
  prisma?: PrismaClient;
  /** Private image storage; when absent, uploads are unavailable and image URLs are omitted. */
  storage?: MediaStorage;
  /** Public base URL of the web app, used to build invitation links. */
  webUrl?: string;
  /** Set to false in tests to switch off per-IP rate limiting. */
  rateLimiting?: boolean;
}

const unavailable: RequestHandler = (_req, res) => {
  res.status(503).json({
    error: { code: "SERVICE_NOT_CONFIGURED", message: "This service is not configured" },
  });
};

export function createApp(env: Pick<Env, "CORS_ORIGIN">, deps: AppDeps = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: `${PLATFORM_NAME} API` });
  });

  const authenticate: RequestHandler = deps.auth
    ? requireAuth(deps.auth)
    : (_req, res) => {
        res.status(503).json({
          error: { code: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" },
        });
      };

  app.get("/api/me", authenticate, (req, res) => {
    const { id, email, fullName, role } = req.user!;
    res.json({ user: { id, email, fullName, role } });
  });

  if (deps.auth && deps.prisma) {
    const routeDeps = {
      prisma: deps.prisma,
      authenticate,
      webUrl: deps.webUrl ?? "http://localhost:5173",
      limiter: createRateLimiter({ windowMs: 15 * 60_000, max: 30 }, deps.rateLimiting !== false),
    };
    const businessDeps = {
      prisma: deps.prisma,
      authenticate,
      storage: deps.storage,
      writeLimiter: createRateLimiter(
        { windowMs: 15 * 60_000, max: 100 },
        deps.rateLimiting !== false,
      ),
    };
    app.use("/api/admin/invitations", adminInvitationRoutes(routeDeps));
    app.use("/api/admin/businesses", adminBusinessRoutes(businessDeps));
    app.use("/api/invitations", inviteeInvitationRoutes(routeDeps));
    app.use("/api/categories", categoryRoutes(businessDeps));
    app.use("/api/public", publicRoutes(businessDeps));
    app.use("/api/businesses", sellerBusinessRoutes(businessDeps));
  } else {
    app.use(
      ["/api/admin", "/api/invitations", "/api/categories", "/api/businesses", "/api/public"],
      unavailable,
    );
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // Malformed JSON and other body-parser failures carry a 4xx status.
    const status =
      typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) {
      console.error(err);
    }
    res.status(status).json({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message: status === 500 ? "Something went wrong" : "The request could not be processed",
      },
    });
  };
  app.use(errorHandler);

  return app;
}
