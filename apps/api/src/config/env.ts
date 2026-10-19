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
  /** Public URL of the web app (used in invitation links). */
  WEB_URL: z.url().default("http://localhost:5173"),
  SUPABASE_URL: z.url().optional(),
  /** Server-only key used for Storage. Never expose it to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("business-media"),
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
  return result.data;
}
