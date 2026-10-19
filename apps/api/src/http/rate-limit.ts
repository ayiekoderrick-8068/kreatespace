import type { RequestHandler } from "express";
import { rateLimit, type Store } from "express-rate-limit";
import { describeError } from "./log.js";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimiterExtras {
  /** Shared counters (needed when more than one API instance runs). Memory is used when absent. */
  store?: Store;
  /**
   * What to do if the shared counters cannot be read. By default the request is let through, so a
   * counter outage does not take ordinary browsing down. Routes where unlimited guessing or abuse
   * would do real harm set this, and are answered with 503 until the counters are back.
   */
  failClosed?: boolean;
}

/**
 * Per-IP limiter for sensitive endpoints; responds with the standard error envelope. With in-memory
 * counters it cannot fail; the options only matter for a shared store.
 */
export function createRateLimiter(
  options: RateLimitOptions,
  enabled = true,
  { store, failClosed = false }: RateLimiterExtras = {},
): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  const limiter = rateLimit({
    ...(store ? { store, passOnStoreError: !failClosed } : {}),
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
  if (!store || !failClosed) return limiter;

  return (req, res, next) => {
    void limiter(req, res, (error?: unknown) => {
      if (error === undefined || error === null || error === "route" || error === "router") {
        next(error as never);
        return;
      }
      // The only thing the limiter can fail on is its own counters.
      console.error("Rate limiter unavailable; refusing a protected request", describeError(error));
      res
        .status(503)
        .set("Retry-After", "30")
        .json({
          error: {
            code: "RATE_LIMIT_UNAVAILABLE",
            message: "This action is temporarily unavailable. Please try again in a minute.",
          },
        });
    });
  };
}
