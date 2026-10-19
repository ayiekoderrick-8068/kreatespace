import type { NextFunction, Request, RequestHandler, Response } from "express";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier.js";
import type { AppUser, UserStore } from "./user-store.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth` for authenticated requests. */
      user?: AppUser;
      /** How the session was authenticated; set together with `user`. */
      auth?: { aal: "aal1" | "aal2"; authenticatedAt?: Date; adminMfaRequired: boolean };
    }
  }
}

export interface AuthDeps {
  verifyToken: TokenVerifier;
  users: UserStore;
  /**
   * Administrators must have completed two-step verification (default true). Only ever switched
   * off for local development; production refuses to start without it.
   */
  adminMfaRequired?: boolean;
}

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

/** Requires a valid Supabase bearer token and attaches the application user to the request. */
export function requireAuth({
  verifyToken,
  users,
  adminMfaRequired = true,
}: AuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) {
      return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
    }

    try {
      const identity = await verifyToken(match[1]);
      req.user = await users.findOrCreate(identity);
      req.auth = {
        aal: identity.aal ?? "aal1",
        authenticatedAt: identity.authenticatedAt,
        adminMfaRequired,
      };
      next();
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        return sendError(res, 401, "UNAUTHENTICATED", "Invalid or expired session");
      }
      next(error);
    }
  };
}
