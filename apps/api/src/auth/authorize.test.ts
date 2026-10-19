import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireRole } from "./authorize.js";
import type { AppUser, UserRole } from "./user-store.js";

function appWithUser(role?: UserRole) {
  const app = express();
  app.use((req, _res, next) => {
    if (role) {
      const user: AppUser = { id: "u1", email: "u@example.com", fullName: null, role };
      req.user = user;
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

  it("allows any of several permitted roles", async () => {
    expect((await request(appWithUser("SELLER")).get("/staff")).status).toBe(200);
    expect((await request(appWithUser("ADMIN")).get("/staff")).status).toBe(200);
    expect((await request(appWithUser("CUSTOMER")).get("/staff")).status).toBe(403);
  });
});
