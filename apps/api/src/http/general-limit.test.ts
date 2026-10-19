import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("general API rate limit", () => {
  it("answers with the standard error once one address sends far too many requests", async () => {
    const app = createApp({ CORS_ORIGIN: [] });
    let limited: request.Response | undefined;
    for (let n = 0; n < 320 && !limited; n++) {
      const res = await request(app).get("/api/nothing-here");
      if (res.status === 429) limited = res;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
    });
    expect(limited?.headers).toHaveProperty("ratelimit");
  });

  it("never limits the health check that hosting platforms poll", async () => {
    const app = createApp({ CORS_ORIGIN: [] });
    for (let n = 0; n < 350; n++) {
      expect((await request(app).get("/api/health")).status).toBe(200);
    }
  });

  it("can be switched off for tests", async () => {
    const app = createApp({ CORS_ORIGIN: [] }, { rateLimiting: false });
    for (let n = 0; n < 320; n++) {
      expect((await request(app).get("/api/nothing-here")).status).toBe(404);
    }
  });
});
