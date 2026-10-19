import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireRole } from "./authorize.js";
import type { AppUser, UserRole } from "./user-store.js";

function appWithUser(
  role?: UserRole,
  auth: Express.Request["auth"] | "unknown" = { aal: "aal2", adminMfaRequired: true },
) {
  const app = express();
  app.use((req, _res, next) => {
    if (role) {
      const user: AppUser = { id: "u1", email: "u@example.com", fullName: null, role };
      req.user = user;
      if (auth !== "unknown") req.auth = auth;
    }
    next();
  });
  app.get("/admin", requireRole("ADMIN"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/staff", requireRole("ADMIN", "SELLER"), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("requireRole", () => {
  it("returns 401 when no user is attached", async () => {
    const res = await request(appWithUser()).get("/admin");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 for a customer on an admin route", async () => {
    const res = await request(appWithUser("CUSTOMER")).get("/admin");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for a seller on an admin route", async () => {
    const res = await request(appWithUser("SELLER")).get("/admin");
    expect(res.status).toBe(403);
  });

  it("allows an admin on an admin route", async () => {
    const res = await request(appWithUser("ADMIN")).get("/admin");
    expect(res.status).toBe(200);
  });

  describe("the second sign-in step for administrators", () => {
    it("refuses an administrator who has not completed it", async () => {
      const res = await request(appWithUser("ADMIN", { aal: "aal1", adminMfaRequired: true })).get(
        "/admin",
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MFA_REQUIRED");
    });

    it("refuses when nothing is known about how the session was authenticated (fails closed)", async () => {
      const res = await request(appWithUser("ADMIN", "unknown")).get("/admin");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MFA_REQUIRED");
    });

    it("applies on routes shared with other roles, but only to administrators", async () => {
      const weak = { aal: "aal1", adminMfaRequired: true } as const;
      expect((await request(appWithUser("ADMIN", weak)).get("/staff")).status).toBe(403);
      expect((await request(appWithUser("SELLER", weak)).get("/staff")).status).toBe(200);
    });

    it("can be switched off for development", async () => {
      const off = { aal: "aal1", adminMfaRequired: false } as const;
      expect((await request(appWithUser("ADMIN", off)).get("/admin")).status).toBe(200);
    });

    it("never helps a non-administrator who claims the higher level", async () => {
      const strong = { aal: "aal2", adminMfaRequired: true } as const;
      expect((await request(appWithUser("CUSTOMER", strong)).get("/admin")).status).toBe(403);
    });
  });

  it("allows any of several permitted roles", async () => {
    expect((await request(appWithUser("SELLER")).get("/staff")).status).toBe(200);
    expect((await request(appWithUser("ADMIN")).get("/staff")).status).toBe(200);
    expect((await request(appWithUser("CUSTOMER")).get("/staff")).status).toBe(403);
  });
});
