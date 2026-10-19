import cors from "cors";
import express, { type ErrorRequestHandler, type Express } from "express";
import helmet from "helmet";
import { PLATFORM_NAME } from "@kreatespace/shared";
import type { Env } from "./config/env.js";

export function createApp(env: Pick<Env, "CORS_ORIGIN">): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: `${PLATFORM_NAME} API` });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
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
