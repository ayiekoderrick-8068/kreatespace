import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  /**
   * Number of reverse proxies in front of the API (e.g. 1 on most hosting platforms). Needed so
   * per-IP rate limits see the real client address instead of the proxy's.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Where rate-limit counters live. "memory" is right for one API instance. Set "postgres" before
   * running several, so they count each visitor together (one small database write per request).
   */
  RATE_LIMIT_STORE: z.enum(["memory", "postgres"]).default("memory"),
  /**
   * Administrators must complete two-step verification (an authenticator-app code). Leave on; it
   * may be switched off for local development only, and production refuses to start without it.
   */
  ADMIN_MFA_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /**
   * Where to send an alert when the API hits an unexpected error (a chat or alerting tool's
   * incoming-webhook address). Leave out to rely on logs and uptime checks alone.
   */
  ERROR_WEBHOOK_URL: z.url().optional(),
  /** Public URL of this API (used for stable link-preview image addresses). */
  API_URL: z.url().optional(),
  /** Public URL of the web app (used in invitation links). */
  WEB_URL: z.url().default("http://localhost:5173"),
  SUPABASE_URL: z.url().optional(),
  /** Server-only key used for Storage. Never expose it to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("business-media"),
  /** Serve resized image renditions (requires Supabase image transformations). */
  SUPABASE_IMAGE_TRANSFORMS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Only for projects still using the legacy shared JWT secret; omit for asymmetric signing keys. */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  assertProductionSafe(result.data, source);
  return result.data;
}

const isLocal = (value: string) =>
  /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(value);

/**
 * Refuses to start in production with settings that are only fit for a developer's machine:
 * missing database or sign-in configuration, local or wildcard origins, or an insecure web URL.
 */
function assertProductionSafe(env: Env, source: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (!env.SUPABASE_URL) problems.push("SUPABASE_URL is required");
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    problems.push("SUPABASE_SERVICE_ROLE_KEY is required for image storage");
  if (!env.API_URL || !env.API_URL.startsWith("https://") || isLocal(env.API_URL)) {
    problems.push("API_URL must be the public https address of this API");
  }
  if (!env.ADMIN_MFA_REQUIRED) {
    problems.push("ADMIN_MFA_REQUIRED must not be switched off in production");
  }
  if (env.ERROR_WEBHOOK_URL && !env.ERROR_WEBHOOK_URL.startsWith("https://")) {
    problems.push("ERROR_WEBHOOK_URL must use https");
  }
  if (!source.CORS_ORIGIN) problems.push("CORS_ORIGIN must be set to the web app's address");
  if (env.CORS_ORIGIN.some((origin) => origin === "*" || isLocal(origin))) {
    problems.push("CORS_ORIGIN must list only the real web app origin(s), not * or localhost");
  }
  if (env.CORS_ORIGIN.some((origin) => !origin.startsWith("https://") && !isLocal(origin))) {
    problems.push("CORS_ORIGIN must use https");
  }
  if (!source.WEB_URL || isLocal(env.WEB_URL) || !env.WEB_URL.startsWith("https://")) {
    problems.push("WEB_URL must be the public https address of the web app");
  }
  if (problems.length > 0) {
    throw new Error(`Unsafe production configuration — ${problems.join("; ")}`);
  }
}
