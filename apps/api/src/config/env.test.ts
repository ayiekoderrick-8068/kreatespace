import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.example.com:5432/app",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CORS_ORIGIN: "https://kreatespace.co.ke",
  WEB_URL: "https://kreatespace.co.ke",
  TRUST_PROXY: "1",
};

describe("loadEnv", () => {
  it("accepts a complete production configuration", () => {
    const env = loadEnv(production);
    expect(env.CORS_ORIGIN).toEqual(["https://kreatespace.co.ke"]);
    expect(env.NODE_ENV).toBe("production");
  });

  it("allows several web origins, trimmed", () => {
    const env = loadEnv({
      ...production,
      CORS_ORIGIN: "https://kreatespace.co.ke, https://www.kreatespace.co.ke",
    });
    expect(env.CORS_ORIGIN).toEqual(["https://kreatespace.co.ke", "https://www.kreatespace.co.ke"]);
  });

  it("keeps development easy: nothing is required locally", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGIN).toEqual(["http://localhost:5173"]);
  });

  it.each([
    ["no database", { DATABASE_URL: undefined }, /DATABASE_URL/],
    ["no sign-in project", { SUPABASE_URL: undefined }, /SUPABASE_URL/],
    ["no storage key", { SUPABASE_SERVICE_ROLE_KEY: undefined }, /SUPABASE_SERVICE_ROLE_KEY/],
    ["CORS left at its default", { CORS_ORIGIN: undefined }, /CORS_ORIGIN must be set/],
    ["a wildcard origin", { CORS_ORIGIN: "*" }, /not \* or localhost/],
    ["a localhost origin", { CORS_ORIGIN: "http://localhost:5173" }, /not \* or localhost/],
    ["a loopback origin", { CORS_ORIGIN: "http://127.0.0.1:5173" }, /not \* or localhost/],
    [
      "an extra localhost origin",
      { CORS_ORIGIN: "https://kreatespace.co.ke,http://localhost:5173" },
      /not \* or localhost/,
    ],
    ["an insecure origin", { CORS_ORIGIN: "http://kreatespace.co.ke" }, /must use https/],
    ["the web address left at its default", { WEB_URL: undefined }, /WEB_URL/],
    ["an insecure web address", { WEB_URL: "http://kreatespace.co.ke" }, /WEB_URL/],
    ["a localhost web address", { WEB_URL: "https://localhost:5173" }, /WEB_URL/],
  ])("refuses to start in production with %s", (_name, overrides, expected) => {
    const source: Record<string, string | undefined> = { ...production, ...overrides };
    for (const key of Object.keys(source)) if (source[key] === undefined) delete source[key];
    expect(() => loadEnv(source as NodeJS.ProcessEnv)).toThrow(expected);
  });

  it("lists every problem at once so they can all be fixed in one go", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(
      /DATABASE_URL.*SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*CORS_ORIGIN.*WEB_URL/s,
    );
  });

  it("still rejects malformed values", () => {
    expect(() => loadEnv({ PORT: "99999" })).toThrow(/Invalid environment configuration/);
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow(/Invalid environment configuration/);
  });
});
