import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const app = createApp({ CORS_ORIGIN: ["http://localhost:5173"] });

describe("GET /api/health", () => {
  it("reports the service as healthy", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "KreateSpace API" });
  });

  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("unknown routes", () => {
  it("returns a structured 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("loadEnv", () => {
  it("applies defaults", () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toEqual(["http://localhost:5173"]);
  });

  it("splits multiple CORS origins", () => {
    const env = loadEnv({ CORS_ORIGIN: "https://a.example, https://b.example" });
    expect(env.CORS_ORIGIN).toEqual(["https://a.example", "https://b.example"]);
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnv({ PORT: "abc" })).toThrow(/Invalid environment configuration/);
  });
});
