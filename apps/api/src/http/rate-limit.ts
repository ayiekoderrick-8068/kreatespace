import type { RequestHandler } from "express";
import { rateLimit, type Store } from "express-rate-limit";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * Per-IP limiter for sensitive endpoints; responds with the standard error envelope. Counters live
 * in memory unless a shared `store` is given (needed when more than one API instance runs). If the
 * shared store itself fails, requests are let through rather than the whole API going down.
 */
export function createRateLimiter(
  options: RateLimitOptions,
  enabled = true,
  store?: Store,
): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    ...(store ? { store, passOnStoreError: true } : {}),
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
