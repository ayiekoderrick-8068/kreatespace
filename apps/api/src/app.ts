import cors from "cors";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import helmet from "helmet";
import { PLATFORM_NAME } from "@kreatespace/shared";
import { requireAuth, type AuthDeps } from "./auth/middleware.js";
import type { Env } from "./config/env.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { HttpError } from "./http/errors.js";
import { describeError } from "./http/log.js";
import { createRateLimiter, type RateLimitOptions } from "./http/rate-limit.js";
import type { Store } from "express-rate-limit";
import { accountRoutes, adminDeletionRoutes } from "./accounts/routes.js";
import { adminAnalyticsRoutes, sellerAnalyticsRoutes } from "./analytics/routes.js";
import { adminBusinessRoutes } from "./businesses/admin-routes.js";
import { categoryRoutes, sellerBusinessRoutes } from "./businesses/routes.js";
import { adminInvitationRoutes, inviteeInvitationRoutes } from "./invitations/routes.js";
import { discoveryRoutes } from "./discovery/routes.js";
import { adminCreationRoutes } from "./portfolio/admin-routes.js";
import { occasionRoutes, sellerCreationRoutes } from "./portfolio/routes.js";
import { savedRoutes } from "./discovery/saved-routes.js";
import { inquiryEventRoutes } from "./inquiries/routes.js";
import { adminImportRoutes, type ImporterDeps } from "./imports/routes.js";
import { createSafeFetcher } from "./imports/safe-fetch.js";
import { adminPackageRoutes, sellerPackageRoutes } from "./packages/routes.js";
import { publicRoutes } from "./public/routes.js";
import { seoRoutes } from "./seo/routes.js";
import type { MediaStorage } from "./storage/media-storage.js";
import {
  adminWebsiteRequestRoutes,
  sellerWebsiteRequestRoutes,
} from "./website-requests/routes.js";

export interface AppDeps {
  /** Authentication dependencies; when absent, protected routes respond with 503. */
  auth?: AuthDeps;
  /** Database client; when absent, data routes respond with 503. */
  prisma?: PrismaClient;
  /** Private image storage; when absent, uploads are unavailable and image URLs are omitted. */
  storage?: MediaStorage;
  /** Public base URL of the web app, used to build invitation links. */
  webUrl?: string;
  /** Public base URL of this API, used for link-preview image addresses. */
  apiUrl?: string;
  /** Set to false in tests to switch off per-IP rate limiting. */
  rateLimiting?: boolean;
  /**
   * Makes the counter storage for one limiter (given a unique prefix). Leave out to count in
   * memory, which is only correct while a single API instance runs.
   */
  rateLimitStore?: (prefix: string) => Store;
  /** Website importer settings; tests replace the fetcher to reach a local server. */
  importer?: Partial<ImporterDeps>;
}

const unavailable: RequestHandler = (_req, res) => {
  res.status(503).json({
    error: { code: "SERVICE_NOT_CONFIGURED", message: "This service is not configured" },
  });
};

