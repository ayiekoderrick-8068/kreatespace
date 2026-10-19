import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/** Per-IP limiter for sensitive endpoints; responds with the standard error envelope. */
export function createRateLimiter(options: RateLimitOptions, enabled = true): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
      });
    },
  });
}
