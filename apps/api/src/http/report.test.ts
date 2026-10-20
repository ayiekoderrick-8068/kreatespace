import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { loadEnv } from "../config/env.js";
import {
  createWebhookReporter,
  hasErrorReporter,
  reportError,
  setErrorReporter,
  type ErrorReport,
} from "./report.js";

afterEach(() => setErrorReporter(null));

const boom = () => Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });

describe("reportError", () => {
  it("does nothing, and cannot fail, when no reporter is set", async () => {
    expect(hasErrorReporter()).toBe(false);
    await expect(reportError(boom(), "somewhere")).resolves.toBeUndefined();
  });

  it("passes on a summary with the error's name, code, short message and where it happened", async () => {
    const seen: ErrorReport[] = [];
    setErrorReporter((report) => void seen.push(report));
    await reportError(boom(), "GET /api/x");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      service: "api",
      context: "GET /api/x",
      error: { name: "Error", code: "ECONNREFUSED", message: "connection refused" },
    });
    expect(Date.parse(seen[0]!.time)).not.toBeNaN();
  });

  it("is not broken by a reporter that throws or rejects", async () => {
    setErrorReporter(() => {
      throw new Error("reporter broke");
    });
    await expect(reportError(boom(), "a")).resolves.toBeUndefined();
    setErrorReporter(() => Promise.reject(new Error("reporter rejected")));
    await expect(reportError(boom(), "b")).resolves.toBeUndefined();
  });
});

describe("the webhook reporter", () => {
  const report = (context = "GET /api/x", message = "connection refused"): ErrorReport => ({
    service: "api",
    time: "2026-10-20T10:00:00.000Z",
    context,
    error: { name: "Error", message, stack: "" },
  });

  it("posts JSON with a one-line summary that chat tools can show", async () => {
    const send = vi.fn(async () => new Response("ok"));
    await createWebhookReporter("https://hooks.example/alert", { fetch: send as never })(report());
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example/alert");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.text).toBe("KreateSpace api error in GET /api/x: Error — connection refused");
    expect(body.context).toBe("GET /api/x");
  });

  it("holds back repeats of the same error, then reports it again after a while", async () => {
    const send = vi.fn(async () => new Response("ok"));
    let now = 0;
    const reporter = createWebhookReporter("https://hooks.example/a", {
      fetch: send as never,
      repeatMs: 60_000,
      now: () => now,
    });
    await reporter(report());
    await reporter(report());
    now = 30_000;
    await reporter(report());
    expect(send).toHaveBeenCalledTimes(1);
    await reporter(report("POST /api/other")); // a different error goes through
    expect(send).toHaveBeenCalledTimes(2);
    now = 61_000;
    await reporter(report());
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("caps a flood of different errors", async () => {
    const send = vi.fn(async () => new Response("ok"));
    const reporter = createWebhookReporter("https://hooks.example/a", {
      fetch: send as never,
      perMinute: 3,
      now: () => 0,
    });
    for (let i = 0; i < 10; i += 1) await reporter(report(`ctx ${i}`));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("shrugs off an unreachable address and gives up on a slow one", async () => {
    await expect(
      createWebhookReporter("https://hooks.example/a", {
        fetch: (async () => {
          throw new Error("offline");
        }) as never,
      })(report()),
    ).resolves.toBeUndefined();

    const slow = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
      })) as never;
    await expect(
      createWebhookReporter("https://hooks.example/a", { fetch: slow, timeoutMs: 20 })(report()),
    ).resolves.toBeUndefined();
  });
});

describe("what the API reports", () => {
  // The database stub is empty, so any route that touches it fails with an unexpected error.
  const app = createApp(
    { CORS_ORIGIN: [] },
    {
      rateLimiting: false,
      prisma: {} as PrismaClient,
      auth: {
        verifyToken: async () => {
          throw new Error("not used");
        },
        users: {
          findOrCreate: async () => {
            throw new Error("not used");
          },
        },
      },
    },
  );

  it("reports an unexpected server error once, by route only, with no request data", async () => {
    const seen: ErrorReport[] = [];
    setErrorReporter((r) => void seen.push(r));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).get("/api/public/home?secret=hunter2");
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      quiet.mockRestore();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]!.context).toBe("GET /api/public/home");
    expect(JSON.stringify(seen[0])).not.toContain("hunter2");
  });

  it("replaces ids and long tokens in the path, so alerts never carry them", async () => {
    const seen: ErrorReport[] = [];
    setErrorReporter((r) => void seen.push(r));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await request(app).get("/api/public/creations/3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10");
    } finally {
      quiet.mockRestore();
    }
    expect(seen.map((r) => r.context)).toEqual(["GET /api/public/creations/:id"]);
  });

  it("does not report mistakes by the caller (4xx) or expected refusals", async () => {
    const seen: ErrorReport[] = [];
    setErrorReporter((r) => void seen.push(r));
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect((await request(app).get("/api/nothing-here")).status).toBe(404);
    const malformed = await request(app)
      .post("/api/public/events")
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(malformed.status).toBe(400);
    expect(seen).toEqual([]);
  });
});

describe("configuration", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://x@db.example/x",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    API_URL: "https://api.example.com",
    WEB_URL: "https://www.example.com",
    CORS_ORIGIN: "https://www.example.com",
  };

  it("accepts an https alert address in production and rejects a plain http one", () => {
    expect(
      loadEnv({ ...production, ERROR_WEBHOOK_URL: "https://hooks.example/alert" })
        .ERROR_WEBHOOK_URL,
    ).toBe("https://hooks.example/alert");
    expect(() =>
      loadEnv({ ...production, ERROR_WEBHOOK_URL: "http://hooks.example/alert" }),
    ).toThrow(/ERROR_WEBHOOK_URL must use https/);
    expect(() => loadEnv({ ...production, ERROR_WEBHOOK_URL: "not a url" })).toThrow(
      /ERROR_WEBHOOK_URL/,
    );
  });

  it("is optional", () => {
    expect(loadEnv(production).ERROR_WEBHOOK_URL).toBeUndefined();
  });
});
