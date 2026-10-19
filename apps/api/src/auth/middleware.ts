import type { NextFunction, Request, RequestHandler, Response } from "express";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier.js";
import type { AppUser, UserStore } from "./user-store.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth` for authenticated requests. */
      user?: AppUser;
    }
  }
}

export interface AuthDeps {
  verifyToken: TokenVerifier;
  users: UserStore;
}

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

/** Requires a valid Supabase bearer token and attaches the application user to the request. */
export function requireAuth({ verifyToken, users }: AuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) {
      return sendError(res, 401, "UNAUTHENTICATED", "Authentication required");
    }

    try {
      const identity = await verifyToken(match[1]);
      req.user = await users.findOrCreate(identity);
      next();
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        return sendError(res, 401, "UNAUTHENTICATED", "Invalid or expired session");
      }
      next(error);
    }
  };
}