export function createApp(
  env: Pick<Env, "CORS_ORIGIN"> & Partial<Pick<Env, "TRUST_PROXY">>,
  deps: AppDeps = {},
): Express {
  const app = express();

  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: `${PLATFORM_NAME} API` });
  });

  // Each limiter gets its own counters, named by the order it is created in.
  let limiterCount = 0;
  // If shared counters break, public browsing and analytics beacons carry on unlimited, but the
  // routes where abuse does real harm refuse (503) until they are back: invitation-token guessing,
  // and every signed-in action that changes data (uploads, imports, account deletion and export).
  const limiter = (options: RateLimitOptions, { failClosed = false } = {}) =>
    createRateLimiter(options, deps.rateLimiting !== false, {
      store: deps.rateLimitStore?.(`limiter${limiterCount++}:`),
      failClosed,
    });

  // A broad per-IP ceiling for every other API route; sensitive routes add tighter limits.
  app.use("/api", limiter({ windowMs: 60_000, max: 300 }));

  const authenticate: RequestHandler = deps.auth
    ? requireAuth(deps.auth)
    : (_req, res) => {
        res.status(503).json({
          error: { code: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" },
        });
      };

  app.get("/api/me", authenticate, (req, res) => {
    const { id, email, fullName, role } = req.user!;
    // Administrators are told whether the second step is required and done, so the website can
    // ask for it. (The server enforces it on every admin route regardless.)
    const mfa =
      role === "ADMIN"
        ? {
            required: req.auth?.adminMfaRequired !== false,
            satisfied: req.auth?.aal === "aal2",
          }
        : undefined;
    res.json({ user: { id, email, fullName, role, ...(mfa ? { mfa } : {}) } });
  });

  if (deps.auth && deps.prisma) {
    const routeDeps = {
      prisma: deps.prisma,
      authenticate,
      webUrl: deps.webUrl ?? "http://localhost:5173",
      limiter: limiter({ windowMs: 15 * 60_000, max: 30 }, { failClosed: true }),
    };
    const businessDeps = {
      prisma: deps.prisma,
      authenticate,
      storage: deps.storage,
      writeLimiter: limiter({ windowMs: 15 * 60_000, max: 100 }, { failClosed: true }),
    };
    app.use("/api/admin/invitations", adminInvitationRoutes(routeDeps));
    app.use("/api/admin/businesses", adminBusinessRoutes(businessDeps));
    app.use("/api/admin/creations", adminCreationRoutes(businessDeps));
    app.use("/api/invitations", inviteeInvitationRoutes(routeDeps));
    app.use("/api/categories", categoryRoutes(businessDeps));
    app.use(
      "/api/public/events",
      inquiryEventRoutes({
        prisma: deps.prisma,
        limiter: limiter({ windowMs: 10 * 60_000, max: 200 }),
      }),
    );
    app.use(
      "/api/public/seo",
      seoRoutes({
        prisma: deps.prisma,
        storage: deps.storage,
        urls: {
          web: (deps.webUrl ?? "http://localhost:5173").replace(/\/+$/, ""),
          api: deps.apiUrl?.replace(/\/+$/, ""),
        },
      }),
    );
    app.use("/api/public", publicRoutes(businessDeps));
    app.use("/api/public", discoveryRoutes(businessDeps));
    app.use("/api/me/saved", savedRoutes(businessDeps));
    app.use("/api/me", accountRoutes(businessDeps));
    app.use("/api/admin/deletions", adminDeletionRoutes(businessDeps));
    app.use("/api/occasions", occasionRoutes(businessDeps));
    app.use("/api/creations", sellerCreationRoutes(businessDeps));
    app.use("/api/packages", sellerPackageRoutes(businessDeps));
    app.use("/api/admin/packages", adminPackageRoutes(businessDeps));
    app.use("/api/admin/analytics", adminAnalyticsRoutes(businessDeps));
    app.use(
      "/api/admin/imports",
      adminImportRoutes({
        ...businessDeps,
        importer: { fetcher: createSafeFetcher(), ...deps.importer },
      }),
    );
    app.use("/api/analytics", sellerAnalyticsRoutes(businessDeps));
    app.use("/api/admin/website-requests", adminWebsiteRequestRoutes(businessDeps));
    app.use("/api/website-requests", sellerWebsiteRequestRoutes(businessDeps));
    app.use("/api/businesses", sellerBusinessRoutes(businessDeps));
  } else {
    app.use(
      [
        "/api/admin",
        "/api/invitations",
        "/api/categories",
        "/api/businesses",
        "/api/public",
        "/api/me/saved",
        "/api/me/deletion",
        "/api/me/export",
        "/api/creations",
        "/api/occasions",
        "/api/packages",
        "/api/analytics",
        "/api/website-requests",
      ],
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
      // Log what is needed to diagnose without dumping request data or query values.
      console.error("Unhandled error", describeError(err));
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
