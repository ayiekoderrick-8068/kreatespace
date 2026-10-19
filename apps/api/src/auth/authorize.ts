import type { RequestHandler } from "express";
import type { UserRole } from "./user-store.js";

/**
 * Allows the request through only when the authenticated user holds one of the given roles.
 * Must run after `requireAuth`; a request without a user is treated as unauthenticated.
 */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res
        .status(401)
        .json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res
        .status(403)
        .json({ error: { code: "FORBIDDEN", message: "You do not have access to this resource" } });
      return;
    }
    // Administrators can change what the whole public sees, so the server (never the website)
    // insists on a second factor for anything admin-only.
    if (allowed.includes("ADMIN") && req.user.role === "ADMIN") {
      if (req.auth?.adminMfaRequired !== false && req.auth?.aal !== "aal2") {
        res.status(403).json({
          error: {
            code: "MFA_REQUIRED",
            message: "Two-step verification is required for administrators",
          },
        });
        return;
      }
    }
    next();
  };
}
